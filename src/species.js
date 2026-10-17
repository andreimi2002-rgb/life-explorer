const GBIF_API = 'https://api.gbif.org/v1'
const GBIF_BACKBONE_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c'
const RESULT_LIMIT = 12
const COMMON_NAME_ALIASES = new Map([
  ['wolf', ['gray wolf']],
  ['mouse', ['house mouse']],
])

async function readResponse(response) {
  if (!response.ok) {
    throw new Error(`GBIF request failed (${response.status})`)
  }

  return response.json()
}

function commonNameScore(names, term) {
  const normalizedTerm = term.toLocaleLowerCase()
  return Math.max(...names.map((name) => {
    const normalizedName = name.toLocaleLowerCase()
    if (normalizedName === normalizedTerm) return 3
    if (normalizedName.startsWith(`${normalizedTerm} `)) return 2
    if (normalizedName.split(/\W+/).includes(normalizedTerm)) return 1
    return 0
  }))
}

export async function searchSpecies(query, { signal, fetchImpl = fetch } = {}) {
  const term = query.trim()
  if (term.length < 2) return { scientific: [], common: [] }

  const scientificUrl = new URL(`${GBIF_API}/species/suggest`)
  scientificUrl.search = new URLSearchParams({ q: term, limit: String(RESULT_LIMIT) })

  const commonUrl = new URL(`${GBIF_API}/species/search`)
  const commonTerms = [term, ...(COMMON_NAME_ALIASES.get(term.toLocaleLowerCase()) || [])]
  const commonUrls = commonTerms.map((commonTerm) => {
    const url = new URL(commonUrl)
    url.search = new URLSearchParams({
      q: commonTerm,
      qField: 'VERNACULAR',
      datasetKey: GBIF_BACKBONE_KEY,
      limit: String(RESULT_LIMIT),
    })
    return url
  })

  const [scientificResponse, ...commonResponses] = await Promise.all([
    fetchImpl(scientificUrl, { signal }),
    ...commonUrls.map((url) => fetchImpl(url, { signal })),
  ])
  const [scientificData, ...commonData] = await Promise.all([
    readResponse(scientificResponse),
    ...commonResponses.map(readResponse),
  ])

  if (!Array.isArray(scientificData) || commonData.some((data) => !Array.isArray(data.results))) {
    throw new Error('GBIF returned an unexpected search response')
  }

  const commonCandidates = new Map()
  for (const [queryIndex, data] of commonData.entries()) {
    for (const species of data.results) {
      if (Number.isInteger(species.key) && species.scientificName) {
        if (!commonCandidates.has(species.key)) {
          commonCandidates.set(species.key, { species, queryIndex })
        }
      }
    }
  }

  const common = await Promise.all(
    [...commonCandidates.values()]
      .map(async ({ species, queryIndex }) => {
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
          ? { ...species, vernacularNames: matchingNames, queryIndex }
          : null
      }),
  )
  const matchingCommon = common.filter(Boolean)
  matchingCommon.sort((left, right) =>
    commonNameScore(right.vernacularNames, commonTerms[right.queryIndex]) -
      commonNameScore(left.vernacularNames, commonTerms[left.queryIndex]) ||
    left.queryIndex - right.queryIndex,
  )

  return {
    scientific: scientificData.filter(
      (species) => Number.isInteger(species.key) && species.scientificName,
    ),
    common: matchingCommon.slice(0, RESULT_LIMIT).map(({ queryIndex, ...species }) => species),
  }
}
