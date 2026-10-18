import { requestGbif } from './gbif.js'

const GBIF_BACKBONE_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c'
const INATURALIST_API = 'https://api.inaturalist.org/v1'
const RESULT_LIMIT = 12
export const RANDOM_TAXON_GROUPS = [
  { key: '', label: 'All life' },
  { key: 1, label: 'Animals' },
  { key: 6, label: 'Plants' },
  { key: 5, label: 'Fungi' },
  { key: 3, label: 'Bacteria' },
  { key: 4, label: 'Chromists' },
  { key: 7, label: 'Protozoa' },
  { key: 2, label: 'Archaea' },
]
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

export async function loadRandomTaxon(groupKey = '', {
  extinct = 'any',
  signal,
  fetchImpl = fetch,
  random = Math.random,
  inspectTaxon,
  maxCandidates = 48,
  avoidOrderKey = null,
} = {}) {
  const group = RANDOM_TAXON_GROUPS.find((candidate) => String(candidate.key) === String(groupKey))
  if (!group) throw new Error('Unknown taxon group')
  if (!['any', 'living', 'extinct'].includes(extinct)) throw new Error('Unknown extinction filter')
  if (typeof inspectTaxon !== 'function') throw new Error('A taxon information check is required')
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) {
    throw new Error('maxCandidates must be a positive integer')
  }

  const params = {
    datasetKey: GBIF_BACKBONE_KEY,
    rank: 'SPECIES',
    status: 'ACCEPTED',
    limit: 0,
  }
  if (group.key) params.highertaxonKey = group.key
  if (extinct !== 'any') params.isExtinct = extinct === 'extinct'
  const countData = await requestGbif('/species/search', params, { signal, fetchImpl })
  if (!Number.isInteger(countData.count) || countData.count < 1) {
    const groupName = group.label === 'All life' ? 'life' : group.label.toLowerCase()
    const stateName = extinct === 'any' ? '' : ` that are ${extinct}`
    throw new Error(`No accepted${stateName} species are available for ${groupName}`)
  }

  // GBIF caps deep paging; sample random pages within its accessible range.
  const accessibleCount = Math.min(countData.count, 99000)
  const pageSize = Math.min(12, accessibleCount)
  const maxPages = Math.ceil(maxCandidates / pageSize) + 2
  const seenKeys = new Set()
  let checked = 0
  let inspectionFailures = 0
  let lastInspectionError = null
  let sameOrderFound = false
  const inspectedKeys = new Set()

  const inspectCandidates = async (records) => {
    const candidates = (records || []).filter((taxon) =>
      isAcceptedNamedTaxon(taxon) && !inspectedKeys.has(taxon.key),
    )

    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1))
      const current = candidates[index]
      candidates[index] = candidates[swapIndex]
      candidates[swapIndex] = current
    }

    const batch = candidates.slice(0, maxCandidates - checked).map((record) => ({
      key: record.key,
      canonicalName: record.canonicalName || record.name || record.scientificName,
      scientificName: record.scientificName || record.canonicalName || record.name,
      rank: record.rank,
      taxonomicStatus: record.taxonomicStatus || record.status || '',
    }))
    for (const taxon of batch) inspectedKeys.add(taxon.key)

    for (let start = 0; start < batch.length; start += 4) {
      if (signal?.aborted) throw signal.reason
      const chunk = batch.slice(start, start + 4)
      const results = await Promise.all(chunk.map(async (taxon, index) => {
        try {
          return { taxon, information: await inspectTaxon(taxon, checked + start + index + 1) }
        } catch (error) {
          if (signal?.aborted) throw error
          return { taxon, error }
        }
      }))
      checked += chunk.length
      for (const result of results) {
        if (result.error) {
          inspectionFailures += 1
          lastInspectionError = result.error
        }
      }
      sameOrderFound ||= results.some(({ information }) => information &&
        avoidOrderKey !== null && String(information.orderKey) === String(avoidOrderKey))
      const useful = results.find(({ information }) => information &&
        (avoidOrderKey === null || String(information.orderKey) !== String(avoidOrderKey)))
      if (useful) return { taxon: useful.taxon, information: useful.information, checked }
    }
    return null
  }

  // GBIF's first 99,000 species are heavily biased toward a few large orders.
  // Sampling Animalia at the order level avoids repeatedly drawing beetles from
  // that capped slice, then samples species within each selected order.
  if (String(group.key) === '1') {
    const orderParams = {
      datasetKey: GBIF_BACKBONE_KEY,
      rank: 'ORDER',
      status: 'ACCEPTED',
      limit: 0,
      highertaxonKey: group.key,
    }
    const orderCountData = await requestGbif('/species/search', orderParams, { signal, fetchImpl })
    const orderCount = Math.min(orderCountData.count || 0, 99000)
    if (orderCount > 0) {
      const orderPageSize = Math.min(12, orderCount)
      const seenOrders = new Set()
      const maxOrderPages = Math.ceil(Math.min(orderCountData.count, 99000) / orderPageSize)
      for (let pageIndex = 0; pageIndex < maxOrderPages && checked < maxCandidates; pageIndex += 1) {
        if (signal?.aborted) throw signal.reason
        const lastOrderStart = Math.max(0, orderCount - orderPageSize)
        const offset = Math.floor(random() * (lastOrderStart + 1))
        const orderData = await requestGbif('/species/search', {
          ...orderParams,
          limit: orderPageSize,
          offset,
        }, { signal, fetchImpl })
        const orders = (orderData.results || []).filter((order) =>
          isAcceptedNamedTaxon(order) && order.rank?.toLocaleUpperCase() === 'ORDER' &&
          !seenOrders.has(order.key) &&
          (avoidOrderKey === null || String(order.key) !== String(avoidOrderKey)),
        )
        for (let index = orders.length - 1; index > 0; index -= 1) {
          const swapIndex = Math.floor(random() * (index + 1))
          const current = orders[index]
          orders[index] = orders[swapIndex]
          orders[swapIndex] = current
        }
        for (const order of orders) {
          if (checked >= maxCandidates) break
          seenOrders.add(order.key)
          const orderSpeciesParams = { ...params, highertaxonKey: order.key, limit: 0 }
          const speciesCount = await requestGbif('/species/search', orderSpeciesParams, { signal, fetchImpl })
          if (!Number.isInteger(speciesCount.count) || speciesCount.count < 1) continue
          const accessibleSpecies = Math.min(speciesCount.count, 99000)
          const speciesPageSize = Math.min(12, accessibleSpecies)
          const lastSpeciesStart = Math.max(0, accessibleSpecies - speciesPageSize)
          const speciesOffset = Math.floor(random() * (lastSpeciesStart + 1))
          const speciesData = await requestGbif('/species/search', {
            ...orderSpeciesParams,
            limit: speciesPageSize,
            offset: speciesOffset,
          }, { signal, fetchImpl })
          const result = await inspectCandidates(speciesData.results)
          if (result) return result
        }
      }
    }
  }

  for (let pageIndex = 0; pageIndex < maxPages && checked < maxCandidates; pageIndex += 1) {
    if (signal?.aborted) throw signal.reason
    if (seenKeys.size >= accessibleCount) break
    const lastStart = Math.max(0, accessibleCount - pageSize)
    const offset = Math.floor(random() * (lastStart + 1))
    const data = await requestGbif('/species/search', {
      ...params,
      limit: pageSize,
      offset,
    }, { signal, fetchImpl })
    const result = await inspectCandidates(data.results?.filter((taxon) => !seenKeys.has(taxon.key)))
    for (const taxon of data.results || []) seenKeys.add(taxon.key)
    if (result) return result
  }

  if (checked === 0) throw new Error('GBIF did not return any usable random species')
  if (lastInspectionError && inspectionFailures === checked) throw lastInspectionError
  if (sameOrderFound) {
    throw new Error(`No informative species outside the previous taxonomic order was found among ${checked} candidates; try again`)
  }
  throw new Error(`No random species with a verified photo or description was found among ${checked} candidates`)
}

