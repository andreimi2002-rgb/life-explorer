import React from 'react'
import { createRoot } from 'react-dom/client'
import { SOURCES } from './sources.js'
import './styles.css'

function App() {
  return (
    <main>
      <header>
        <h1>Life Explorer</h1>
        <p>Explore the tree of life: search any species and browse its taxonomy.</p>
      </header>
      <section aria-labelledby="status">
        <h2 id="status">Coming soon</h2>
        <p>Species search, the tree of life, maps and photos are being built step by step.</p>
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
