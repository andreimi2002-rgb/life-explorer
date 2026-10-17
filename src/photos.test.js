import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePhoto } from './photos.js'

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function commonsResponse({
  artist = '<a href="https://commons.wikimedia.org/wiki/User:Example">Example</a>',
  license = 'CC BY-SA 4.0',
  licenseUrl = 'https://creativecommons.org/licenses/by-sa/4.0/',
  imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/1/12/Animal.jpg',
} = {}) {
  return response({
    query: {
      pages: {
        1: {
          title: 'File:Animal.jpg',
          imageinfo: [{
            thumburl: imageUrl,
            url: imageUrl,
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Animal.jpg',
            extmetadata: {
              Artist: { value: artist },
              LicenseShortName: { value: license },
              LicenseUrl: { value: licenseUrl },
            },
          }],
        },
      },
    },
  })
}

function taxon(overrides = {}) {
  return {
    key: 1,
    canonicalName: 'Acinonyx jubatus',
    rank: 'SPECIES',
    ...overrides,
  }
}

function iNaturalistTaxa({
  photo = null,
  id = 41955,
  name = 'Acinonyx jubatus',
  rank = 'species',
} = {}) {
  return response({
    results: [{
      id,
      name,
      rank,
      preferred_common_name: 'Cheetah',
      default_photo: photo,
    }],
  })
}

test('resolvePhoto prefers a Commons image with verified author and licence', async () => {
  const requested = []
  const fetchImpl = async (request) => {
    const url = new URL(request)
    requested.push(url)
    if (url.hostname === 'commons.wikimedia.org') return commonsResponse()
    throw new Error(`Unexpected request: ${url}`)
  }

  const result = await resolvePhoto(taxon(), {
    wikipedia: { image: { filename: 'Animal.jpg' } },
    fetchImpl,
  })

  assert.equal(requested[0].searchParams.get('origin'), '*')
  assert.deepEqual(result.photo, {
    url: 'https://upload.wikimedia.org/wikipedia/commons/1/12/Animal.jpg',
    pageUrl: 'https://commons.wikimedia.org/wiki/File:Animal.jpg',
    attribution: 'Example',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    source: 'Wikimedia Commons',
    representative: false,
  })
  assert.equal(requested.length, 1)
})

test('resolvePhoto rejects a Commons map image and falls back to a licensed observation', async () => {
  const requested = []
  const fetchImpl = async (request) => {
    const url = new URL(request)
    requested.push(url)
    if (url.hostname === 'api.inaturalist.org' && url.pathname.endsWith('/taxa')) {
      return iNaturalistTaxa({
        photo: {
          id: 9,
          license_code: null,
          attribution: '',
          medium_url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/9/medium.jpg',
        },
      })
    }
    if (url.hostname === 'api.inaturalist.org' && url.pathname.endsWith('/observations')) {
      return response({
        results: [{
          taxon: { name: 'Acinonyx jubatus' },
          photos: [{
            id: 77,
            license_code: 'cc-by',
            attribution: 'Photo by Ada (CC BY)',
            url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/77/square.jpg',
          }],
        }],
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const result = await resolvePhoto(taxon(), {
    wikipedia: { image: { filename: 'Cheetah_distribution_map.jpg' } },
    fetchImpl,
  })

  assert.equal(result.photo.source, 'iNaturalist')
  assert.equal(result.photo.url, 'https://inaturalist-open-data.s3.amazonaws.com/photos/77/medium.jpg')
  assert.equal(result.photo.pageUrl, 'https://www.inaturalist.org/photos/77')
  assert.equal(result.photo.license, 'CC-BY')
  assert.equal(result.photo.attribution, 'Photo by Ada (CC BY)')
  assert.equal(requested.some((url) => url.hostname === 'commons.wikimedia.org'), false)
})

test('resolvePhoto labels an observed member species for a higher-rank taxon', async () => {
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.pathname.endsWith('/taxa')) {
      return response({
        results: [{
          id: 999,
          name: 'Panthera',
          rank: 'genus',
          default_photo: null,
        }],
      })
    }
    if (url.pathname.endsWith('/observations')) {
      return response({
        results: [{
          taxon: { name: 'Panthera leo' },
          photos: [{
            id: 88,
            license_code: 'cc-by-sa',
            attribution: 'Photo by Lee (CC BY-SA)',
            url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/88/square.jpg',
          }],
        }],
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const result = await resolvePhoto(taxon({
    canonicalName: 'Panthera',
    rank: 'GENUS',
  }), { fetchImpl })

  assert.equal(result.photo.subjectName, 'Panthera leo')
  assert.equal(result.photo.representative, true)
})

test('resolvePhoto skips SVGs and images without a reusable licence or author', async () => {
  let inatRequested = false
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.hostname === 'commons.wikimedia.org') return commonsResponse({ license: 'All rights reserved' })
    if (url.hostname === 'api.inaturalist.org') {
      inatRequested = true
      return iNaturalistTaxa()
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const svg = await resolvePhoto(taxon(), {
    wikipedia: { image: { filename: 'Diagram.svg' } },
    fetchImpl,
  })
  assert.equal(svg.photo, null)
  assert.equal(inatRequested, true)

  const noAuthor = await resolvePhoto(taxon(), {
    wikipedia: { image: { filename: 'Animal.jpg' } },
    fetchImpl: async (request) => {
      const url = new URL(request)
      if (url.hostname === 'commons.wikimedia.org') return commonsResponse({ artist: '' })
      return iNaturalistTaxa()
    },
  })
  assert.equal(noAuthor.photo, null)
})

test('resolvePhoto keeps a Commons error visible when no iNaturalist photo is available', async () => {
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.hostname === 'commons.wikimedia.org') return response({}, 503)
    if (url.pathname.endsWith('/taxa')) return iNaturalistTaxa()
    throw new Error(`Unexpected request: ${url}`)
  }

  const result = await resolvePhoto(taxon(), {
    wikipedia: { image: { filename: 'Animal.jpg' } },
    fetchImpl,
  })

  assert.equal(result.photo, null)
  assert.match(result.photoError, /Wikimedia Commons request failed \(503\)/)
})

test('resolvePhoto returns the no-photo fallback when a taxon has no verified images', async () => {
  const fetchImpl = async (request) => {
    const url = new URL(request)
    if (url.pathname.endsWith('/taxa')) return response({ results: [] })
    throw new Error(`Unexpected request: ${url}`)
  }

  const result = await resolvePhoto(taxon(), { fetchImpl })

  assert.equal(result.photo, null)
  assert.equal(result.photoError, '')
})
