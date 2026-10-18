import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyExtinction, loadExtinctionStatus } from './extinction.js'
import { loadTaxonChildren } from './species.js'

const response = (body, status = 200) => ({
  ok: status < 200 || status >= 300 ? false : true,
  status,
  json: async () => body,
})

test('no evidence stays unknown, never living', () => {
  assert.equal(classifyExtinction({}).state, 'unknown')
})

test('GBIF extinct flag gives extinct with evidence', () => {
  const result = classifyExtinction({ gbifExtinct: true })
  assert.equal(result.state, 'extinct')
  assert.ok(result.evidence.length > 0)
})

test('living needs positive evidence', () => {
  assert.equal(classifyExtinction({ gbifExtinct: false }).state, 'living')
  assert.equal(classifyExtinction({ iucnStatuses: ['least concern'] }).state, 'living')
})

test('extinct and living evidence together is a conflict, shown as unknown', () => {
  const result = classifyExtinction({ gbifExtinct: true, iucnStatuses: ['least concern'] })
  assert.equal(result.state, 'unknown')
  assert.equal(result.conflict, true)
})

test('extinct in the wild is reported as such', () => {
  const result = classifyExtinction({ iucnStatuses: ['extinct in the wild'] })
  assert.equal(result.state, 'extinct')
  assert.equal(result.kind, 'wild')
})

test('loadExtinctionStatus keeps source failures visible and not as living', async () => {
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.hostname === 'api.gbif.org') return response({}, 503)
    return response({ results: [] })
  }
  const result = await loadExtinctionStatus(
    { key: 1, canonicalName: 'Foo bar', rank: 'SPECIES' },
    { fetchImpl },
  )
  assert.equal(result.state, 'unknown')
  assert.ok(result.errors.length >= 1)
})

test('child filters use the server-side extinct search', async () => {
  const calls = []
  const fetchImpl = async (request) => {
    const url = new URL(request)
    calls.push(url)
    if (url.pathname.endsWith('/children')) {
      return response({
        results: [{ key: 5, canonicalName: 'Aus', scientificName: 'Aus', rank: 'GENUS', taxonomicStatus: 'ACCEPTED' }],
      })
    }
    return response({
      results: [{ key: 5, canonicalName: 'Aus', scientificName: 'Aus', rank: 'GENUS', taxonomicStatus: 'ACCEPTED' }],
      offset: 0,
      limit: 12,
      endOfRecords: true,
    })
  }
  const page = await loadTaxonChildren(1, { fetchImpl, filter: 'extinct' })
  assert.equal(page.results[0].extinctState, 'extinct')
  assert.equal(page.listedRank, 'GENUS')
  const search = calls.find((url) => url.pathname.endsWith('/species/search'))
  assert.equal(search.searchParams.get('isExtinct'), 'true')
  assert.equal(search.searchParams.get('rank'), 'GENUS')
})

test('All view marks unflagged children unknown and sorts living first', async () => {
  const child = (key, name) => ({ key, canonicalName: name, scientificName: name, rank: 'GENUS', taxonomicStatus: 'ACCEPTED' })
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.pathname.endsWith('/children')) {
      return response({ results: [child(1, 'A'), child(2, 'B'), child(3, 'C')], offset: 0, limit: 12, endOfRecords: true })
    }
    const extinct = url.searchParams.get('isExtinct') === 'true'
    return response({ results: [{ key: extinct ? 1 : 2 }], endOfRecords: true })
  }
  const page = await loadTaxonChildren(9, { fetchImpl })
  assert.deepEqual(page.results.map((r) => r.extinctState), ['living', 'unknown', 'extinct'])
})
