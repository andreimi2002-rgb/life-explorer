import { requestGbif } from './gbif.js'

const GBIF_BACKBONE_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c'
const RESULT_LIMIT = 12
const COMMON_NAME_ALIASES = new Map([
  ['wolf', ['gray wolf']],
  ['mouse', ['house mouse']],
  ['rhino', ['rhinoceros']],
])

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

export async function searchSpecies(query, {
  signal,
  fetchImpl = fetch,
  commonOffset = 0,
  commonLimit = RESULT_LIMIT,
} = {}) {
  const term = query.trim()
  if (term.length < 2) {
    return { scientific: [], common: [], commonCount: 0, commonOffset, commonHasMore: false }
  }

  const commonTerms = [term, ...(COMMON_NAME_ALIASES.get(term.toLocaleLowerCase()) || [])]
  const [scientificData, ...commonData] = await Promise.all([
    requestGbif('/species/suggest', { q: term, limit: RESULT_LIMIT }, { signal, fetchImpl }),
    ...commonTerms.map((commonTerm) =>
      requestGbif('/species/search', {
        q: commonTerm,
        qField: 'VERNACULAR',
        datasetKey: GBIF_BACKBONE_KEY,
        limit: commonLimit,
        offset: commonOffset,
      }, { signal, fetchImpl }),
    ),
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
    [...commonCandidates.values()].map(async ({ species, queryIndex }) => {
      const namesData = await requestGbif(
        `/species/${species.key}/vernacularNames`,
        { limit: 100 },
        { signal, fetchImpl },
      )

      if (!Array.isArray(namesData.results)) {
        throw new Error('GBIF returned an unexpected vernacular-name response')
      }

      const matchingNames = namesData.results
        .filter((name) => name.language === 'eng' && typeof name.vernacularName === 'string')
        .map((name) => name.vernacularName)
        .filter((name, index, names) =>
          commonTerms.some((commonTerm) =>
            name.toLocaleLowerCase().includes(commonTerm.toLocaleLowerCase()),
          ) &&
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
  const commonCount = Math.max(0, ...commonData.map((data) => data.count || 0))

  return {
    scientific: scientificData.filter(
      (species) => Number.isInteger(species.key) && species.scientificName,
    ),
    common: matchingCommon.map(({ queryIndex, ...species }) => species),
    commonCount,
    commonOffset,
    commonHasMore: commonData.some((data) => data.endOfRecords === false),
  }
}

export async function loadTaxonChildren(key, {
  signal,
  fetchImpl = fetch,
  offset = 0,
  limit = RESULT_LIMIT,
} = {}) {
  if (!Number.isInteger(Number(key)) || Number(key) < 1) {
    throw new Error('Invalid taxon key')
  }

  const data = await requestGbif(
    `/species/${Number(key)}/children`,
    { limit, offset },
    { signal, fetchImpl },
  )

  if (!Array.isArray(data.results)) {
    throw new Error('GBIF returned an unexpected child-taxa response')
  }

  return {
    results: data.results
      .filter((taxon) =>
        Number.isInteger(taxon.key) &&
        taxon.key > 0 &&
        (taxon.canonicalName || taxon.name || taxon.scientificName) &&
        taxon.rank,
      )
      .map((taxon) => ({
        key: taxon.key,
        canonicalName: taxon.canonicalName || taxon.name || taxon.scientificName,
        scientificName: taxon.scientificName || taxon.canonicalName || taxon.name,
        rank: taxon.rank,
        taxonomicStatus: taxon.taxonomicStatus || '',
      })),
    offset: data.offset,
    limit: data.limit,
    endOfRecords: data.endOfRecords,
  }
}
