import test from 'node:test'
import assert from 'node:assert/strict'
import { loadRandomTaxon, loadTaxonChildren, searchSpecies } from './species.js'

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

  assert.deepEqual(results, {
    scientific: [],
    common: [],
    commonCount: 0,
    commonOffset: 0,
    commonHasMore: false,
  })
  assert.equal(requestCount, 0)
})

test('searchSpecies returns scientific suggestions and matching English common names', async () => {
  const requestedUrls = []
  const fetchImpl = async (request) => {
    const url = new URL(request)
    requestedUrls.push(url)

    if (url.pathname.endsWith('/species/suggest')) {
      return response([
        {
          key: 1,
          scientificName: 'Canis lupus',
          canonicalName: 'Canis lupus',
          rank: 'SPECIES',
          status: 'ACCEPTED',
        },
        {
          key: 2,
          scientificName: 'Doubtful result',
          canonicalName: 'Doubtful result',
          rank: 'SPECIES',
          status: 'DOUBTFUL',
        },
        { scientificName: 'Missing key' },
      ])
    }

    if (url.pathname.endsWith('/species/search')) {
      return response({
        results: [
          {
            key: 1,
            scientificName: 'Canis lupus',
            canonicalName: 'Canis lupus',
            rank: 'SPECIES',
            taxonomicStatus: 'ACCEPTED',
          },
          {
            key: 3,
            scientificName: 'Red fox',
            canonicalName: 'Red fox',
            rank: 'SPECIES',
            taxonomicStatus: 'ACCEPTED',
          },
          { scientificName: 'Missing key' },
        ],
        count: 3,
        endOfRecords: true,
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
  assert.deepEqual(results.scientific.map((species) => species.scientificName), ['Canis lupus'])
  assert.deepEqual(results.common, [
    {
      key: 1,
      scientificName: 'Canis lupus',
      canonicalName: 'Canis lupus',
      rank: 'SPECIES',
      taxonomicStatus: 'ACCEPTED',
      vernacularNames: ['Gray Wolf'],
    },
  ])
  assert.equal(results.commonCount, 3)
  assert.equal(results.commonHasMore, false)
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
              {
                key: 5219173,
                scientificName: 'Canis lupus Linnaeus, 1758',
                canonicalName: 'Canis lupus',
                rank: 'SPECIES',
                taxonomicStatus: 'ACCEPTED',
              },
              {
                key: 5,
                scientificName: 'Gray wolf moth',
                canonicalName: 'Gray wolf moth',
                rank: 'SPECIES',
                taxonomicStatus: 'ACCEPTED',
              },
            ]
          : [{
              key: 4,
              scientificName: 'Wolf spider',
              canonicalName: 'Wolf spider',
              rank: 'SPECIES',
              taxonomicStatus: 'ACCEPTED',
            }],
        count: 1,
        endOfRecords: true,
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
          canonicalName: `Species ${index + 100}`,
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
        })),
        count: 13,
        endOfRecords: false,
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
  assert.equal(results.commonCount, 13)
  assert.equal(results.commonHasMore, true)
})

test('searchSpecies paginates common names using the requested offset', async () => {
  const searchOffsets = []
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.pathname.endsWith('/species/suggest')) return response([])
    if (url.pathname.endsWith('/species/search')) {
      searchOffsets.push(url.searchParams.get('offset'))
      return response({
        results: [{
          key: 61,
          scientificName: 'Panthera leo',
          canonicalName: 'Panthera leo',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
        }],
        count: 30,
        endOfRecords: false,
      })
    }
    if (url.pathname.endsWith('/species/61/vernacularNames')) {
      return response({ results: [{ language: 'eng', vernacularName: 'Lion' }] })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const results = await searchSpecies('lion', { fetchImpl, commonOffset: 12 })

  assert.deepEqual(searchOffsets, ['12'])
  assert.equal(results.commonOffset, 12)
  assert.equal(results.commonHasMore, true)
})

test('searchSpecies expands the rhino common-name search to rhinoceros', async () => {
  const searchTerms = []
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.pathname.endsWith('/species/suggest')) return response([])
    if (url.pathname.endsWith('/species/search')) {
      const term = url.searchParams.get('q')
      searchTerms.push(term)
      return response({
        results: term === 'rhinoceros'
          ? [{
              key: 9415,
              scientificName: 'Rhinocerotidae',
              canonicalName: 'Rhinocerotidae',
              rank: 'FAMILY',
              taxonomicStatus: 'ACCEPTED',
            }]
          : [],
        count: 1,
        endOfRecords: true,
      })
    }
    if (url.pathname.endsWith('/species/9415/vernacularNames')) {
      return response({ results: [{ language: 'eng', vernacularName: 'Rhinoceros' }] })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const results = await searchSpecies('rhino', { fetchImpl })

  assert.deepEqual(searchTerms, ['rhino', 'rhinoceros'])
  assert.equal(results.common[0].key, 9415)
})

test('searchSpecies finds common-name matches iNaturalist has but GBIF search misses', async () => {
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.pathname.endsWith('/species/suggest')) return response([])
    if (url.pathname.endsWith('/species/search')) {
      return response({ results: [], count: 0, endOfRecords: true })
    }
    if (url.hostname === 'api.inaturalist.org') {
      return response({
        results: [{
          name: 'Panthera tigris',
          rank: 'species',
          preferred_common_name: 'Tiger',
          observations_count: 9000,
        }],
      })
    }
    if (url.pathname.endsWith('/species/match')) {
      assert.equal(url.searchParams.get('name'), 'Panthera tigris')
      return response({
        usageKey: 5219416,
        scientificName: 'Panthera tigris (Linnaeus, 1758)',
        canonicalName: 'Panthera tigris',
        rank: 'SPECIES',
        status: 'ACCEPTED',
        matchType: 'EXACT',
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const results = await searchSpecies('tiger', { fetchImpl })

  assert.equal(results.common[0].key, 5219416)
  assert.equal(results.common[0].preferredCommonName, 'Tiger')
  assert.deepEqual(results.common[0].vernacularNames, ['Tiger'])
  assert.equal(results.common[0].commonNameSource, 'iNaturalist')
})

test('searchSpecies adds an English common name to an exact scientific-name result', async () => {
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.pathname.endsWith('/species/suggest')) {
      return response([{
        key: 5219416,
        scientificName: 'Panthera tigris (Linnaeus, 1758)',
        canonicalName: 'Panthera tigris',
        rank: 'SPECIES',
        status: 'ACCEPTED',
      }])
    }
    if (url.pathname.endsWith('/species/search')) {
      return response({ results: [], count: 0, endOfRecords: true })
    }
    if (url.hostname === 'api.inaturalist.org') {
      return response({
        results: [{
          name: 'Panthera tigris',
          rank: 'species',
          preferred_common_name: 'Tiger',
          observations_count: 9000,
        }],
      })
    }
    if (url.pathname.endsWith('/species/match')) {
      return response({
        usageKey: 5219416,
        scientificName: 'Panthera tigris (Linnaeus, 1758)',
        canonicalName: 'Panthera tigris',
        rank: 'SPECIES',
        status: 'ACCEPTED',
        matchType: 'EXACT',
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const results = await searchSpecies('Panthera tigris', { fetchImpl })

  assert.equal(results.scientific[0].preferredCommonName, 'Tiger')
  assert.deepEqual(results.common, [])
})

test('searchSpecies keeps GBIF results and exposes an iNaturalist search warning', async () => {
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.pathname.endsWith('/species/suggest')) return response([])
    if (url.pathname.endsWith('/species/search')) {
      return response({ results: [], count: 0, endOfRecords: true })
    }
    if (url.hostname === 'api.inaturalist.org') return response({}, 503)
    throw new Error(`Unexpected request: ${url}`)
  }

  const results = await searchSpecies('tiger', { fetchImpl })

  assert.match(results.commonNameWarning, /iNaturalist search failed \(503\)/)
})

test('searchSpecies reports an unsuccessful GBIF response', async () => {
  await assert.rejects(
    searchSpecies('oak', { fetchImpl: async () => response({}, 503) }),
    /GBIF request failed \(503\)/,
  )
})

test('loadTaxonChildren returns navigable taxon records and page metadata', async () => {
  const requestedUrl = []
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.pathname.endsWith('/species/search')) {
      return response({
        results: url.searchParams.get('isExtinct') === 'true' ? [] : [{ key: 9416 }],
        endOfRecords: true,
      })
    }
    requestedUrl.push(url)
    return response({
      results: [
        {
          key: 9416,
          canonicalName: 'Rhinoceros',
          scientificName: 'Rhinoceros Linnaeus, 1758',
          rank: 'GENUS',
          taxonomicStatus: 'ACCEPTED',
        },
        {
          key: 9418,
          canonicalName: 'BOLD:ADL8888',
          scientificName: 'BOLD:ADL8888',
          rank: 'UNRANKED',
          taxonomicStatus: 'ACCEPTED',
        },
        {
          key: 9419,
          canonicalName: 'Doubtful genus',
          scientificName: 'Doubtful genus',
          rank: 'GENUS',
          taxonomicStatus: 'DOUBTFUL',
        },
        { key: 0, canonicalName: 'Invalid key', scientificName: 'Invalid key', rank: 'GENUS', taxonomicStatus: 'ACCEPTED' },
        { key: 9417, name: 'Missing rank' },
      ],
      offset: 24,
      limit: 24,
      endOfRecords: false,
    })
  }

  const page = await loadTaxonChildren(9415, { fetchImpl, offset: 24, limit: 24 })

  assert.deepEqual(page.results, [{
    key: 9416,
    canonicalName: 'Rhinoceros',
    scientificName: 'Rhinoceros Linnaeus, 1758',
    rank: 'GENUS',
    taxonomicStatus: 'ACCEPTED',
    extinctState: 'living',
  }])
  assert.equal(page.offset, 24)
  assert.equal(page.endOfRecords, false)
  assert.equal(requestedUrl[0].pathname, '/v1/species/9415/children')
  assert.equal(requestedUrl[0].searchParams.get('offset'), '24')
})

test('loadTaxonChildren rejects invalid keys and malformed responses', async () => {
  await assert.rejects(
    loadTaxonChildren('not-a-key', { fetchImpl: async () => response({ results: [] }) }),
    /Invalid taxon key/,
  )
  await assert.rejects(
    loadTaxonChildren(9415, { fetchImpl: async () => response({}) }),
    /unexpected child-taxa response/,
  )
})

test('loadRandomTaxon checks candidates until it finds one with information', async () => {
  const requested = []
  const fetchImpl = async (request) => {
    const url = new URL(request)
    requested.push(url)
    if (url.pathname.endsWith('/species/search') && url.searchParams.get('limit') === '0') {
      return response({ count: 100 })
    }
    if (url.pathname.endsWith('/species/search')) {
      return response({
        results: [
          { key: 101, canonicalName: 'Species alpha', scientificName: 'Species alpha', rank: 'SPECIES', taxonomicStatus: 'ACCEPTED' },
          { key: 102, canonicalName: 'Species beta', scientificName: 'Species beta', rank: 'SPECIES', taxonomicStatus: 'ACCEPTED' },
        ],
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const result = await loadRandomTaxon(1, {
    extinct: 'living',
    fetchImpl,
    random: () => 0,
    avoidOrderKey: 6,
    inspectTaxon: async (taxon) => {
      const information = {
        hasInformation: true,
        orderKey: taxon.key === 101 ? 5 : 6,
      }
      return information
    },
  })

  assert.equal(result.taxon.key, 101)
  assert.equal(result.information.hasInformation, true)
  assert.equal(result.checked, 2)
  const selection = requested.find((url) => url.searchParams.get('limit') === '12')
  assert.equal(selection.searchParams.get('highertaxonKey'), '1')
  assert.equal(selection.searchParams.get('isExtinct'), 'false')
})

test('loadRandomTaxon reports when no sampled species has verified information', async () => {
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.searchParams.get('limit') === '0') return response({ count: 1 })
    return response({
      results: [{
        key: 201,
        canonicalName: 'Species without content',
        scientificName: 'Species without content',
        rank: 'SPECIES',
        taxonomicStatus: 'ACCEPTED',
      }],
    })
  }

  await assert.rejects(
    loadRandomTaxon('', {
      fetchImpl,
      random: () => 0,
      maxCandidates: 1,
      inspectTaxon: async () => null,
    }),
    /No random species with a verified photo or description was found/,
  )
})
