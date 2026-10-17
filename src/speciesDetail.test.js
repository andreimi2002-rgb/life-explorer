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
      default_photo: { id: 11, license_code: 'cc-by', medium_url: 'https://images.example/dog.jpg' },
    },
    {
      name: 'Canis lupus',
      rank: 'species',
      preferred_common_name: 'Gray Wolf',
      default_photo: {
        id: 12,
        license_code: 'cc-by-nc',
        medium_url: 'https://images.example/wolf.jpg',
        attribution: 'Photo by Alex (CC BY-NC)',
      },
    },
  ]
  const { fetchImpl } = createFetch({ photoResults })
  const detail = await loadSpeciesDetail(42, { fetchImpl })

  assert.deepEqual(detail.photo, {
    url: 'https://images.example/wolf.jpg',
    pageUrl: 'https://www.inaturalist.org/photos/12',
    attribution: 'Photo by Alex (CC BY-NC)',
    license: 'CC-BY-NC',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
  })
  assert.equal(detail.preferredCommonName, 'Gray Wolf')
})

test('loadSpeciesDetail leaves a clear no-photo fallback when no compatible image exists', async () => {
  const photoResults = [{
    name: 'Canis lupus',
    rank: 'species',
    default_photo: {
      id: 13,
      license_code: null,
      medium_url: 'https://images.example/unlicensed.jpg',
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
  assert.match(detail.photoError, /Species data request failed \(503\)/)
})

test('loadSpeciesDetail reports GBIF errors and rejects invalid keys', async () => {
  await assert.rejects(
    loadSpeciesDetail('abc', { fetchImpl: async () => response({}) }),
    /Invalid species key/,
  )
  await assert.rejects(
    loadSpeciesDetail(42, { fetchImpl: async () => response({}, 503) }),
    /Species data request failed \(503\)/,
  )
})
