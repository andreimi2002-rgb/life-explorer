const INATURALIST_API = 'https://api.inaturalist.org/v1'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const PHOTO_LICENSES = new Set([
  'cc0',
  'cc-by',
  'cc-by-sa',
  'cc-by-nc',
  'cc-by-nc-sa',
  'cc-by-nd',
  'cc-by-nc-nd',
])
const REJECTED_IMAGE_NAME = /\b(map|range|distribution|skull|fossil|diagram|cladogram|phylogen|skeleton|bone|reconstruction|illustration|artwork)\b/i

async function readResponse(response, source) {
  if (!response.ok) {
    throw new Error(`${source} request failed (${response.status})`)
  }
  return response.json()
}

function getLicenseUrl(licenseCode) {
  return licenseCode === 'cc0'
    ? 'https://creativecommons.org/publicdomain/zero/1.0/'
    : `https://creativecommons.org/licenses/${licenseCode.replace('cc-', '')}/4.0/`
}

function getSafeImageUrl(value, hosts) {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && hosts.has(url.hostname) ? url.toString() : ''
  } catch {
    return ''
  }
}

function htmlToText(value = '') {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}

function hasUsefulImageName(filename) {
  return typeof filename === 'string' &&
    !/\.svgz?$/i.test(filename) &&
    !REJECTED_IMAGE_NAME.test(filename.replace(/[_-]+/g, ' '))
}

function isAcceptedCommonsLicense(name = '') {
  return /^(?:CC0(?:\s|$)|CC BY(?:-SA)?(?:\s|$)|Public domain(?:\s|$))/i.test(name.trim())
}

async function loadCommonsPhoto(image, { signal, fetchImpl }) {
  if (!image?.filename || !hasUsefulImageName(image.filename)) return null

  const url = new URL(COMMONS_API)
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1200',
    origin: '*',
    titles: `File:${image.filename}`,
  })
  const response = await fetchImpl(url, {
    signal,
    headers: { Accept: 'application/json' },
  })
  const data = await readResponse(response, 'Wikimedia Commons')
  const pages = data.query?.pages
  if (!pages || typeof pages !== 'object') {
    throw new Error('Wikimedia Commons returned an unexpected image response')
  }

  const page = Object.values(pages).find((candidate) =>
    Array.isArray(candidate.imageinfo) && candidate.imageinfo.length > 0,
  )
  const info = page?.imageinfo?.[0]
  const metadata = info?.extmetadata
  const license = htmlToText(metadata?.LicenseShortName?.value)
  const attribution = htmlToText(metadata?.Artist?.value)
  const licenseUrl = getSafeImageUrl(metadata?.LicenseUrl?.value, new Set([
    'creativecommons.org',
  ]))
  const photoUrl = getSafeImageUrl(info?.thumburl || info?.url, new Set([
    'thumb.wikimedia.org',
    'upload.wikimedia.org',
  ]))
  const pageUrl = getSafeImageUrl(info?.descriptionurl, new Set([
    'commons.wikimedia.org',
  ]))

  if (!photoUrl || !pageUrl || !attribution || !license || !licenseUrl ||
      !isAcceptedCommonsLicense(license)) {
    return null
  }

  return {
    url: photoUrl,
    pageUrl,
    attribution,
    license,
    licenseUrl,
    source: 'Wikimedia Commons',
  }
}

function licensedINaturalistPhoto(photo, photoTaxon, requestedTaxon) {
  if (
    !photo ||
    typeof photo.attribution !== 'string' ||
    !photo.attribution.trim() ||
    !PHOTO_LICENSES.has(photo.license_code)
  ) {
    return null
  }
  const url = getSafeImageUrl(photo.medium_url || photo.url, new Set([
    'inaturalist-open-data.s3.amazonaws.com',
    'static.inaturalist.org',
    'photos.inaturalist.org',
  ]))
  if (!url || !Number.isInteger(Number(photo.id)) || Number(photo.id) < 1) return null

  return {
    url: url.replace(/\/(?:square|small)\./, '/medium.'),
    pageUrl: `https://www.inaturalist.org/photos/${Number(photo.id)}`,
    attribution: photo.attribution.trim(),
    license: photo.license_code.toLocaleUpperCase(),
    licenseUrl: getLicenseUrl(photo.license_code),
    source: 'iNaturalist',
    subjectName: photoTaxon?.name && photoTaxon.name !== requestedTaxon.canonicalName
      ? photoTaxon.name
      : '',
    representative: !['SPECIES', 'SUBSPECIES'].includes(requestedTaxon.rank),
  }
}

async function loadINaturalistPhoto(taxon, { signal, fetchImpl }) {
  const url = new URL(`${INATURALIST_API}/taxa`)
  url.search = new URLSearchParams({
    q: taxon.canonicalName,
    rank: taxon.rank.toLocaleLowerCase(),
    per_page: '20',
  })
  const response = await fetchImpl(url, { signal })
  const data = await readResponse(response, 'iNaturalist')
  if (!Array.isArray(data.results)) {
    throw new Error('iNaturalist returned an unexpected taxon response')
  }

  const taxa = data.results.filter((result) =>
    result.name === taxon.canonicalName &&
    result.rank?.toLocaleUpperCase() === taxon.rank,
  )
  const preferredCommonName = taxa.find((result) => result.preferred_common_name)
    ?.preferred_common_name || ''
  const exactTaxon = taxa.find((result) => Number.isInteger(Number(result.id)))
  const defaultPhoto = exactTaxon?.default_photo
  const selectedDefault = licensedINaturalistPhoto(defaultPhoto, {
    name: taxon.canonicalName,
  }, taxon)
  if (selectedDefault) {
    return { photo: selectedDefault, preferredCommonName }
  }
  if (!exactTaxon) return { photo: null, preferredCommonName }

  const observationsUrl = new URL(`${INATURALIST_API}/observations`)
  observationsUrl.search = new URLSearchParams({
    taxon_id: String(exactTaxon.id),
    photos: 'true',
    photo_license: [...PHOTO_LICENSES].join(','),
    per_page: '30',
    order: 'desc',
    order_by: 'created_at',
  })
  const observationsResponse = await fetchImpl(observationsUrl, { signal })
  const observations = await readResponse(observationsResponse, 'iNaturalist')
  if (!Array.isArray(observations.results)) {
    throw new Error('iNaturalist returned an unexpected observation response')
  }

  for (const observation of observations.results) {
    const subjectName = observation.taxon?.name || taxon.canonicalName
    for (const photo of observation.photos || []) {
      const selectedPhoto = licensedINaturalistPhoto(photo, {
        name: subjectName,
      }, taxon)
      if (selectedPhoto) {
        return { photo: selectedPhoto, preferredCommonName }
      }
    }
  }
  return { photo: null, preferredCommonName }
}

export async function resolvePhoto(taxon, {
  wikipedia,
  signal,
  fetchImpl = fetch,
} = {}) {
  const errors = []
  if (wikipedia?.image) {
    try {
      const photo = await loadCommonsPhoto(wikipedia.image, { signal, fetchImpl })
      if (photo) {
        return {
          photo: {
            ...photo,
            representative: !['SPECIES', 'SUBSPECIES'].includes(taxon.rank),
          },
          preferredCommonName: '',
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error
      errors.push(error.message)
    }
  }

  try {
    const iNaturalist = await loadINaturalistPhoto(taxon, { signal, fetchImpl })
    if (iNaturalist.photo || !errors.length) {
      return { ...iNaturalist, photoError: '' }
    }
    return {
      ...iNaturalist,
      photoError: errors.join('; '),
    }
  } catch (error) {
    if (signal?.aborted) throw error
    errors.push(error.message)
    return {
      photo: null,
      preferredCommonName: '',
      photoError: errors.join('; '),
    }
  }
}
