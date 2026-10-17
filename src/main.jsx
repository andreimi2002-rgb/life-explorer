import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SOURCES } from './sources.js'
import { searchSpecies } from './species.js'
import { loadSpeciesDetail } from './speciesDetail.js'
import './styles.css'

const EXAMPLE_SEARCHES = ['wolf', 'oak', 'frog', 'jaguar', 'python', 'mouse']

function LeafMark() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M31.8 7.4C18.2 7.1 8.2 12.1 8.2 22.1c0 5.1 3.4 8.2 7.9 8.2 10.5 0 15.7-10.1 15.7-22.9Z" />
      <path d="M7.7 33.1c4.2-7.5 9.8-12 17-15.3" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.4 15.4 4.1 4.1" />
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M11.5 3.5h5v5M16.2 3.8 9 11M15 10.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5h5" />
    </svg>
  )
}

function formatRank(rank = '') {
  return rank.toLocaleLowerCase().replaceAll('_', ' ')
}

function SearchResults({ results, onSelect }) {
  const total = results.scientific.length + results.common.length
  if (!total) return null

  return (
    <section className="search-results" aria-label="Search results">
      <div className="results-heading">
        <div>
          <span className="eyebrow">The field guide</span>
          <h2>Search results</h2>
        </div>
        <span className="result-count">{total} matches</span>
      </div>

      {results.common.length > 0 && (
        <section className="result-group" aria-labelledby="common-results-heading">
          <div className="group-heading">
            <h3 id="common-results-heading">Common names</h3>
            <span>Matched by familiar name</span>
          </div>
          <ul className="results">
            {results.common.map((species) => (
              <li key={`common-${species.key}`}>
                <button type="button" className="result-card" onClick={() => onSelect(species)}>
                  <span className="result-card-top">
                    <span className="rank-pill">{formatRank(species.rank)}</span>
                    <span className="result-arrow" aria-hidden="true">↗</span>
                  </span>
                  <span className="species-name">{species.vernacularNames.join(', ')}</span>
                  <span className="result-scientific"><i>{species.scientificName}</i></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results.scientific.length > 0 && (
        <section className="result-group" aria-labelledby="scientific-results-heading">
          <div className="group-heading">
            <h3 id="scientific-results-heading">Scientific names</h3>
            <span>Matched by taxonomy</span>
          </div>
          <ul className="results">
            {results.scientific.map((species) => (
              <li key={`scientific-${species.key}`}>
                <button type="button" className="result-card" onClick={() => onSelect(species)}>
                  <span className="result-card-top">
                    <span className="rank-pill">{formatRank(species.rank)}</span>
                    <span className="result-arrow" aria-hidden="true">↗</span>
                  </span>
                  <span className="species-name"><i>{species.canonicalName || species.scientificName}</i></span>
                  <span className="result-scientific">{species.scientificName}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}

function SpeciesDetail({ detail, onNavigateTaxon, onBack }) {
  const accepted = detail.taxonomicStatus?.toLocaleUpperCase() === 'ACCEPTED'
  const displayName = detail.preferredCommonName || detail.vernacularNames[0] || detail.canonicalName
  const alternateNames = detail.vernacularNames.filter((name) =>
    name.toLocaleLowerCase() !== displayName.toLocaleLowerCase(),
  )

  return (
    <article className="species-page">
      <button type="button" className="back-link" onClick={onBack}>
        <span aria-hidden="true">←</span> Back to search
      </button>

      <section className="species-hero">
        <div className="species-hero-copy">
          <span className="eyebrow">Species field note</span>
          <div className="hero-pills">
            <span className="rank-pill">{formatRank(detail.rank)}</span>
            <span className={`status-pill ${accepted ? 'is-accepted' : 'is-other'}`}>
              <span aria-hidden="true" />
              {formatRank(detail.taxonomicStatus || 'status unavailable')}
            </span>
          </div>
          <h1>{displayName}</h1>
          {alternateNames.length > 0 && (
            <p className="alternate-names">Also known as {alternateNames.slice(0, 3).join(' · ')}</p>
          )}
          <p className="detail-scientific"><i>{detail.canonicalName}</i></p>
          {detail.authorship && <p className="detail-authorship">{detail.authorship}</p>}
          <p className="detail-intro">
            Explore this organism’s place in the tree of life, from its broad group to its
            scientific classification.
          </p>
        </div>

        <figure className={`species-photo ${detail.photo ? '' : 'photo-placeholder'}`}>
          {detail.photo ? (
            <>
              <img src={detail.photo.url} alt={`Licensed photograph of ${detail.canonicalName}`} />
              <figcaption>
                <a href={detail.photo.pageUrl} target="_blank" rel="noreferrer">
                  {detail.photo.attribution || 'Photo contributor'}
                </a>
                {' · '}
                <a href={detail.photo.licenseUrl} target="_blank" rel="noreferrer">
                  {detail.photo.license}
                </a>
              </figcaption>
            </>
          ) : (
            <div className="photo-fallback" role="img" aria-label="No licensed photograph available">
              <span className="fallback-orbit orbit-one" />
              <span className="fallback-orbit orbit-two" />
              <span className="fallback-plant">✳</span>
              <span className="fallback-caption">
                {detail.photoError
                  ? 'Could not load a licensed photo right now.'
                  : 'No licensed photo available yet.'}
              </span>
            </div>
          )}
        </figure>
      </section>

      <div className="detail-grid">
        <section className="detail-card taxonomy-card" aria-labelledby="classification-heading">
          <div className="card-heading">
            <span className="card-icon" aria-hidden="true">⌘</span>
            <div>
              <span className="eyebrow">Where it belongs</span>
              <h2 id="classification-heading">Classification</h2>
            </div>
          </div>
          <ol className="taxonomy-list">
            {detail.classification.map((taxon, index) => (
              <li key={`${taxon.key}-${taxon.rank}`} className={index === detail.classification.length - 1 ? 'current-taxon' : ''}>
                <span className="taxonomy-connector" aria-hidden="true" />
                <span className="taxonomy-rank">{formatRank(taxon.rank)}</span>
                {taxon.key === detail.key ? (
                  <span className="taxonomy-name"><i>{taxon.name}</i></span>
                ) : (
                  <button type="button" className="taxonomy-link" onClick={() => onNavigateTaxon(taxon.key)}>
                    <i>{taxon.name}</i><span aria-hidden="true">↗</span>
                  </button>
                )}
              </li>
            ))}
          </ol>
          <p className="taxonomy-hint">Select a group to explore it.</p>
        </section>

        <section className="detail-card facts-card" aria-labelledby="facts-heading">
          <div className="card-heading">
            <span className="card-icon" aria-hidden="true">✳</span>
            <div>
              <span className="eyebrow">At a glance</span>
              <h2 id="facts-heading">Taxon details</h2>
            </div>
          </div>
          <dl className="fact-list">
            <div>
              <dt>Kingdom</dt>
              <dd>{detail.kingdom || 'Not listed'}</dd>
            </div>
            {detail.class && (
              <div>
                <dt>Class</dt>
                <dd>{detail.class}</dd>
              </div>
            )}
            {detail.family && (
              <div>
                <dt>Family</dt>
                <dd>{detail.family}</dd>
              </div>
            )}
            <div>
              <dt>GBIF key</dt>
              <dd>{detail.key}</dd>
            </div>
          </dl>
          <a
            className="source-link"
            href={`https://www.gbif.org/species/${detail.key}`}
            target="_blank"
            rel="noreferrer"
          >
            Open full record on GBIF <ExternalIcon />
          </a>
        </section>
      </div>
      <p className="detail-attribution">
        Classification and names: <a href="https://www.gbif.org" target="_blank" rel="noreferrer">GBIF</a>.
        {' '}Photographs are shown only when a Creative Commons licence is available.
      </p>
    </article>
  )
}

function App() {
  const initialUrl = new URL(window.location.href)
  const [query, setQuery] = useState(initialUrl.searchParams.get('q') || '')
  const [results, setResults] = useState({ scientific: [], common: [] })
  const [searchStatus, setSearchStatus] = useState('idle')
  const [searchError, setSearchError] = useState('')
  const [selectedKey, setSelectedKey] = useState(initialUrl.searchParams.get('species') || '')
  const [detail, setDetail] = useState(null)
  const [detailStatus, setDetailStatus] = useState('idle')
  const [detailError, setDetailError] = useState('')
  const term = query.trim()

  useEffect(() => {
    document.title = detail
      ? `${detail.preferredCommonName || detail.canonicalName} — Life Explorer`
      : 'Life Explorer — Explore the tree of life'
  }, [detail])

  useEffect(() => {
    const handlePopState = () => {
      const url = new URL(window.location.href)
      setSelectedKey(url.searchParams.get('species') || '')
      setQuery(url.searchParams.get('q') || '')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (term.length < 2) {
      setResults({ scientific: [], common: [] })
      setSearchStatus('idle')
      setSearchError('')
      return undefined
    }

    const controller = new AbortController()
    setResults({ scientific: [], common: [] })
    setSearchStatus('loading')
    setSearchError('')
    const timeout = window.setTimeout(async () => {
      try {
        setResults(await searchSpecies(term, { signal: controller.signal }))
        setSearchStatus('success')
      } catch (error) {
        if (!controller.signal.aborted) {
          setResults({ scientific: [], common: [] })
          setSearchError(error.message)
          setSearchStatus('error')
        }
      }
    }, 250)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [term])

  useEffect(() => {
    if (!selectedKey) {
      setDetail(null)
      setDetailStatus('idle')
      return undefined
    }

    const controller = new AbortController()
    setDetail(null)
    setDetailStatus('loading')
    setDetailError('')
    loadSpeciesDetail(selectedKey, { signal: controller.signal })
      .then((species) => {
        setDetail(species)
        setDetailStatus('success')
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setDetailError(error.message)
          setDetailStatus('error')
        }
      })

    return () => controller.abort()
  }, [selectedKey])

  const selectSpecies = (species) => {
    const url = new URL(window.location.href)
    url.searchParams.set('species', species.key)
    if (term) url.searchParams.set('q', term)
    window.history.pushState({ speciesKey: species.key }, '', url)
    setSelectedKey(String(species.key))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const navigateTaxon = (key) => {
    const url = new URL(window.location.href)
    url.searchParams.set('species', key)
    window.history.pushState({ speciesKey: key }, '', url)
    setSelectedKey(String(key))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const returnToSearch = () => {
    const url = new URL(window.location.href)
    url.searchParams.delete('species')
    if (term) url.searchParams.set('q', term)
    window.history.pushState({}, '', url)
    setSelectedKey('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const goHome = () => {
    window.history.pushState({}, '', window.location.pathname)
    setSelectedKey('')
    setQuery('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const updateQuery = (value) => {
    setQuery(value)
    if (selectedKey) {
      const url = new URL(window.location.href)
      url.searchParams.delete('species')
      url.searchParams.set('q', value)
      window.history.replaceState({}, '', url)
      setSelectedKey('')
    }
  }

  const statusText = term.length < 2 && term
    ? 'Enter at least two characters to search.'
    : searchStatus === 'loading'
      ? 'Searching the living world…'
      : searchStatus === 'error'
        ? `Search failed: ${searchError}`
        : searchStatus === 'success' &&
            results.scientific.length + results.common.length === 0
          ? 'No matching names found. Try another spelling or common name.'
          : searchStatus === 'success'
            ? `${results.scientific.length + results.common.length} matches found.`
            : ''

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" onClick={(event) => {
          event.preventDefault()
          goHome()
        }}>
          <span className="brand-mark"><LeafMark /></span>
          <span>life<span className="brand-light">explorer</span></span>
        </a>
        <nav className="header-nav" aria-label="Main navigation">
          {selectedKey ? (
            <a className="nav-cta" href="#search" onClick={(event) => {
              event.preventDefault()
              returnToSearch()
            }}>
              Back to search <span aria-hidden="true">←</span>
            </a>
          ) : (
            <>
              <a href="#how-it-works">About</a>
              <a href="#data-sources">Data sources</a>
              <a className="nav-cta" href="#search">Start exploring <span aria-hidden="true">↗</span></a>
            </>
          )}
        </nav>
      </header>

      <main>
        {selectedKey ? (
          <div className="page-wrap detail-wrap">
            {detailStatus === 'loading' && (
              <section className="detail-loading" role="status">
                <span className="loading-orb" />
                <h1>Looking up this organism…</h1>
                <p>Gathering its classification and licensed photos.</p>
              </section>
            )}
            {detailStatus === 'error' && (
              <section className="detail-error" role="alert">
                <span className="eyebrow">This record is unavailable</span>
                <h1>We couldn’t load this organism.</h1>
                <p>{detailError}</p>
                <button className="button-primary" type="button" onClick={returnToSearch}>
                  ← Back to search
                </button>
              </section>
            )}
            {detailStatus === 'success' && detail && (
              <SpeciesDetail detail={detail} onNavigateTaxon={navigateTaxon} onBack={returnToSearch} />
            )}
          </div>
        ) : (
          <>
            <section className="hero" id="search">
              <div className="hero-decoration decoration-left" aria-hidden="true">✳</div>
              <div className="hero-decoration decoration-right" aria-hidden="true">✳</div>
              <div className="hero-content">
                <span className="hero-kicker"><span /> A field guide to life on Earth</span>
                <h1>Every species<br />has a <em>story.</em></h1>
                <p className="hero-description">
                  Follow a name into the living world. Discover where an organism belongs and
                  explore the connections that make life extraordinary.
                </p>
                <form className="search-form" onSubmit={(event) => event.preventDefault()} role="search">
                  <SearchIcon />
                  <label className="visually-hidden" htmlFor="species-search">
                    Search by common or scientific name
                  </label>
                  <input
                    id="species-search"
                    type="search"
                    value={query}
                    onChange={(event) => updateQuery(event.target.value)}
                    placeholder="Search a species, e.g. red fox"
                    autoComplete="off"
                    aria-describedby="search-status"
                  />
                  {query && (
                    <button
                      className="clear-search"
                      type="button"
                      onClick={() => updateQuery('')}
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  )}
                  <span className="search-shortcut" aria-hidden="true">GBIF</span>
                </form>
                <p id="search-status" className="search-status" role="status" aria-live="polite">
                  {statusText}
                </p>
                <div className="example-searches" aria-label="Try a search">
                  <span>Try:</span>
                  {EXAMPLE_SEARCHES.map((example) => (
                    <button key={example} type="button" onClick={() => updateQuery(example)}>
                      {example}
                    </button>
                  ))}
                </div>
              </div>
              <div className="hero-footnote">
                <span>01</span>
                <span>One search. Millions of living things.</span>
                <span className="hero-line" />
              </div>
            </section>

            {searchStatus === 'loading' && (
              <div className="loading-row" role="status">
                <span className="loading-orb" />
                <span>Searching the living world…</span>
              </div>
            )}
            {searchStatus === 'error' && (
              <div className="inline-error" role="alert">{searchError}</div>
            )}
            {searchStatus === 'success' && results.scientific.length + results.common.length === 0 && (
              <section className="empty-state">
                <span aria-hidden="true">⌕</span>
                <h2>No species found this time.</h2>
                <p>Try a common name, a scientific name, or one of the examples above.</p>
              </section>
            )}
            <SearchResults results={results} onSelect={selectSpecies} />

            {!term && (
              <section className="intro-section" id="how-it-works">
                <div className="intro-copy">
                  <span className="eyebrow">A world connected</span>
                  <h2>Start with a name.<br /><em>Find its place.</em></h2>
                </div>
                <div className="intro-right">
                  <p>
                    From a familiar backyard plant to a rarely seen animal, every name opens
                    a door to a bigger picture. Begin with a search and follow the branches
                    of life wherever they lead.
                  </p>
                  <a href="#search" className="text-link">Explore the field guide <span aria-hidden="true">↗</span></a>
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="site-footer" id="data-sources">
        <div className="footer-main">
          <a className="brand footer-brand" href="/" onClick={(event) => {
            event.preventDefault()
            goHome()
          }}>
            <span className="brand-mark"><LeafMark /></span>
            <span>life<span className="brand-light">explorer</span></span>
          </a>
          <p>Curiosity is a good place to begin.</p>
          <div className="footer-sources">
            <span className="eyebrow">Built with open biodiversity data</span>
            <ul>
              {SOURCES.map((source) => (
                <li key={source.name}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.name}<ExternalIcon />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>Data provided by GBIF and iNaturalist.</span>
          <span>For the endlessly curious <span aria-hidden="true">✳</span></span>
        </div>
      </footer>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
