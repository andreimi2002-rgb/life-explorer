# Development plan

| Milestone | Content | Done when |
|---|---|---|
| M0 Foundation | Repo, Netlify, React skeleton, source attribution, base tests | Empty site live, build green |
| M1 Search | Autocomplete via GBIF `/species/suggest`, common and scientific names, error handling | "wolf", "oak", "frog" return correct species |
| M2 Species page | Name, rank, status (accepted or synonym), classification, licensed photo with author, source links | 30 test species render, with a no-photo fallback |
| M3 Tree of life | Lineage from kingdom to species, paginated children, navigate up and down | Can walk from "Life" to a species and back |
| M4 Map | Distribution from GBIF occurrences on Leaflet | Map loads for test species |
| M5 Educational | Random species, "which group is it?" quiz, compare two species with common ancestor | At least two playable modes |
| M6 Polish | Accessibility, PWA, browser cache, performance, E2E tests | Good Lighthouse scores, tests green |
| M7 Extras | IUCN status, thematic filters (venomous, pathogens) | Optional |

## Rules
- One branch per milestone; tests and build before every Deploy Preview; merge only with explicit approval.
- Fixed search benchmark including ambiguous names ("jaguar", "python", "mouse"). When no good result exists, say so instead of showing unrelated results.
- Always attribute data sources and photo licences.
