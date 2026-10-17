import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SOURCES } from './sources.js'
import { searchSpecies } from './species.js'
import './styles.css'

function App() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ scientific: [], common: [] })
  const [status, setStatus] = useState('idle')
  const [searchError, setSearchError] = useState('')
  const [selectedSpecies, setSelectedSpecies] = useState(null)
  const term = query.trim()

  useEffect(() => {
    setSelectedSpecies(null)
    if (term.length < 2) {
      setResults({ scientific: [], common: [] })
      setStatus('idle')
      setSearchError('')
      return undefined
    }

    const controller = new AbortController()
    setResults({ scientific: [], common: [] })
    setStatus('loading')
    setSearchError('')
    const timeout = window.setTimeout(async () => {
      try {
        setResults(await searchSpecies(term, { signal: controller.signal }))
        setStatus('success')
      } catch (error) {
        if (!controller.signal.aborted) {
          setResults({ scientific: [], common: [] })
          setSearchError(error.message)
          setStatus('error')
        }
      }
    }, 250)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [term])

  const totalResults = results.scientific.length + results.common.length
  const selectSpecies = (species) => {
    setSelectedSpecies(species)
  }

  return (
    <main>
      <header>
        <h1>Life Explorer</h1>
        <p>Explore the tree of life: search any species and browse its taxonomy.</p>
      </header>
      <section aria-labelledby="search-heading">
        <h2 id="search-heading">Search species</h2>
        <label htmlFor="species-search">Common or scientific name</label>
        <input
          id="species-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try wolf, oak or frog"
          autoComplete="off"
          aria-describedby="search-help search-status"
        />
        <p id="search-help">Enter at least two characters. Search results are provided by GBIF.</p>
        <p id="search-status" role="status" aria-live="polite">
          {term.length < 2 && term
            ? 'Enter at least two characters to search.'
            : status === 'loading'
              ? 'Searching GBIF…'
              : status === 'error'
                ? `Search failed: ${searchError}`
                : status === 'success' && totalResults === 0
                  ? 'No matching species found.'
                  : status === 'success'
                    ? `${totalResults} results found.`
                    : ''}
        </p>

        {results.scientific.length > 0 && (
          <section aria-labelledby="scientific-results-heading">
            <h3 id="scientific-results-heading">Scientific-name matches</h3>
            <ul className="results">
              {results.scientific.map((species) => (
                <li key={`scientific-${species.key}`}>
                  <button type="button" onClick={() => selectSpecies(species)}>
                    <span className="species-name">{species.canonicalName || species.scientificName}</span>
                    {species.rank && <span>{species.rank.toLowerCase()}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {results.common.length > 0 && (
          <section aria-labelledby="common-results-heading">
            <h3 id="common-results-heading">Common-name matches</h3>
            <ul className="results">
              {results.common.map((species) => (
                <li key={`common-${species.key}`}>
                  <button type="button" onClick={() => selectSpecies(species)}>
                    <span className="species-name">{species.vernacularNames.join(', ')}</span>
                    <span>{species.scientificName}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {selectedSpecies && (
          <section aria-labelledby="selected-species-heading">
            <h3 id="selected-species-heading">Selected species</h3>
            {selectedSpecies.vernacularNames?.length > 0 && (
              <p>{selectedSpecies.vernacularNames.join(', ')}</p>
            )}
            <p><i>{selectedSpecies.scientificName}</i></p>
            {selectedSpecies.rank && <p>Rank: {selectedSpecies.rank.toLowerCase()}</p>}
            <a href={`https://www.gbif.org/species/${selectedSpecies.key}`}>
              View on GBIF
            </a>
          </section>
        )}
      </section>
      <footer>
        <h2>Data sources</h2>
        <ul>
          {SOURCES.map((s) => (
            <li key={s.name}>
              <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> — {s.use}
            </li>
          ))}
        </ul>
      </footer>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<App />)
