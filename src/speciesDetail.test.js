import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSpeciesDetail } from './speciesDetail.js'

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function baseSpecies() {
  return {
    key: 42,
    scientificName: 'Canis lupus Linnaeus, 1758',
    canonicalName: 'Canis lupus',
    rank: 'SPECIES',
    taxonomicStatus: 'ACCEPTED',
    kingdom: 'Animalia',
  }
}

function createFetch({ photoResults = [], photoError = false } = {}) {
  const requestedUrls = []
  const fetchImpl = async (request) => {
    const url = new URL(request)
    requestedUrls.push(url)

    if (url.pathname.endsWith('/parents')) {
      return response([{ key: 1, canonicalName: 'Animalia', rank: 'KINGDOM' }])
    }
    if (url.pathname.endsWith('/vernacularNames')) {
      return response({
        results: [
          { language: 'eng', vernacularName: 'Gray Wolf' },
          { language: 'eng', vernacularName: 'gray wolf' },
          { language: 'fra', vernacularName: 'Loup gris' },
        ],
      })
    }
    if (url.pathname.endsWith('/taxa')) {
      if (photoError) return response({}, 503)
      return response({
        results: photoResults.length
          ? photoResults
          : [{
              name: 'Canis lupus',
              rank: 'species',
              preferred_common_name: 'Gray Wolf',
            }],
      })
    }
    if (url.pathname.endsWith('/observations')) return response({ results: [] })
    if (url.pathname.endsWith('/species/42')) return response(baseSpecies())
    throw new Error(`Unexpected request: ${url}`)
  }

  return { fetchImpl, requestedUrls }
}

test('loadSpeciesDetail combines GBIF classification and English names', async () => {
  const { fetchImpl, requestedUrls } = createFetch()
  const detail = await loadSpeciesDetail(42, { fetchImpl })

  assert.deepEqual(detail.vernacularNames, ['Gray Wolf'])
  assert.equal(detail.preferredCommonName, 'Gray Wolf')
  assert.deepEqual(detail.classification, [
    { key: 1, name: 'Animalia', rank: 'KINGDOM' },
    { key: 42, name: 'Canis lupus', rank: 'SPECIES' },
  ])
  assert.equal(detail.taxonomicStatus, 'ACCEPTED')
  assert.equal(detail.photo, null)
  assert.equal(requestedUrls.some((url) => url.searchParams.get('rank') === 'species'), true)
})

test('loadSpeciesDetail includes attribution and license for a matching CC photo', async () => {
  const photoResults = [
    {
      name: 'Canis familiaris',
      rank: 'species',
      id: 9001,
      default_photo: { id: 11, license_code: 'cc-by', medium_url: 'https://images.example/dog.jpg' },
    },
    {
      name: 'Canis lupus',
      rank: 'species',
      id: 9002,
      preferred_common_name: 'Gray Wolf',
      default_photo: {
        id: 12,
        license_code: 'cc-by-nc',
        medium_url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/12/medium.jpg',
        attribution: 'Photo by Alex (CC BY-NC)',
      },
    },
  ]
  const { fetchImpl } = createFetch({ photoResults })
  const detail = await loadSpeciesDetail(42, { fetchImpl })

  assert.deepEqual(detail.photo, {
    url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/12/medium.jpg',
    pageUrl: 'https://www.inaturalist.org/photos/12',
    attribution: 'Photo by Alex (CC BY-NC)',
    license: 'CC-BY-NC',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
    source: 'iNaturalist',
    subjectName: '',
    representative: false,
  })
  assert.equal(detail.preferredCommonName, 'Gray Wolf')
})

test('loadSpeciesDetail shows the exact tiger taxon photo with attribution and license', async () => {
  const tiger = {
    key: 5219416,
    scientificName: 'Panthera tigris (Linnaeus, 1758)',
    canonicalName: 'Panthera tigris',
    rank: 'SPECIES',
    taxonomicStatus: 'ACCEPTED',
    kingdom: 'Animalia',
  }
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.pathname.endsWith('/parents')) {
      return response([{ key: 1, canonicalName: 'Animalia', rank: 'KINGDOM' }])
    }
    if (url.pathname.endsWith('/vernacularNames')) return response({ results: [] })
    if (url.pathname.endsWith('/taxa')) {
      return response({
        results: [{
          name: 'Panthera tigris',
          rank: 'species',
          id: 41955,
          preferred_common_name: 'Tiger',
          default_photo: {
            id: 13207883,
            license_code: 'cc-by-nc',
            medium_url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/13207883/medium.jpg',
            attribution: 'Photo by contributor (CC BY-NC)',
          },
        }],
      })
    }
    if (url.pathname.endsWith('/species/5219416')) return response(tiger)
    throw new Error(`Unexpected request: ${url}`)
  }

  const detail = await loadSpeciesDetail(5219416, { fetchImpl })

  assert.equal(detail.preferredCommonName, 'Tiger')
  assert.equal(detail.photo.url, 'https://inaturalist-open-data.s3.amazonaws.com/photos/13207883/medium.jpg')
  assert.equal(detail.photo.license, 'CC-BY-NC')
  assert.equal(detail.photo.attribution, 'Photo by contributor (CC BY-NC)')
  assert.equal(detail.photo.source, 'iNaturalist')
})

test('loadSpeciesDetail leaves a clear no-photo fallback when no compatible image exists', async () => {
  const photoResults = [{
    name: 'Canis lupus',
    rank: 'species',
    id: 9002,
    default_photo: {
      id: 13,
      license_code: null,
      medium_url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/13/medium.jpg',
      attribution: 'All rights reserved',
    },
  }]
  const { fetchImpl } = createFetch({ photoResults })
  const detail = await loadSpeciesDetail(42, { fetchImpl })

  assert.equal(detail.photo, null)
  assert.equal(detail.photoError, '')
})

test('loadSpeciesDetail exposes a photo service error while keeping the taxon record available', async () => {
  const { fetchImpl } = createFetch({ photoError: true })
  const detail = await loadSpeciesDetail(42, { fetchImpl })

  assert.equal(detail.canonicalName, 'Canis lupus')
  assert.equal(detail.photo, null)
  assert.match(detail.photoError, /iNaturalist request failed \(503\)/)
})

test('loadSpeciesDetail reports GBIF errors and rejects invalid keys', async () => {
  await assert.rejects(
    loadSpeciesDetail('abc', { fetchImpl: async () => response({}) }),
    /Invalid species key/,
  )
  await assert.rejects(
    loadSpeciesDetail(42, { fetchImpl: async () => response({}, 503) }),
    /GBIF request failed \(503\)/,
  )
})

test('loadSpeciesDetail uses a selected taxon hint when its GBIF record is incomplete', async () => {
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.pathname.endsWith('/parents')) {
      return response([{ key: 1, canonicalName: 'Animalia', rank: 'KINGDOM' }])
    }
    if (url.pathname.endsWith('/vernacularNames')) return response({ results: [] })
    if (url.pathname.endsWith('/taxa')) return response({ results: [] })
    if (url.pathname.endsWith('/species/9415')) return response({})
    throw new Error(`Unexpected request: ${url}`)
  }

  const detail = await loadSpeciesDetail(9415, {
    fetchImpl,
    taxonHint: {
      key: 9415,
      canonicalName: 'Rhinocerotidae',
      scientificName: 'Rhinocerotidae',
      rank: 'FAMILY',
    },
  })

  assert.equal(detail.canonicalName, 'Rhinocerotidae')
  assert.equal(detail.rank, 'FAMILY')
  assert.equal(detail.classification.at(-1).key, 9415)
})

test('loadSpeciesDetail includes a confidently matched Wikipedia description', async () => {
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.hostname === 'api.gbif.org' && url.pathname.endsWith('/parents')) {
      return response([{ key: 1, canonicalName: 'Animalia', rank: 'KINGDOM' }])
    }
    if (url.hostname === 'api.gbif.org' && url.pathname.endsWith('/vernacularNames')) {
      return response({ results: [] })
    }
    if (url.hostname === 'api.gbif.org' && url.pathname.endsWith('/species/42')) {
      return response(baseSpecies())
    }
    if (url.hostname === 'api.inaturalist.org') return response({ results: [] })
    if (url.hostname === 'query.wikidata.org') {
      return response({
        results: {
          bindings: [{
            item: { value: 'http://www.wikidata.org/entity/Q999' },
            taxonName: { value: 'Canis lupus' },
            article: { value: 'https://en.wikipedia.org/wiki/Wolf' },
          }],
        },
      })
    }
    if (url.hostname === 'en.wikipedia.org') {
      return response({ title: 'Wolf', extract: 'The wolf is a large canine.' })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const detail = await loadSpeciesDetail(42, { fetchImpl })

  assert.deepEqual(detail.wikipedia, {
    title: 'Wolf',
    extract: 'The wolf is a large canine.',
    articleUrl: 'https://en.wikipedia.org/wiki/Wolf',
    wikidataUrl: 'http://www.wikidata.org/entity/Q999',
    image: null,
    matchedBy: 'gbif-key',
  })
  assert.equal(detail.wikipediaError, '')
})

function createAncestorFetch({ ownArticle = false } = {}) {
  const queries = []
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.hostname === 'api.gbif.org' && url.pathname.endsWith('/parents')) {
      return response([
        { key: 1, canonicalName: 'Animalia', rank: 'KINGDOM' },
        { key: 7, canonicalName: 'Canidae', rank: 'FAMILY' },
        { key: 8, canonicalName: 'Canis', rank: 'GENUS' },
      ])
    }
    if (url.hostname === 'api.gbif.org' && url.pathname.endsWith('/vernacularNames')) {
      return response({ results: [] })
    }
    if (url.hostname === 'api.gbif.org' && url.pathname.endsWith('/species/42')) {
      return response(baseSpecies())
    }
    if (url.hostname === 'api.inaturalist.org') return response({ results: [] })
    if (url.hostname === 'query.wikidata.org') {
      const query = url.searchParams.get('query')
      queries.push(query)
      const own = query.includes('"42"')
      const genus = query.includes('"8"')
      if (own && !ownArticle) return response({ results: { bindings: [] } })
      const name = own ? 'Canis lupus' : genus ? 'Canis' : 'Canidae'
      return response({
        results: {
          bindings: [{
            item: { value: 'http://www.wikidata.org/entity/Q5' },
            taxonName: { value: name },
            article: { value: `https://en.wikipedia.org/wiki/${name.replace(' ', '_')}` },
          }],
        },
      })
    }
    if (url.hostname === 'en.wikipedia.org') {
      return response({ title: decodeURIComponent(url.pathname.split('/').pop()), extract: 'Text.' })
    }
    throw new Error(`Unexpected request: ${url}`)
  }
  return { fetchImpl, queries }
}

test('loadSpeciesDetail falls back to the nearest labelled ancestor description', async () => {
  const { fetchImpl, queries } = createAncestorFetch()
  const detail = await loadSpeciesDetail(42, { fetchImpl })

  assert.equal(detail.wikipedia, null)
  assert.equal(detail.ancestorDescription.ancestorName, 'Canis')
  assert.equal(detail.ancestorDescription.ancestorRank, 'GENUS')
  assert.equal(detail.wikipediaError, '')
  assert.ok(!queries.some((query) => query.includes('"1"')))
})

test('loadSpeciesDetail does not use an ancestor when the taxon has its own article', async () => {
  const { fetchImpl } = createAncestorFetch({ ownArticle: true })
  const detail = await loadSpeciesDetail(42, { fetchImpl })

  assert.equal(detail.wikipedia.title, 'Canis_lupus')
  assert.equal(detail.ancestorDescription, null)
})

test('loadSpeciesDetail adds sections, quick facts and a species count, keeping failures separate', async () => {
  const genus = { ...baseSpecies(), canonicalName: 'Canis', scientificName: 'Canis Linnaeus, 1758', rank: 'GENUS' }
  let factsFail = false
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.hostname === 'api.gbif.org' && url.pathname.endsWith('/parents')) {
      return response([{ key: 1, canonicalName: 'Animalia', rank: 'KINGDOM' }])
    }
    if (url.hostname === 'api.gbif.org' && url.pathname.endsWith('/vernacularNames')) {
      return response({ results: [] })
    }
    if (url.hostname === 'api.gbif.org' && url.pathname.endsWith('/species/search')) {
      if (url.searchParams.get('q')) {
        return response({ results: [{ key: 42, canonicalName: 'Canis', extinct: false }] })
      }
      assert.equal(url.searchParams.get('highertaxonKey'), '42')
      assert.equal(url.searchParams.get('rank'), 'SPECIES')
      return response({ count: 7 })
    }
    if (url.hostname === 'api.gbif.org') return response(genus)
    if (url.hostname === 'api.inaturalist.org') return response({ results: [] })
    if (url.hostname === 'query.wikidata.org') {
      const query = url.searchParams.get('query')
      if (query.includes('wdt:P141')) {
        return factsFail
          ? response({}, 503)
          : response({ results: { bindings: [{ fact: { value: 'status' }, valueLabel: { value: 'Least concern' } }] } })
      }
      return response({
        results: {
          bindings: [{
            item: { value: 'http://www.wikidata.org/entity/Q5' },
            taxonName: { value: 'Canis' },
            article: { value: 'https://en.wikipedia.org/wiki/Canis' },
          }],
        },
      })
    }
    if (url.pathname === '/w/api.php') {
      return response({
        query: {
          pages: [{
            extract: `== Description ==\n${'Members are medium-sized canids. '.repeat(5)}`,
          }],
        },
      })
    }
    return response({ title: 'Canis', extract: 'Canis is a genus.' })
  }

  const detail = await loadSpeciesDetail(42, { fetchImpl })
  assert.equal(detail.speciesCount, 7)
  assert.deepEqual(detail.sections.map((section) => section.id), ['description'])
  assert.deepEqual(detail.quickFacts.map((fact) => fact.values), [['Least concern']])
  assert.deepEqual(detail.sourceErrors, [])

  factsFail = true
  const failed = await loadSpeciesDetail(42, { fetchImpl: async (r) => fetchImpl(r) })
  assert.equal(failed.wikipedia.title, 'Canis')
  assert.match(failed.sourceErrors[0], /facts request failed \(503\)/)
})
