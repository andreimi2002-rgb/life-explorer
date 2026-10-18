import { requestGbif } from './gbif.js'

const GBIF_BACKBONE_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c'
const INATURALIST_API = 'https://api.inaturalist.org/v1'
const RESULT_LIMIT = 12
const COMMON_NAME_ALIASES = new Map([
  ['wolf', ['gray wolf']],
  ['mouse', ['house mouse']],
  ['rhino', ['rhinoceros']],
])

function isAcceptedNamedTaxon(taxon) {
  const status = (taxon.taxonomicStatus || taxon.status || '').toLocaleUpperCase()
  const rank = taxon.rank?.toLocaleUpperCase()
  const canonicalName = taxon.canonicalName || taxon.name
  return Number.isInteger(taxon.key) &&
    taxon.key > 0 &&
    typeof taxon.scientificName === 'string' &&
    typeof canonicalName === 'string' &&
    canonicalName.trim().length > 0 &&
    !canonicalName.includes(':') &&
    rank &&
    rank !== 'UNRANKED' &&
    status === 'ACCEPTED' &&
    taxon.synonym !== true
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

async function searchINaturalistCommonNames(term, { signal, fetchImpl }) {
  const url = new URL(`${INATURALIST_API}/taxa`)
  url.search = new URLSearchParams({ q: term, per_page: '100' })
  const response = await fetchImpl(url, { signal })
  if (!response.ok) {
    throw new Error(`iNaturalist search failed (${response.status})`)
  }

  const data = await response.json()
  if (!Array.isArray(data.results)) {
    throw new Error('iNaturalist returned an unexpected search response')
  }

  const candidates = data.results
    .filter((taxon) =>
      typeof taxon.name === 'string' &&
      typeof taxon.rank === 'string' &&
      typeof taxon.preferred_common_name === 'string' &&
      (
        commonNameScore([taxon.preferred_common_name], term) > 0 ||
        taxon.name.toLocaleLowerCase() === term.toLocaleLowerCase()
      ),
    )
    .sort((left, right) =>
      commonNameScore([right.preferred_common_name], term) -
        commonNameScore([left.preferred_common_name], term) ||
      (right.observations_count || 0) - (left.observations_count || 0),
    )
    .slice(0, RESULT_LIMIT)

  return Promise.all(candidates.map(async (taxon) => {
    const match = await requestGbif('/species/match', {
      name: taxon.name,
      rank: taxon.rank.toLocaleUpperCase(),
    }, { signal, fetchImpl })
    if (
      match.matchType !== 'EXACT' ||
      match.canonicalName !== taxon.name ||
      match.rank !== taxon.rank.toLocaleUpperCase() ||
      !isAcceptedNamedTaxon({ ...match, key: match.usageKey })
    ) {
      return null
    }

    return {
      ...match,
      key: match.usageKey,
      vernacularNames: [taxon.preferred_common_name],
      preferredCommonName: taxon.preferred_common_name,
      commonNameMatches: commonNameScore([taxon.preferred_common_name], term) > 0,
      commonNameSource: 'iNaturalist',
    }
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
      if (isAcceptedNamedTaxon(species)) {
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
            commonNameScore([name], commonTerm) > 0,
          ) &&
          names.findIndex((candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase()) === index,
        )

      return matchingNames.length
        ? { ...species, vernacularNames: matchingNames, queryIndex }
        : null
    }),
  )
  const scientific = scientificData.filter(isAcceptedNamedTaxon)
  const matchingCommon = common.filter(Boolean)
  let commonNameWarning = ''
  try {
    const iNaturalistMatches = await searchINaturalistCommonNames(term, { signal, fetchImpl })
    for (const taxon of iNaturalistMatches) {
      if (!taxon) continue
      if (!taxon.commonNameMatches) {
        const scientificIndex = scientific.findIndex((candidate) => candidate.key === taxon.key)
        if (scientificIndex !== -1) {
          scientific[scientificIndex] = {
            ...scientific[scientificIndex],
            preferredCommonName: taxon.preferredCommonName,
          }
        }
        continue
      }
      const existingIndex = matchingCommon.findIndex((candidate) => candidate.key === taxon.key)
      if (existingIndex === -1) {
        matchingCommon.push({ ...taxon, queryIndex: 0 })
      } else if (commonNameScore(taxon.vernacularNames, term) >
        commonNameScore(matchingCommon[existingIndex].vernacularNames, term)) {
        matchingCommon[existingIndex] = { ...taxon, queryIndex: 0 }
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error
    commonNameWarning = error.message
  }
  matchingCommon.sort((left, right) =>
    commonNameScore(right.vernacularNames, commonTerms[right.queryIndex]) -
      commonNameScore(left.vernacularNames, commonTerms[left.queryIndex]) ||
    left.queryIndex - right.queryIndex,
  )
  const commonCount = Math.max(0, ...commonData.map((data) => data.count || 0))

  return {
    scientific,
    common: matchingCommon.map(({ queryIndex, commonNameMatches, ...species }) => species),
    commonCount,
    commonOffset,
    commonHasMore: commonData.some((data) => data.endOfRecords === false),
    commonNameWarning,
  }
}

const CHILD_FILTERS = new Set(['all', 'living', 'extinct'])
const FLAG_PAGE_SIZE = 1000
const MAX_FLAG_PAGES = 2
const STATE_ORDER = { living: 0, unknown: 1, unchecked: 1, extinct: 2 }

function toChild(taxon, extinctState) {
  return {
    key: taxon.key,
    canonicalName: taxon.canonicalName || taxon.name || taxon.scientificName,
    scientificName: taxon.scientificName || taxon.canonicalName || taxon.name,
    rank: taxon.rank,
    taxonomicStatus: taxon.taxonomicStatus || '',
    extinctState,
  }
}

function stateFromGbifFlag(extinct) {
  if (extinct === true) return 'extinct'
  if (extinct === false) return 'living'
  return 'unknown'
}

function dominantRank(taxa) {
  const counts = new Map()
  for (const taxon of taxa) counts.set(taxon.rank, (counts.get(taxon.rank) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
}

function searchChildren(key, rank, params, { signal, fetchImpl }) {
  return requestGbif('/species/search', {
    datasetKey: GBIF_BACKBONE_KEY,
    highertaxonKey: Number(key),
    rank,
    status: 'ACCEPTED',
    ...params,
  }, { signal, fetchImpl })
}

// GBIF children and detail records do not carry the extinction flag, but
// search results do. Collect the flagged keys of the group's main child rank.
async function loadFlagSets(key, rank, { signal, fetchImpl }) {
  let complete = true
  const collect = async (isExtinct) => {
    const keys = new Set()
    for (let page = 0; page < MAX_FLAG_PAGES; page += 1) {
      const data = await searchChildren(key, rank, {
        isExtinct,
        limit: FLAG_PAGE_SIZE,
        offset: page * FLAG_PAGE_SIZE,
      }, { signal, fetchImpl })
      if (!Array.isArray(data.results)) {
        throw new Error('GBIF returned an unexpected extinction-flag response')
      }
      data.results.forEach((result) => keys.add(result.key))
      if (data.endOfRecords !== false) return keys
    }
    complete = false
    return keys
  }
  const [extinct, living] = await Promise.all([collect(true), collect(false)])
  return { extinct, living, complete }
}

export async function loadTaxonChildren(key, {
  signal,
  fetchImpl = fetch,
  offset = 0,
  limit = RESULT_LIMIT,
  filter = 'all',
} = {}) {
  if (!Number.isInteger(Number(key)) || Number(key) < 1) {
    throw new Error('Invalid taxon key')
  }
  if (!CHILD_FILTERS.has(filter)) throw new Error('Invalid child filter')

  if (filter !== 'all') {
    const sample = await requestGbif(
      `/species/${Number(key)}/children`,
      { limit: 100 },
      { signal, fetchImpl },
    )
    if (!Array.isArray(sample.results)) {
      throw new Error('GBIF returned an unexpected child-taxa response')
    }
    const rank = dominantRank(sample.results.filter(isAcceptedNamedTaxon))
    if (!rank) return { results: [], offset, limit, endOfRecords: true, filter }

    const data = await searchChildren(key, rank, {
      isExtinct: filter === 'extinct',
      limit,
      offset,
    }, { signal, fetchImpl })
    if (!Array.isArray(data.results)) {
      throw new Error('GBIF returned an unexpected child-taxa response')
    }
    return {
      results: data.results
        .filter(isAcceptedNamedTaxon)
        .map((taxon) => toChild(taxon, filter === 'extinct' ? 'extinct' : 'living')),
      offset: data.offset,
      limit: data.limit,
      endOfRecords: data.endOfRecords,
      filter,
      listedRank: rank,
    }
  }

  const data = await requestGbif(
    `/species/${Number(key)}/children`,
    { limit, offset },
    { signal, fetchImpl },
  )

  if (!Array.isArray(data.results)) {
    throw new Error('GBIF returned an unexpected child-taxa response')
  }

  const accepted = data.results.filter(isAcceptedNamedTaxon)
  const rank = dominantRank(accepted)
  let flags = null
  let statusError = ''
  if (rank) {
    try {
      flags = await loadFlagSets(key, rank, { signal, fetchImpl })
    } catch (error) {
      if (signal?.aborted) throw error
      statusError = error.message
    }
  }

  const results = accepted.map((taxon) => {
    if (!flags || taxon.rank !== rank) return toChild(taxon, 'unchecked')
    if (flags.extinct.has(taxon.key)) return toChild(taxon, 'extinct')
    if (flags.living.has(taxon.key)) return toChild(taxon, 'living')
    return toChild(taxon, flags.complete ? 'unknown' : 'unchecked')
  })
  results.sort((a, b) => STATE_ORDER[a.extinctState] - STATE_ORDER[b.extinctState])

  return {
    results,
    offset: data.offset,
    limit: data.limit,
    endOfRecords: data.endOfRecords,
    filter,
    statusError,
    statusComplete: Boolean(flags?.complete),
  }
}

