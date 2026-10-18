# Life Explorer — instructions for GitHub Copilot

## About the owner

- The owner does not program. Explain changes in simple Romanian and say what
  to check in the browser.
- Ask before irreversible actions. Do not make changes directly on `main`.

## Project

Life Explorer is a React + Vite field guide with taxon profiles and a paginated
taxonomy explorer. It requests data on demand from GBIF, iNaturalist, Wikidata
and Wikipedia; it does not store or bundle species datasets.

Read `DEVELOPMENT_PLAN.md` before starting and work only on the milestone or
sub-milestone the owner names.

## Commands

- `npm install` — install dependencies when needed.
- `npm run dev` — start the local development server.
- `npm test` — run tests with Node's built-in test runner (`node --test`).
- `npm run coverage` — sample taxa and write a local coverage report (not part of the site).
- `npm run build` — create the production build; Netlify publishes `dist`.

## Code map

- `src/main.jsx` — search, results, taxon profile and child-taxon UI.
- `src/gbif.js` — GBIF requests and short-lived in-memory response cache.
- `src/species.js` — GBIF and iNaturalist name search and result ranking.
- `src/speciesDetail.js` — profile data, iNaturalist photo and Wikipedia data.
- `src/wikipedia.js` — exact GBIF-to-Wikidata matching and Wikipedia lead
  descriptions.
- `src/sources.js` — the data-source list shown in the app.
- `src/styles.css` — application styles.
- `src/*.test.js` — Node tests for data modules and source metadata.

## Data rules

- Do not guess. Omit information when taxon identity or attribution is uncertain.
- Show source links and required attribution/licence for external content.
  Photos require a contributor and a compatible licence.
- Unknown must remain unknown; do not treat it as a known value.
- Do not add species-specific code paths. Benchmark taxa are test cases, not
  hard-coded branches.
- Do not bulk-download datasets. Request data on demand, batch when supported,
  and cache briefly.
- Keep source errors visible; do not present failures as successful empty data.
- When a source is implemented, update `src/sources.js` and the README's data
  source list. Describe future sources as planned, not as already integrated.

## Workflow

1. Work on one branch per milestone or sub-milestone; never work directly on
   `main`.
2. Add or update mocked tests for changes and run `npm test` and
   `npm run build` before completion.
3. Check real APIs for benchmark taxa named in the plan when relevant, and
   report what they returned.
4. Summarise in Romanian: what changed, what to check in the Deploy Preview,
   and what is not finished.
5. If the plan is unclear or an API behaves differently than expected, stop and
   ask instead of improvising.
6. Keep each request focused to limit unnecessary work.

Every production deploy on Netlify costs credits and the owner's budget is small. Never merge or push to main. Work only on branches; Deploy Previews are free.
