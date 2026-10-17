# Life Explorer

Explore the tree of life: search any species, browse its taxonomy, see maps and licensed photos. English only.

## Data sources
- [GBIF](https://www.gbif.org) — species search, taxonomy, occurrences
- [Catalogue of Life](https://www.catalogueoflife.org) — taxonomic backbone
- [iNaturalist](https://www.inaturalist.org) — photos with explicit licences

No API keys are required.

Species search supports scientific-name autocomplete and English common-name
search through GBIF. Select a result to view its names and GBIF record.

## Development
```
npm install
npm run dev
npm test
npm run build
```

Workflow: one branch per milestone, tests and build, a Netlify Deploy Preview, then merge only after approval. See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md).
