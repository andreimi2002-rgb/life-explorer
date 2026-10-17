const GBIF_API = 'https://api.gbif.org/v1'
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

export async function requestGbif(path, params = {}, {
  signal,
  fetchImpl = fetch,
} = {}) {
  const url = new URL(`${GBIF_API}${path}`)
  url.search = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
  )
  const cache = cacheFor(fetchImpl)
  const cacheKey = url.toString()
  const cached = cache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }
  if (cached) cache.delete(cacheKey)

  const response = await fetchImpl(url, { signal })
  if (!response.ok) {
    throw new Error(`GBIF request failed (${response.status})`)
  }

  const data = await response.json()
  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  return data
}
