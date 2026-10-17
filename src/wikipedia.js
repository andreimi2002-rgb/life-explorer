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
} = {}) {
  const key = Number(taxon.key)
  if (!Number.isInteger(key) || key < 1 || !taxon.canonicalName) {
    throw new Error('Invalid taxon for Wikipedia lookup')
  }

  const cache = cacheFor(fetchImpl)
  const cacheKey = `${key}:${taxon.canonicalName}`
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
  if (itemUrls.length !== 1) {
    if (itemUrls.length > 1) return null
    cache.set(cacheKey, { data: null, expiresAt: Date.now() + CACHE_TTL_MS })
    return null
  }

  const match = exactMatches.find((binding) => binding.item.value === itemUrls[0])
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
  }
  cache.set(cacheKey, { data: description, expiresAt: Date.now() + CACHE_TTL_MS })
  return description
}
