import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkTaxon,
  createPoliteFetch,
  createRandom,
  formatSummary,
  parseArgs,
  summarize,
} from './coverage.js'

const json = (data, status = 200) => ({
  ok: status < 200 || status > 299 ? false : true,
  status,
  json: async () => data,
})

test('random sequence is reproducible for the same seed', () => {
  const a = createRandom(7)
  const b = createRandom(7)
  assert.deepEqual([a(), a(), a()], [b(), b(), b()])
  assert.notEqual(createRandom(8)(), createRandom(7)())
})

test('parseArgs validates options', () => {
  assert.equal(parseArgs(['--per-group', '5', '--seed', '3']).perGroup, 5)
  assert.throws(() => parseArgs(['--per-group', '0']))
  assert.throws(() => parseArgs(['--nope', '1']))
})

test('polite fetch retries rate limits but not client errors', async () => {
  let calls = 0
  const retrying = createPoliteFetch({
    delayMs: 0,
    backoffMs: 0,
    fetchImpl: async () => json({}, ++calls < 3 ? 429 : 200),
  })
  assert.equal((await retrying('https://x.test')).status, 200)
  assert.equal(calls, 3)

  calls = 0
  const notFound = createPoliteFetch({
    delayMs: 0,
    backoffMs: 0,
    fetchImpl: async () => { calls += 1; return json({}, 404) },
  })
  assert.equal((await notFound('https://x.test')).status, 404)
  assert.equal(calls, 1)
})

test('taxon without article keeps not found, key-only miss and noRecord apart', async () => {
  const fetchImpl = async (url) => {
    const target = String(url)
    if (target.includes('query.wikidata.org')) {
      const query = new URL(target).searchParams.get('query')
      if (query.includes('P846')) return json({ results: { bindings: [] } })
      return json({
        results: { bindings: [{ item: { value: 'https://www.wikidata.org/entity/Q1' } }] },
      })
    }
    if (target.includes('api.inaturalist.org')) return json({ results: [] })
    throw new Error(`unexpected request ${target}`)
  }
  const result = await checkTaxon(
    { key: 1, canonicalName: 'Examplea nova', rank: 'SPECIES', kingdom: 'Animalia' },
    fetchImpl,
  )
  assert.equal(result.description, 'notFound')
  assert.equal(result.nameOnlyArticle, true)
  assert.equal(result.photo, 'notFound')
  assert.equal(result.iNaturalistExtinct, 'noRecord')
  assert.deepEqual(result.extinctSignals, [])
})

test('source failures are reported as failed, not as empty data', async () => {
  const fetchImpl = async () => json({}, 500)
  const result = await checkTaxon(
    { key: 2, canonicalName: 'Examplea vetus', rank: 'SPECIES', kingdom: 'Animalia' },
    fetchImpl,
  )
  assert.equal(result.description, 'failed')
  assert.equal(result.photo, 'failed')
  assert.equal(result.iNaturalistExtinct, 'failed')
})

test('summary counts statuses per kingdom and formats percentages', () => {
  const base = { rank: 'SPECIES', extinctSignals: [], iNaturalistExtinct: 'notFlagged' }
  const summary = summarize([
    { ...base, kingdom: 'A', description: 'found', photo: 'found' },
    { ...base, kingdom: 'A', description: 'notFound', photo: 'failed', nameOnlyArticle: true },
    { ...base, kingdom: 'B', description: 'failed', photo: 'notFound', extinctSignals: ['x'] },
  ])
  assert.equal(summary.overall.total, 3)
  assert.equal(summary.byKingdom.A.description.found, 1)
  assert.equal(summary.byKingdom.A.descriptionMissedOnlyByKeyLookup, 1)
  assert.equal(summary.byKingdom.B.extinctFlagged, 1)
  assert.match(formatSummary(summary), /TOTAL\s+n=3/)
})
