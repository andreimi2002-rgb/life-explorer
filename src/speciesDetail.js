const GBIF_API = 'https://api.gbif.org/v1'
const INATURALIST_API = 'https://api.inaturalist.org/v1'
const PHOTO_LICENSES = new Set([
  'cc0',
  'cc-by',
  'cc-by-sa',
  'cc-by-nc',
  'cc-by-nc-sa',
  'cc-by-nd',
  'cc-by-nc-nd',
])

async function readResponse(response) {
  if (!response.ok) {
    throw new Error(`Species data request failed (${response.status})`)
  }

  return response.json()
}

function getLicenseUrl(licenseCode) {
  return licenseCode === 'cc0'
    ? 'https://creativecommons.org/publicdomain/zero/1.0/'
    : `https://creativecommons.org/licenses/${licenseCode.replace('cc-', '')}/4.0/`
}

async function loadLicensedPhoto(species, { signal, fetchImpl }) {
  const url = new URL(`${INATURALIST_API}/taxa`)
  url.search = new URLSearchParams({
    q: species.canonicalName,
    rank: species.rank.toLocaleLowerCase(),
    per_page: '20',
  })
  const response = await fetchImpl(url, { signal })
  const data = await readResponse(response)

  if (!Array.isArray(data.results)) {
    throw new Error('iNaturalist returned an unexpected photo response')
  }

  const taxa = data.results.filter((taxon) =>
    taxon.name === species.canonicalName &&
    taxon.rank?.toLocaleUpperCase() === species.rank,
  )
  const preferredCommonName = taxa.find((taxon) => taxon.preferred_common_name)
    ?.preferred_common_name || ''
  const match = taxa.find((taxon) =>
    taxon.default_photo &&
    typeof taxon.default_photo.attribution === 'string' &&
    taxon.default_photo.attribution.trim() &&
    PHOTO_LICENSES.has(taxon.default_photo.license_code),
  )

  if (!match) return { photo: null, preferredCommonName }

  const photo = match.default_photo
  return {
    photo: {
      url: photo.medium_url || photo.url,
      pageUrl: `https://www.inaturalist.org/photos/${photo.id}`,
      attribution: photo.attribution,
      license: photo.license_code.toLocaleUpperCase(),
      licenseUrl: getLicenseUrl(photo.license_code),
    },
    preferredCommonName,
  }
}

export async function loadSpeciesDetail(key, { signal, fetchImpl = fetch } = {}) {
  if (!Number.isInteger(Number(key)) || Number(key) < 1) {
    throw new Error('Invalid species key')
  }

  const baseUrl = `${GBIF_API}/species/${Number(key)}`
  const [speciesResponse, parentsResponse, namesResponse] = await Promise.all([
    fetchImpl(new URL(baseUrl), { signal }),
    fetchImpl(new URL(`${baseUrl}/parents`), { signal }),
    fetchImpl(new URL(`${baseUrl}/vernacularNames?limit=100`), { signal }),
  ])
  const [species, parents, names] = await Promise.all([
    readResponse(speciesResponse),
    readResponse(parentsResponse),
    readResponse(namesResponse),
  ])

  if (!species.canonicalName || !species.scientificName || !species.rank) {
    throw new Error('GBIF returned incomplete species data')
  }
  if (!Array.isArray(parents) || !Array.isArray(names.results)) {
    throw new Error('GBIF returned an unexpected classification response')
  }

  const vernacularNames = names.results
    .filter((name) => name.language === 'eng' && typeof name.vernacularName === 'string')
    .map((name) => name.vernacularName)
    .filter((name, index, allNames) =>
      allNames.findIndex((candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase()) === index,
    )

  let photo = null
  let photoError = ''
  let preferredCommonName = ''
  try {
    const iNaturalist = await loadLicensedPhoto(species, { signal, fetchImpl })
    photo = iNaturalist.photo
    preferredCommonName = iNaturalist.preferredCommonName
  } catch (error) {
    if (signal?.aborted) throw error
    photoError = error.message
  }

  return {
    ...species,
    vernacularNames,
    preferredCommonName,
    classification: [
      ...parents.map((parent) => ({
        key: parent.key,
        name: parent.canonicalName || parent.scientificName,
        rank: parent.rank,
      })),
      { key: species.key, name: species.canonicalName, rank: species.rank },
    ],
    photo,
    photoError,
  }
}
