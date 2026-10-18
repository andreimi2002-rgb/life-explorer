import test from 'node:test'
import assert from 'node:assert/strict'
import { loadArticleSections, parseSections } from './articleSections.js'
import { loadQuickFacts } from './quickFacts.js'

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const long = (text) => `${text} ${'More detail about this topic. '.repeat(4)}`.trim()

const extract = [
  'Lead paragraph that is not a section.',
  '== Description ==',
  long('It is a large cat.'),
  '=== Fur ===',
  'Stripes cover the body.',
  '== Taxonomy ==',
  long('Not wanted.'),
  '== Distribution and habitat ==',
  long('It lives in forests.'),
  '== Diet ==',
  'Too short.',
  '== Behaviour ==',
  long('It hunts at night.'),
].join('\n')

test('parseSections keeps wanted sections only, in species order, and drops tiny ones', () => {
  const sections = parseSections(extract, 'SPECIES')
  assert.deepEqual(sections.map((section) => section.id), ['habitat', 'behaviour', 'description'])
  assert.match(sections[2].text, /Stripes cover the body/)
  assert.ok(!sections.some((section) => /Not wanted/.test(section.text)))
})

test('parseSections puts the description first for higher ranks', () => {
  const sections = parseSections(extract, 'GENUS')
  assert.equal(sections[0].id, 'description')
})

test('parseSections shortens long sections at a sentence boundary', () => {
  const text = `== Diet ==\n${'This is a sentence about food. '.repeat(60)}`
  const [section] = parseSections(text, 'SPECIES')
  assert.ok(section.text.length <= 800)
  assert.ok(section.text.endsWith('.'))
})

test('loadArticleSections requests the plain-text extract with CORS enabled', async () => {
  const requests = []
  const fetchImpl = async (request) => {
    requests.push(new URL(request))
    return response({ query: { pages: [{ title: 'Tiger', extract }] } })
  }
  const sections = await loadArticleSections('https://en.wikipedia.org/wiki/Tiger', 'SPECIES', { fetchImpl })
  assert.equal(sections.length, 3)
  assert.equal(requests[0].searchParams.get('titles'), 'Tiger')
  assert.equal(requests[0].searchParams.get('origin'), '*')
})

test('loadArticleSections reports failures and rejects foreign links', async () => {
  await assert.rejects(
    loadArticleSections('https://en.wikipedia.org/wiki/Tiger', 'SPECIES', {
      fetchImpl: async () => response({}, 503),
    }),
    /sections request failed \(503\)/,
  )
  await assert.rejects(
    loadArticleSections('https://example.com/wiki/Tiger', 'SPECIES', { fetchImpl: async () => response({}) }),
    /Invalid Wikipedia article link/,
  )
})

test('loadQuickFacts returns only facts present in Wikidata, with a source link', async () => {
  const fetchImpl = async () => response({
    results: {
      bindings: [
        { fact: { value: 'status' }, valueLabel: { value: 'Endangered' } },
        { fact: { value: 'food' }, valueLabel: { value: 'deer' } },
        { fact: { value: 'food' }, valueLabel: { value: 'deer' } },
        { fact: { value: 'habitat' }, valueLabel: { value: 'Q12345' } },
      ],
    },
  })
  const facts = await loadQuickFacts('http://www.wikidata.org/entity/Q19939', { fetchImpl })
  assert.deepEqual(facts, [
    { id: 'status', label: 'Conservation status (IUCN)', values: ['Endangered'], sourceUrl: 'http://www.wikidata.org/entity/Q19939' },
    { id: 'food', label: 'Main food source', values: ['Deer'], sourceUrl: 'http://www.wikidata.org/entity/Q19939' },
  ])
})

test('loadQuickFacts reports errors and validates the item link', async () => {
  await assert.rejects(
    loadQuickFacts('http://www.wikidata.org/entity/Q1', { fetchImpl: async () => response({}, 429) }),
    /facts request failed \(429\)/,
  )
  await assert.rejects(
    loadQuickFacts('https://evil.test/entity/Q1', { fetchImpl: async () => response({}) }),
    /Invalid Wikidata item link/,
  )
})
