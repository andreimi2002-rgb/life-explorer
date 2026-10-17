import test from 'node:test'
import assert from 'node:assert/strict'
import { searchSpecies } from './species.js'

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

test('searchSpecies skips network requests for terms shorter than two characters', async () => {
  let requestCount = 0
  const results = await searchSpecies(' w ', {
    fetchImpl: async () => {
      requestCount += 1
      return response([])
    },
  })

  assert.deepEqual(results, { scientific: [], common: [] })
  assert.equal(requestCount, 0)
})

test('searchSpecies returns scientific suggestions and matching English common names', async () => {
  const requestedUrls = []
  const fetchImpl = async (request) => {
    const url = new URL(request)
    requestedUrls.push(url)

    if (url.pathname.endsWith('/species/suggest')) {
      return response([
        { key: 1, scientificName: 'Canis lupus', canonicalName: 'Canis lupus', rank: 'SPECIES' },
        { key: 2, scientificName: 'Invalid result' },
        { scientificName: 'Missing key' },
      ])
    }

    if (url.pathname.endsWith('/species/search')) {
      return response({
        results: [
          { key: 1, scientificName: 'Canis lupus', rank: 'SPECIES' },
          { key: 3, scientificName: 'Unrelated species', rank: 'SPECIES' },
          { scientificName: 'Missing key' },
        ],
      })
    }

    if (url.pathname.endsWith('/species/1/vernacularNames')) {
      return response({
        results: [
          { language: 'eng', vernacularName: 'Gray Wolf' },
          { language: 'eng', vernacularName: 'Gray wolf' },
          { language: 'fra', vernacularName: 'Loup gris' },
        ],
      })
    }

    if (url.pathname.endsWith('/species/3/vernacularNames')) {
      return response({
        results: [{ language: 'eng', vernacularName: 'Red Fox' }],
      })
    }

    throw new Error(`Unexpected request: ${url}`)
  }

  const results = await searchSpecies('wolf', { fetchImpl })

  assert.equal(requestedUrls.find((url) => url.pathname.endsWith('/species/search')).searchParams.get('qField'), 'VERNACULAR')
  assert.deepEqual(results.scientific.map((species) => species.scientificName), ['Canis lupus', 'Invalid result'])
  assert.deepEqual(results.common, [
    {
      key: 1,
      scientificName: 'Canis lupus',
      rank: 'SPECIES',
      vernacularNames: ['Gray Wolf'],
    },
  ])
})

test('searchSpecies expands common names GBIF does not find reliably as single words', async () => {
  const searchTerms = []
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.pathname.endsWith('/species/suggest')) {
      return response([])
    }
    if (url.pathname.endsWith('/species/search')) {
      const term = url.searchParams.get('q')
      searchTerms.push(term)
      return response({
        results: term === 'gray wolf'
          ? [
              { key: 5219173, scientificName: 'Canis lupus Linnaeus, 1758', rank: 'SPECIES' },
              { key: 5, scientificName: 'Gray wolf moth', rank: 'SPECIES' },
            ]
          : [{ key: 4, scientificName: 'Wolf spider', rank: 'SPECIES' }],
      })
    }
    if (url.pathname.endsWith('/species/5219173/vernacularNames')) {
      return response({
        results: [{ language: 'eng', vernacularName: 'Gray Wolf' }],
      })
    }
    if (url.pathname.endsWith('/species/4/vernacularNames')) {
      return response({
        results: [{ language: 'eng', vernacularName: 'Thin-legged Wolf Spider' }],
      })
    }
    if (url.pathname.endsWith('/species/5/vernacularNames')) {
      return response({
        results: [{ language: 'eng', vernacularName: 'Gray Wolf Moth' }],
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const results = await searchSpecies('wolf', { fetchImpl })

  assert.deepEqual(searchTerms, ['wolf', 'gray wolf'])
  assert.deepEqual(results.common.slice(0, 3).map((species) => species.scientificName), [
    'Canis lupus Linnaeus, 1758',
    'Gray wolf moth',
    'Wolf spider',
  ])
})

test('searchSpecies ranks exact common-name matches and limits results', async () => {
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.pathname.endsWith('/species/suggest')) return response([])
    if (url.pathname.endsWith('/species/search')) {
      assert.equal(url.searchParams.get('limit'), '12')
      return response({
        results: Array.from({ length: 12 }, (_, index) => ({
          key: index + 100,
          scientificName: `Species ${index + 100}`,
        })),
      })
    }
    const key = Number(url.pathname.split('/').at(-2))
    return response({
      results: [{
        language: 'eng',
        vernacularName: key === 111 ? 'Jaguar' : `Jaguar flower moth ${key}`,
      }],
    })
  }

  const results = await searchSpecies('jaguar', { fetchImpl })

  assert.equal(results.common.length, 12)
  assert.equal(results.common[0].key, 111)
})

test('searchSpecies reports an unsuccessful GBIF response', async () => {
  await assert.rejects(
    searchSpecies('oak', { fetchImpl: async () => response({}, 503) }),
    /GBIF request failed \(503\)/,
  )
})
