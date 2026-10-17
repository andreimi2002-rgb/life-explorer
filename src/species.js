const GBIF_API = 'https://api.gbif.org/v1'
const GBIF_BACKBONE_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c'
const RESULT_LIMIT = 8

async function readResponse(response) {
  if (!response.ok) {
    throw new Error(`GBIF request failed (${response.status})`)
  }

  return response.json()
}

export async function searchSpecies(query, { signal, fetchImpl = fetch } = {}) {
  const term = query.trim()
  if (term.length < 2) return { scientific: [], common: [] }

  const scientificUrl = new URL(`${GBIF_API}/species/suggest`)
  scientificUrl.search = new URLSearchParams({ q: term, limit: String(RESULT_LIMIT) })

  const commonUrl = new URL(`${GBIF_API}/species/search`)
  commonUrl.search = new URLSearchParams({
    q: term,
    qField: 'VERNACULAR',
    datasetKey: GBIF_BACKBONE_KEY,
    limit: String(RESULT_LIMIT),
  })

  const [scientificResponse, commonResponse] = await Promise.all([
    fetchImpl(scientificUrl, { signal }),
    fetchImpl(commonUrl, { signal }),
  ])
  const [scientificData, commonData] = await Promise.all([
    readResponse(scientificResponse),
    readResponse(commonResponse),
  ])

  if (!Array.isArray(scientificData) || !Array.isArray(commonData.results)) {
    throw new Error('GBIF returned an unexpected search response')
  }

  const common = await Promise.all(
    commonData.results
      .filter((species) => Number.isInteger(species.key) && species.scientificName)
      .map(async (species) => {
        const namesUrl = new URL(`${GBIF_API}/species/${species.key}/vernacularNames`)
        namesUrl.search = new URLSearchParams({ limit: '100' })
        const namesResponse = await fetchImpl(namesUrl, { signal })
        const namesData = await readResponse(namesResponse)

        if (!Array.isArray(namesData.results)) {
          throw new Error('GBIF returned an unexpected vernacular-name response')
        }

        const matchingNames = namesData.results
          .filter((name) => name.language === 'eng' && typeof name.vernacularName === 'string')
          .map((name) => name.vernacularName)
          .filter((name, index, names) =>
            name.toLocaleLowerCase().includes(term.toLocaleLowerCase()) &&
            names.findIndex((candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase()) === index,
          )

        return matchingNames.length
          ? { ...species, vernacularNames: matchingNames }
          : null
      }),
  )

  return {
    scientific: scientificData.filter(
      (species) => Number.isInteger(species.key) && species.scientificName,
    ),
    common: common.filter(Boolean),
  }
}
