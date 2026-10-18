// Measures how many sampled taxa have a Wikipedia description, a photo and an
// extinction signal. Runs separately from the site and writes a local report.
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { loadWikipediaDescription } from '../src/wikipedia.js'
import { resolvePhoto } from '../src/photos.js'

const GBIF_API = 'https://api.gbif.org/v1'
const BACKBONE_DATASET = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c'
const WIKIDATA_API = 'https://query.wikidata.org/sparql'
const INATURALIST_API = 'https://api.inaturalist.org/v1'
const IUCN_EXTINCT = 'http://www.wikidata.org/entity/Q237350'
const MAX_GBIF_OFFSET = 99000
const USER_AGENT =
  'LifeExplorerCoverageScript/0.1 (https://life-explorer.netlify.app; research on data coverage)'

export const KINGDOMS = [
  { name: 'Animalia', key: 1 },
  { name: 'Plantae', key: 6 },
  { name: 'Fungi', key: 5 },
  { name: 'Bacteria', key: 3 },
  { name: 'Chromista', key: 4 },
  { name: 'Protozoa', key: 7 },
  { name: 'Archaea', key: 2 },
]
export const RANKS = ['SPECIES', 'GENUS', 'FAMILY']

export function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Throttled fetch that retries rate-limit and server errors a few times.
export function createPoliteFetch({
  delayMs = 800,
  retries = 2,
  backoffMs = 2000,
  fetchImpl = fetch,
} = {}) {
  return async function politeFetch(url, options) {
    for (let attempt = 0; ; attempt += 1) {
      if (delayMs) await sleep(delayMs)
      const response = await fetchImpl(url, {
        ...options,
        headers: { 'User-Agent': USER_AGENT, ...options?.headers },
      })
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt >= retries) return response
      const retryAfter = Number(response.headers?.get?.('retry-after'))
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter, 60) * 1000
        : (attempt + 1) * backoffMs)
    }
  }
}

async function getJson(fetchImpl, url, source) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`${source} request failed (${response.status})`)
  return response.json()
}

export async function sampleTaxa({ kingdoms, ranks, perGroup, random, fetchImpl }) {
  const taxa = []
  for (const kingdom of kingdoms) {
    for (const rank of ranks) {
      const params = {
        datasetKey: BACKBONE_DATASET,
        highertaxonKey: String(kingdom.key),
        rank,
        status: 'ACCEPTED',
      }
      const countUrl = new URL(`${GBIF_API}/species/search`)
      countUrl.search = new URLSearchParams({ ...params, limit: '0' })
      const { count } = await getJson(fetchImpl, countUrl, 'GBIF')
      if (!Number.isInteger(count) || count < 1) continue

      // GBIF limits deep paging, so very large groups are sampled from their
      // first 99,000 records only.
      const range = Math.min(count, MAX_GBIF_OFFSET)
      const seen = new Set()
      for (let i = 0; i < perGroup * 3 && seen.size < perGroup; i += 1) {
        const offset = Math.floor(random() * range)
        const url = new URL(`${GBIF_API}/species/search`)
        url.search = new URLSearchParams({ ...params, limit: '1', offset: String(offset) })
        const data = await getJson(fetchImpl, url, 'GBIF')
        const item = data.results?.[0]
        if (
          !item || seen.has(item.key) || !item.canonicalName ||
          item.taxonomicStatus !== 'ACCEPTED' || item.rank !== rank
        ) continue
        seen.add(item.key)
        taxa.push({
          key: item.key,
          canonicalName: item.canonicalName,
          rank: item.rank,
          kingdom: kingdom.name,
        })
      }
    }
  }
  return taxa
}

async function wikidataQuery(fetchImpl, query) {
  const url = new URL(WIKIDATA_API)
  url.search = new URLSearchParams({ query, format: 'json' })
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/sparql-results+json' },
  })
  if (!response.ok) throw new Error(`Wikidata request failed (${response.status})`)
  const data = await response.json()
  if (!Array.isArray(data.results?.bindings)) {
    throw new Error('Wikidata returned an unexpected response')
  }
  return data.results.bindings
}

// True when a unique Wikipedia article exists for the exact scientific name
// even though the GBIF-key lookup found nothing.
async function nameOnlyArticleExists(taxon, fetchImpl) {
  const name = JSON.stringify(taxon.canonicalName)
  const bindings = await wikidataQuery(fetchImpl, `
    SELECT DISTINCT ?item WHERE {
      ?item wdt:P225 ${name} .
      ?article schema:about ?item ;
               schema:inLanguage "en" ;
               schema:isPartOf <https://en.wikipedia.org/> .
    }
    LIMIT 3
  `)
  return new Set(bindings.map((binding) => binding.item?.value)).size === 1
}

async function iucnExtinct(wikidataUrl, fetchImpl) {
  const id = new URL(wikidataUrl).pathname.split('/').pop()
  if (!/^Q\d+$/.test(id)) return false
  const bindings = await wikidataQuery(fetchImpl, `
    SELECT ?status WHERE { wd:${id} wdt:P141 ?status . }
    LIMIT 10
  `)
  return bindings.some((binding) => binding.status?.value === IUCN_EXTINCT)
}

async function iNaturalistExtinct(taxon, fetchImpl) {
  const url = new URL(`${INATURALIST_API}/taxa`)
  url.search = new URLSearchParams({
    q: taxon.canonicalName,
    rank: taxon.rank.toLowerCase(),
    per_page: '20',
  })
  const data = await getJson(fetchImpl, url, 'iNaturalist')
  if (!Array.isArray(data.results)) {
    throw new Error('iNaturalist returned an unexpected response')
  }
  const match = data.results.find((result) =>
    result.name === taxon.canonicalName &&
    result.rank?.toUpperCase() === taxon.rank,
  )
  if (!match) return 'noRecord'
  return match.extinct === true ? 'extinct' : 'notFlagged'
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

export async function checkTaxon(taxon, fetchImpl) {
  const result = { ...taxon }
  let wikipedia = null

  try {
    wikipedia = await loadWikipediaDescription(taxon, { fetchImpl })
    result.description = wikipedia ? 'found' : 'notFound'
  } catch (error) {
    result.description = 'failed'
    result.descriptionError = errorMessage(error)
  }

  if (result.description === 'notFound') {
    try {
      result.nameOnlyArticle = await nameOnlyArticleExists(taxon, fetchImpl)
    } catch (error) {
      result.nameOnlyArticle = null
      result.nameOnlyError = errorMessage(error)
    }
  }

  try {
    const photo = await resolvePhoto(taxon, { wikipedia, fetchImpl })
    if (photo.photo) result.photo = 'found'
    else if (photo.photoError) result.photo = 'failed'
    else result.photo = 'notFound'
    if (photo.photoError) result.photoError = photo.photoError
  } catch (error) {
    result.photo = 'failed'
    result.photoError = errorMessage(error)
  }

  const signals = []
  try {
    const status = await iNaturalistExtinct(taxon, fetchImpl)
    result.iNaturalistExtinct = status
    if (status === 'extinct') signals.push('iNaturalist')
  } catch (error) {
    result.iNaturalistExtinct = 'failed'
    result.extinctError = errorMessage(error)
  }
  if (wikipedia?.wikidataUrl) {
    try {
      result.wikidataIucnExtinct = await iucnExtinct(wikipedia.wikidataUrl, fetchImpl)
      if (result.wikidataIucnExtinct) signals.push('Wikidata IUCN')
    } catch (error) {
      result.wikidataIucnExtinct = null
      result.extinctError = errorMessage(error)
    }
  }
  result.extinctSignals = signals
  return result
}

function tally(values) {
  const counts = {}
  for (const value of values) counts[value] = (counts[value] || 0) + 1
  return counts
}

function summarizeGroup(results) {
  return {
    total: results.length,
    description: tally(results.map((r) => r.description)),
    photo: tally(results.map((r) => r.photo)),
    descriptionMissedOnlyByKeyLookup: results.filter((r) => r.nameOnlyArticle === true).length,
    extinctFlagged: results.filter((r) => r.extinctSignals.length > 0).length,
    iNaturalistExtinct: tally(results.map((r) => r.iNaturalistExtinct)),
  }
}

export function summarize(results) {
  const group = (field) => {
    const names = [...new Set(results.map((r) => r[field]))]
    return Object.fromEntries(names.map((name) => [
      name,
      summarizeGroup(results.filter((r) => r[field] === name)),
    ]))
  }
  return {
    overall: summarizeGroup(results),
    byKingdom: group('kingdom'),
    byRank: group('rank'),
  }
}

export function formatSummary(summary) {
  const pct = (part = 0, total) => (total ? `${Math.round((part / total) * 100)}%` : '-')
  const line = (name, s) =>
    `${name.padEnd(12)} n=${String(s.total).padEnd(4)} ` +
    `descriere ${pct(s.description.found, s.total).padEnd(5)} ` +
    `(negăsit ${s.description.notFound || 0}, eroare ${s.description.failed || 0}, ` +
    `doar cheie ${s.descriptionMissedOnlyByKeyLookup}) | ` +
    `poză ${pct(s.photo.found, s.total).padEnd(5)} ` +
    `(negăsit ${s.photo.notFound || 0}, eroare ${s.photo.failed || 0}) | ` +
    `dispărut ${s.extinctFlagged}`
  return [
    line('TOTAL', summary.overall),
    ...Object.entries(summary.byKingdom).map(([name, s]) => line(name, s)),
    ...Object.entries(summary.byRank).map(([name, s]) => line(name, s)),
  ].join('\n')
}

export function parseArgs(argv) {
  const options = { perGroup: 10, seed: 1, delayMs: 800, kingdoms: null, out: 'reports' }
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]]
    if (flag === '--per-group') options.perGroup = Number(value)
    else if (flag === '--seed') options.seed = Number(value)
    else if (flag === '--delay') options.delayMs = Number(value)
    else if (flag === '--kingdoms') options.kingdoms = value.split(',')
    else if (flag === '--out') options.out = value
    else throw new Error(`Unknown option ${flag}`)
  }
  if (!Number.isInteger(options.perGroup) || options.perGroup < 1) {
    throw new Error('--per-group must be a positive integer')
  }
  if (!Number.isInteger(options.seed)) throw new Error('--seed must be an integer')
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    throw new Error('--delay must be zero or more milliseconds')
  }
  return options
}

export async function run(options, { fetchImpl = fetch, log = console.log } = {}) {
  const kingdoms = options.kingdoms
    ? KINGDOMS.filter((kingdom) => options.kingdoms.includes(kingdom.name))
    : KINGDOMS
  if (!kingdoms.length) throw new Error('No matching kingdoms')

  const politeFetch = createPoliteFetch({ delayMs: options.delayMs, fetchImpl })
  const random = createRandom(options.seed)
  log(`Pas 1: aleg eșantionul (${options.perGroup} per regn și rang)...`)
  const taxa = await sampleTaxa({
    kingdoms, ranks: RANKS, perGroup: options.perGroup, random, fetchImpl: politeFetch,
  })
  log(`Eșantion: ${taxa.length} taxoni. Pas 2: verific fiecare taxon...`)

  const results = []
  for (const [index, taxon] of taxa.entries()) {
    results.push(await checkTaxon(taxon, politeFetch))
    if ((index + 1) % 10 === 0) log(`  ${index + 1}/${taxa.length}`)
  }

  const summary = summarize(results)
  return {
    report: {
      generatedAt: new Date().toISOString(),
      options: { ...options, ranks: RANKS },
      summary,
      results,
    },
    text: formatSummary(summary),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2))
  const { report, text } = await run(options)
  await mkdir(options.out, { recursive: true })
  const file = `${options.out}/coverage-${report.generatedAt.replace(/[:.]/g, '-')}.json`
  await writeFile(file, JSON.stringify(report, null, 2))
  console.log(`\n${text}\n\nRaport complet: ${file}`)
}
