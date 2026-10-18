const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php'
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_SECTION_LENGTH = 800
const MIN_SECTION_LENGTH = 80
const responseCaches = new WeakMap()

// Only these article headings are shown; anything else is ignored.
const WANTED_SECTIONS = [
  {
    id: 'habitat',
    label: 'Distribution and habitat',
    pattern: /^(distribution( and habitat)?|habitat( and distribution)?|range|geographic range|distribution and ecology)$/i,
  },
  {
    id: 'behaviour',
    label: 'Behaviour',
    pattern: /^(behaviou?r|social behaviou?r|behaviou?r and ecology|ecology and behaviou?r)$/i,
  },
  {
    id: 'diet',
    label: 'Diet',
    pattern: /^(diet|feeding|diet and feeding|feeding ecology|diet and hunting|hunting and diet)$/i,
  },
  {
    id: 'ecology',
    label: 'Ecology and life cycle',
    pattern: /^(ecology|biology|life cycle|life history|reproduction|breeding|reproduction and life cycle|life cycle and reproduction)$/i,
  },
  {
    id: 'description',
    label: 'Description',
    pattern: /^(description|characteristics|morphology|appearance|physical description)$/i,
  },
]

const SPECIES_ORDER = ['habitat', 'behaviour', 'diet', 'ecology', 'description']
const GROUP_ORDER = ['description', 'ecology', 'habitat', 'behaviour', 'diet']

function cacheFor(fetchImpl) {
  let cache = responseCaches.get(fetchImpl)
  if (!cache) {
    cache = new Map()
    responseCaches.set(fetchImpl, cache)
  }
  return cache
}

function shorten(text) {
  if (text.length <= MAX_SECTION_LENGTH) return text
  const cut = text.slice(0, MAX_SECTION_LENGTH)
  const lastSentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'))
  return lastSentence > MIN_SECTION_LENGTH ? cut.slice(0, lastSentence + 1) : `${cut.trimEnd()}…`
}

export function parseSections(extract, rank) {
  const lines = extract.split('\n')
  const sections = []
  let current = null
  for (const line of lines) {
    const heading = line.match(/^(={2,})\s*(.+?)\s*\1\s*$/)
    if (heading && heading[1].length === 2) {
      current = { heading: heading[2], lines: [] }
      sections.push(current)
    } else if (heading) {
      // Deeper headings stay part of the parent section as plain text.
      current?.lines.push(heading[2])
    } else if (current) {
      current.lines.push(line)
    }
  }

  const found = []
  for (const wanted of WANTED_SECTIONS) {
    const section = sections.find((candidate) => wanted.pattern.test(candidate.heading))
    if (!section) continue
    const text = shorten(section.lines.join('\n').replace(/\n{2,}/g, '\n').trim())
    if (text.length < MIN_SECTION_LENGTH) continue
    found.push({ id: wanted.id, label: wanted.label, heading: section.heading, text })
  }

  const order = ['SPECIES', 'SUBSPECIES'].includes(rank) ? SPECIES_ORDER : GROUP_ORDER
  return found.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
}

export async function loadArticleSections(articleUrl, rank, {
  signal,
  fetchImpl = fetch,
} = {}) {
  const url = new URL(articleUrl)
  if (url.hostname !== 'en.wikipedia.org' || !url.pathname.startsWith('/wiki/')) {
    throw new Error('Invalid Wikipedia article link')
  }
  const title = decodeURIComponent(url.pathname.slice('/wiki/'.length))

  const cache = cacheFor(fetchImpl)
  const cacheKey = `${title}:${rank}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  if (cached) cache.delete(cacheKey)

  const requestUrl = new URL(WIKIPEDIA_API)
  requestUrl.search = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    exsectionformat: 'wiki',
    redirects: '1',
    titles: title,
    format: 'json',
    formatversion: '2',
    origin: '*',
  })
  const response = await fetchImpl(requestUrl, { signal })
  if (!response.ok) throw new Error(`Wikipedia sections request failed (${response.status})`)
  const data = await response.json()
  const page = data.query?.pages?.[0]
  if (!page) throw new Error('Wikipedia returned an unexpected sections response')

  const sections = typeof page.extract === 'string' && !page.missing
    ? parseSections(page.extract, rank)
    : []
  cache.set(cacheKey, { data: sections, expiresAt: Date.now() + CACHE_TTL_MS })
  return sections
}
