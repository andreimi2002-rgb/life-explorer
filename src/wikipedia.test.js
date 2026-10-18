import test from 'node:test'
import assert from 'node:assert/strict'
import { loadWikipediaDescription } from './wikipedia.js'

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function taxon() {
  return { key: 5219416, canonicalName: 'Panthera tigris' }
}

function wikidataResponse({
  item = 'http://www.wikidata.org/entity/Q19939',
  taxonName = 'Panthera tigris',
  article = 'https://en.wikipedia.org/wiki/Tiger',
} = {}) {
  return response({
    results: {
      bindings: [{ item: { value: item }, taxonName: { value: taxonName }, article: { value: article } }],
    },
  })
}

test('loadWikipediaDescription finds the article by exact GBIF key and scientific name', async () => {
  const requestedUrls = []
  const fetchImpl = async (request) => {
    const url = new URL(request)
    requestedUrls.push(url)
    if (url.hostname === 'query.wikidata.org') return wikidataResponse()
    if (url.hostname === 'en.wikipedia.org') {
      return response({
        title: 'Tiger',
        extract: 'The tiger is a large cat native to Asia.',
        originalimage: {
          source: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/12/Tiger.jpg/1200px-Tiger.jpg',
        },
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const description = await loadWikipediaDescription(taxon(), { fetchImpl })

  assert.deepEqual(description, {
    title: 'Tiger',
    extract: 'The tiger is a large cat native to Asia.',
    articleUrl: 'https://en.wikipedia.org/wiki/Tiger',
    wikidataUrl: 'http://www.wikidata.org/entity/Q19939',
    image: { filename: 'Tiger.jpg' },
    matchedBy: 'gbif-key',
  })
  assert.match(requestedUrls[0].searchParams.get('query'), /wdt:P846 "5219416"/)
  assert.equal(requestedUrls[1].pathname, '/api/rest_v1/page/summary/Tiger')
})

test('loadWikipediaDescription omits articles with a different scientific name', async () => {
  const requestedUrls = []
  const fetchImpl = async (request) => {
    requestedUrls.push(new URL(request))
    return wikidataResponse({ taxonName: 'Panthera leo' })
  }

  assert.equal(await loadWikipediaDescription(taxon(), { fetchImpl }), null)
  assert.equal(requestedUrls.length, 1)
})

test('loadWikipediaDescription omits ambiguous Wikidata taxon mappings', async () => {
  const fetchImpl = async () => response({
    results: {
      bindings: [
        {
          item: { value: 'http://www.wikidata.org/entity/Q1' },
          taxonName: { value: 'Panthera tigris' },
          article: { value: 'https://en.wikipedia.org/wiki/Tiger' },
        },
        {
          item: { value: 'http://www.wikidata.org/entity/Q2' },
          taxonName: { value: 'Panthera tigris' },
          article: { value: 'https://en.wikipedia.org/wiki/Tiger' },
        },
      ],
    },
  })

  assert.equal(await loadWikipediaDescription(taxon(), { fetchImpl }), null)
})

test('loadWikipediaDescription reports upstream failures', async () => {
  await assert.rejects(
    loadWikipediaDescription(taxon(), { fetchImpl: async () => response({}, 503) }),
    /Wikidata request failed \(503\)/,
  )
})

test('loadWikipediaDescription caches matched articles briefly', async () => {
  let calls = 0
  const fetchImpl = async (request) => {
    calls += 1
    const url = new URL(request)
    return url.hostname === 'query.wikidata.org'
      ? wikidataResponse()
      : response({ title: 'Tiger', extract: 'A large cat.' })
  }

  const first = await loadWikipediaDescription(taxon(), { fetchImpl })
  const second = await loadWikipediaDescription(taxon(), { fetchImpl })

  assert.deepEqual(second, first)
  assert.equal(calls, 2)
})

function nameBinding({
  item = 'http://www.wikidata.org/entity/Q10',
  rank = 'http://www.wikidata.org/entity/Q7432',
  parentName = 'Euryodon',
  gbifKey,
} = {}) {
  return {
    item: { value: item },
    article: { value: 'https://en.wikipedia.org/wiki/Example_fish' },
    rank: { value: rank },
    parentName: { value: parentName },
    ...(gbifKey ? { gbifKey: { value: gbifKey } } : {}),
  }
}

function nameTierFetch(nameBindings) {
  return async (request) => {
    const url = new URL(request)
    if (url.hostname === 'query.wikidata.org') {
      const query = url.searchParams.get('query')
      return query.includes('P846 "')
        ? response({ results: { bindings: [] } })
        : response({ results: { bindings: nameBindings } })
    }
    return response({ title: 'Example fish', extract: 'A small fish.' })
  }
}

const nameTaxon = { key: 77, canonicalName: 'Euryodon exemplum', rank: 'SPECIES' }
const ancestors = ['Animalia', 'Euryodon']

test('name tier accepts a unique match with the same rank and a shared ancestor', async () => {
  const description = await loadWikipediaDescription(nameTaxon, {
    fetchImpl: nameTierFetch([nameBinding()]),
    ancestorNames: ancestors,
  })
  assert.equal(description.matchedBy, 'name')
  assert.equal(description.title, 'Example fish')
})

test('name tier rejects wrong rank, unrelated ancestry, own GBIF key and ambiguity', async () => {
  const cases = [
    [nameBinding({ rank: 'http://www.wikidata.org/entity/Q34740' })],
    [nameBinding({ parentName: 'Unrelated' })],
    [nameBinding({ gbifKey: '999' })],
    [nameBinding(), nameBinding({ item: 'http://www.wikidata.org/entity/Q11' })],
  ]
  for (const bindings of cases) {
    const description = await loadWikipediaDescription(nameTaxon, {
      fetchImpl: nameTierFetch(bindings),
      ancestorNames: ancestors,
    })
    assert.equal(description, null)
  }
})

test('name tier is skipped when no classification is provided', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return response({ results: { bindings: [] } })
  }
  assert.equal(await loadWikipediaDescription(nameTaxon, { fetchImpl }), null)
  assert.equal(calls, 1)
})
