const WIKIDATA_QUERY_API = 'https://query.wikidata.org/sparql'
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_VALUES = 5
const responseCaches = new WeakMap()

const FACTS = [
  { id: 'status', label: 'Conservation status (IUCN)', property: 'P141' },
  { id: 'food', label: 'Main food source', property: 'P1034' },
  { id: 'habitat', label: 'Habitat', property: 'P2974' },
]

function cacheFor(fetchImpl) {
  let cache = responseCaches.get(fetchImpl)
  if (!cache) {
    cache = new Map()
    responseCaches.set(fetchImpl, cache)
  }
  return cache
}

function createFactsQuery(id) {
  const values = FACTS.map((fact) => `("${fact.id}" wdt:${fact.property})`).join(' ')
  return `
    SELECT ?fact ?valueLabel WHERE {
      VALUES (?fact ?predicate) { ${values} }
      wd:${id} ?predicate ?value .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 40
  `
}

// Returns only the facts that Wikidata actually has for the item, each with
// the item link as its source. Absent properties are omitted, not guessed.
export async function loadQuickFacts(wikidataUrl, {
  signal,
  fetchImpl = fetch,
} = {}) {
  const itemUrl = new URL(wikidataUrl)
  const id = itemUrl.pathname.split('/').pop()
  if (itemUrl.hostname !== 'www.wikidata.org' || !/^Q\d+$/.test(id)) {
    throw new Error('Invalid Wikidata item link')
  }

  const cache = cacheFor(fetchImpl)
  const cached = cache.get(id)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  if (cached) cache.delete(id)

  const requestUrl = new URL(WIKIDATA_QUERY_API)
  requestUrl.search = new URLSearchParams({ query: createFactsQuery(id), format: 'json' })
  const response = await fetchImpl(requestUrl, {
    signal,
    headers: { Accept: 'application/sparql-results+json' },
  })
  if (!response.ok) throw new Error(`Wikidata facts request failed (${response.status})`)
  const data = await response.json()
  const bindings = data.results?.bindings
  if (!Array.isArray(bindings)) {
    throw new Error('Wikidata returned an unexpected facts response')
  }

  const facts = []
  for (const fact of FACTS) {
    const values = [...new Set(
      bindings
        .filter((binding) => binding.fact?.value === fact.id)
        .map((binding) => binding.valueLabel?.value)
        // An unresolved label comes back as the raw item id.
        .filter((value) => typeof value === 'string' && value && !/^Q\d+$/.test(value))
        .map((value) => value.charAt(0).toLocaleUpperCase('en') + value.slice(1)),
    )].slice(0, MAX_VALUES)
    if (values.length) {
      facts.push({ id: fact.id, label: fact.label, values, sourceUrl: wikidataUrl })
    }
  }
  cache.set(id, { data: facts, expiresAt: Date.now() + CACHE_TTL_MS })
  return facts
}
