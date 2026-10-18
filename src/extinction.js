import { requestGbif } from './gbif.js'

const GBIF_BACKBONE_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c'
const INATURALIST_API = 'https://api.inaturalist.org/v1'

const EXTINCT_THREATS = new Set(['EXTINCT'])
const EXTINCT_IN_WILD_THREATS = new Set(['EXTINCT_IN_THE_WILD'])
const LIVING_THREATS = new Set([
  'LEAST_CONCERN',
  'NEAR_THREATENED',
  'VULNERABLE',
  'ENDANGERED',
  'CRITICALLY_ENDANGERED',
])
const LIVING_IUCN_LABELS = new Set([
  'least concern',
  'near threatened',
  'vulnerable',
  'endangered',
  'critically endangered',
])

function asArray(value) {
  return Array.isArray(value) ? value : []
}

// Three states only. "Living" needs positive evidence; absence of an extinction
// signal never makes a taxon living, and conflicting sources stay unknown.
export function classifyExtinction({
  gbifExtinct,
  gbifThreatStatuses = [],
  iNaturalist = null,
  iucnStatuses = [],
} = {}) {
  const threats = asArray(gbifThreatStatuses).map((value) => String(value).toUpperCase())
  const iucn = asArray(iucnStatuses).map((value) => String(value).toLowerCase())

  const extinct = []
  const extinctInWild = []
  const living = []

  if (gbifExtinct === true) extinct.push({ source: 'GBIF Backbone', detail: 'marked extinct' })
  if (threats.some((value) => EXTINCT_THREATS.has(value))) {
    extinct.push({ source: 'GBIF', detail: 'threat status: extinct', recent: true })
  }
  if (iNaturalist?.found && iNaturalist.extinct === true) {
    extinct.push({ source: 'iNaturalist', detail: 'marked extinct' })
  }
  if (iucn.includes('extinct')) {
    extinct.push({ source: 'IUCN via Wikidata', detail: 'status: extinct', recent: true })
  }

  if (threats.some((value) => EXTINCT_IN_WILD_THREATS.has(value))) {
    extinctInWild.push({ source: 'GBIF', detail: 'threat status: extinct in the wild' })
  }
  if (iucn.includes('extinct in the wild')) {
    extinctInWild.push({ source: 'IUCN via Wikidata', detail: 'status: extinct in the wild' })
  }

  if (gbifExtinct === false) living.push({ source: 'GBIF Backbone', detail: 'marked not extinct' })
  if (threats.some((value) => LIVING_THREATS.has(value))) {
    living.push({ source: 'GBIF', detail: 'threat status: not extinct' })
  }
  if (
    iNaturalist?.found &&
    iNaturalist.extinct === false &&
    Number(iNaturalist.observationsCount) > 0
  ) {
    living.push({ source: 'iNaturalist', detail: 'has observations and is not marked extinct' })
  }
  if (iucn.some((value) => LIVING_IUCN_LABELS.has(value))) {
    living.push({ source: 'IUCN via Wikidata', detail: 'status: not extinct' })
  }

  if (extinct.length && living.length) {
    return { state: 'unknown', conflict: true, evidence: [...extinct, ...living] }
  }
  if (extinct.length) {
    return {
      state: 'extinct',
      kind: extinct.some((item) => item.recent) ? 'recent' : 'undated',
      evidence: extinct,
    }
  }
  if (extinctInWild.length) {
    return { state: 'extinct', kind: 'wild', evidence: extinctInWild }
  }
  if (living.length) return { state: 'living', evidence: living }
  return { state: 'unknown', evidence: [] }
}

async function loadGbifFlag(taxon, { signal, fetchImpl }) {
  const data = await requestGbif('/species/search', {
    datasetKey: GBIF_BACKBONE_KEY,
    q: taxon.canonicalName,
    rank: taxon.rank,
    status: 'ACCEPTED',
    limit: 20,
  }, { signal, fetchImpl })
  if (!Array.isArray(data.results)) {
    throw new Error('GBIF returned an unexpected extinction response')
  }
  const record = data.results.find((result) => Number(result.key) === Number(taxon.key))
  return {
    gbifExtinct: typeof record?.extinct === 'boolean' ? record.extinct : undefined,
    gbifThreatStatuses: asArray(record?.threatStatuses),
  }
}

async function loadINaturalistFlag(taxon, { signal, fetchImpl }) {
  const url = new URL(`${INATURALIST_API}/taxa`)
  url.search = new URLSearchParams({
    q: taxon.canonicalName,
    rank: taxon.rank.toLowerCase(),
    per_page: '20',
  })
  const response = await fetchImpl(url, { signal })
  if (!response.ok) throw new Error(`iNaturalist request failed (${response.status})`)
  const data = await response.json()
  if (!Array.isArray(data.results)) {
    throw new Error('iNaturalist returned an unexpected extinction response')
  }
  const match = data.results.find((result) =>
    result.name === taxon.canonicalName &&
    result.rank?.toUpperCase() === taxon.rank,
  )
  if (!match) return { found: false }
  return {
    found: true,
    extinct: typeof match.extinct === 'boolean' ? match.extinct : undefined,
    observationsCount: Number(match.observations_count) || 0,
  }
}

// Gathers extinction signals for one taxon. A failed source is reported in
// `errors` and never treated as "not extinct".
export async function loadExtinctionStatus(taxon, {
  iucnStatuses = [],
  signal,
  fetchImpl = fetch,
} = {}) {
  const [gbif, iNaturalist] = await Promise.allSettled([
    loadGbifFlag(taxon, { signal, fetchImpl }),
    loadINaturalistFlag(taxon, { signal, fetchImpl }),
  ])
  if (signal?.aborted) throw signal.reason
  const errors = []
  const signals = { iucnStatuses }
  if (gbif.status === 'fulfilled') Object.assign(signals, gbif.value)
  else errors.push(gbif.reason.message)
  if (iNaturalist.status === 'fulfilled') signals.iNaturalist = iNaturalist.value
  else errors.push(iNaturalist.reason.message)
  return { ...classifyExtinction(signals), errors }
}
