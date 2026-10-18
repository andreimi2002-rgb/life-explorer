const WIKIDATA_QUERY_API = 'https://query.wikidata.org/sparql'
const WIKIPEDIA_SUMMARY_API = 'https://en.wikipedia.org/api/rest_v1/page/summary'
const CACHE_TTL_MS = 5 * 60 * 1000
const responseCaches = new WeakMap()

function cacheFor(fetchImpl) {
  let cache = responseCaches.get(fetchImpl)
  if (!cache) {
    cache = new Map()
    responseCaches.set(fetchImpl, cache)
  }
  return cache
}

async function readJson(response, source) {
  if (!response.ok) {
    throw new Error(`${source} request failed (${response.status})`)
  }
  return response.json()
}

function createTaxonQuery(key) {
  return `
    SELECT DISTINCT ?item ?taxonName ?article WHERE {
      ?item wdt:P846 "${key}" ;
            wdt:P225 ?taxonName .
      ?article schema:about ?item ;
               schema:inLanguage "en" ;
               schema:isPartOf <https://en.wikipedia.org/> .
    }
    LIMIT 2
  `
}

const RANK_ITEMS = {
  KINGDOM: 'Q36732',
  PHYLUM: 'Q38348',
  CLASS: 'Q37517',
  ORDER: 'Q36602',
  FAMILY: 'Q35409',
  GENUS: 'Q34740',
  SPECIES: 'Q7432',
}

function createNameQuery(name) {
  return `
    SELECT DISTINCT ?item ?article ?rank ?parentName ?gbifKey WHERE {
      ?item wdt:P225 ${JSON.stringify(name)} ;
            wdt:P105 ?rank .
      ?article schema:about ?item ;
               schema:inLanguage "en" ;
               schema:isPartOf <https://en.wikipedia.org/> .
      OPTIONAL { ?item wdt:P171 ?parent . ?parent wdt:P225 ?parentName . }
      OPTIONAL { ?item wdt:P846 ?gbifKey . }
    }
    LIMIT 50
  `
}

// Second tier: used only when no Wikidata item carries the GBIF key. The match
// must be unique and agree on rank and ancestry, and the item must not claim a
// GBIF identifier of its own.
function selectNameMatch(bindings, taxon, ancestorNames) {
  const rankItem = RANK_ITEMS[taxon.rank]
  const ancestors = new Set(ancestorNames)
  const items = new Map()
  for (const binding of bindings) {
    const itemValue = binding.item?.value
    if (!itemValue || !binding.article?.value) continue
    const entry = items.get(itemValue) || {
      binding,
      ranks: new Set(),
      parents: new Set(),
      hasGbifKey: false,
    }
    if (binding.rank?.value) entry.ranks.add(binding.rank.value.split('/').pop())
    if (binding.parentName?.value) entry.parents.add(binding.parentName.value)
    if (binding.gbifKey?.value) entry.hasGbifKey = true
    items.set(itemValue, entry)
  }
  if (items.size !== 1) return null
  const [entry] = items.values()
  if (entry.hasGbifKey || !rankItem || !entry.ranks.has(rankItem)) return null
  if (![...entry.parents].some((parent) => ancestors.has(parent))) return null
  return entry.binding
}

function getImageCandidate(summary) {
  const source = summary.originalimage?.source || summary.thumbnail?.source
  if (typeof source !== 'string') return null

  let imageUrl
  try {
    imageUrl = new URL(source)
  } catch {
    return null
  }
  if (
    imageUrl.protocol !== 'https:' ||
    !['thumb.wikimedia.org', 'upload.wikimedia.org'].includes(imageUrl.hostname)
  ) {
    return null
  }

  const segments = imageUrl.pathname.split('/').filter(Boolean)
  const thumbIndex = segments.indexOf('thumb')
  const filename = thumbIndex >= 0
    ? segments[thumbIndex + 3]
    : segments.at(-1)
  if (!filename) return null

  let decodedFilename
  try {
    decodedFilename = decodeURIComponent(filename)
  } catch {
    return null
  }
  return { filename: decodedFilename }
}

export async function loadWikipediaDescription(taxon, {
  signal,
  fetchImpl = fetch,
  ancestorNames = [],
} = {}) {
  const key = Number(taxon.key)
  if (!Number.isInteger(key) || key < 1 || !taxon.canonicalName) {
    throw new Error('Invalid taxon for Wikipedia lookup')
  }

  const cache = cacheFor(fetchImpl)
  const cacheKey = `${key}:${taxon.canonicalName}:${ancestorNames.join('>')}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  if (cached) cache.delete(cacheKey)

  const queryUrl = new URL(WIKIDATA_QUERY_API)
  queryUrl.search = new URLSearchParams({
    query: createTaxonQuery(key),
    format: 'json',
  })
  const queryResponse = await fetchImpl(queryUrl, {
    signal,
    headers: { Accept: 'application/sparql-results+json' },
  })
  const queryData = await readJson(queryResponse, 'Wikidata')
  const bindings = queryData.results?.bindings
  if (!Array.isArray(bindings)) {
    throw new Error('Wikidata returned an unexpected taxon response')
  }

  const exactMatches = bindings.filter((binding) =>
    binding.taxonName?.value === taxon.canonicalName &&
    binding.item?.value &&
    binding.article?.value,
  )
  const itemUrls = [...new Set(exactMatches.map((binding) => binding.item.value))]
  let match
  let matchedBy = 'gbif-key'
  if (itemUrls.length > 1) return null
  if (itemUrls.length === 1) {
    match = exactMatches.find((binding) => binding.item.value === itemUrls[0])
  } else if (bindings.length === 0 && ancestorNames.length) {
    const nameUrl = new URL(WIKIDATA_QUERY_API)
    nameUrl.search = new URLSearchParams({
      query: createNameQuery(taxon.canonicalName),
      format: 'json',
    })
    const nameResponse = await fetchImpl(nameUrl, {
      signal,
      headers: { Accept: 'application/sparql-results+json' },
    })
    const nameData = await readJson(nameResponse, 'Wikidata')
    if (!Array.isArray(nameData.results?.bindings)) {
      throw new Error('Wikidata returned an unexpected taxon response')
    }
    match = selectNameMatch(nameData.results.bindings, taxon, ancestorNames)
    matchedBy = 'name'
  }
  if (!match) {
    if (bindings.length === 0) {
      cache.set(cacheKey, { data: null, expiresAt: Date.now() + CACHE_TTL_MS })
    }
    return null
  }

  const itemUrl = new URL(match.item.value)
  const articleUrl = new URL(match.article.value)
  if (
    itemUrl.hostname !== 'www.wikidata.org' ||
    !/^\/entity\/Q\d+$/.test(itemUrl.pathname) ||
    articleUrl.hostname !== 'en.wikipedia.org' ||
    !articleUrl.pathname.startsWith('/wiki/')
  ) {
    throw new Error('Wikidata returned an invalid article link')
  }

  const title = decodeURIComponent(articleUrl.pathname.slice('/wiki/'.length))
  const summaryUrl = new URL(`${WIKIPEDIA_SUMMARY_API}/${encodeURIComponent(title)}`)
  const summaryResponse = await fetchImpl(summaryUrl, {
    signal,
    headers: { Accept: 'application/json' },
  })
  const summary = await readJson(summaryResponse, 'Wikipedia')
  if (typeof summary.extract !== 'string' || !summary.extract.trim()) {
    cache.set(cacheKey, { data: null, expiresAt: Date.now() + CACHE_TTL_MS })
    return null
  }

  const description = {
    title: summary.title || title.replaceAll('_', ' '),
    extract: summary.extract.trim(),
    articleUrl: articleUrl.toString(),
    wikidataUrl: itemUrl.toString(),
    image: getImageCandidate(summary),
    matchedBy,
  }
  cache.set(cacheKey, { data: description, expiresAt: Date.now() + CACHE_TTL_MS })
  return description
}
