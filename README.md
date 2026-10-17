# Life Explorer

Life Explorer is a field guide to the tree of life. Search an organism by common
or scientific name, open its taxon profile, and follow its classification.
The same search and navigation flows are designed to work across taxa rather
than being built separately for individual species.

## Current features

- GBIF scientific-name suggestions and English common-name search.
- Taxon profiles with common and scientific names, rank, status, and
  navigable classification.
- iNaturalist photos only when the taxon match, contributor attribution, and a
  Creative Commons licence can be verified; otherwise a clear no-photo fallback.
- Responsive search and profile pages.

**M3 is in progress:** extending search for broader name coverage and adding
paginated navigation through taxonomic groups and their child taxa.

## Data and coverage

Data is requested from upstream sources when needed; the app does not download
or bundle a copy of every species. Large result sets and taxonomic groups are
explored page by page. Coverage, names, and classifications depend on the
upstream catalogue, so an absent result does not prove that an organism does
not exist. Life Explorer shows information only when it can be linked to a
taxon and source; uncertain supplemental facts are omitted.

## Data sources

- [GBIF](https://www.gbif.org) — names, taxonomic classification, and
  occurrence records.
- [iNaturalist](https://www.inaturalist.org) — taxon names and licensed photos
  with contributor attribution.
- [Wikidata](https://www.wikidata.org) and [Wikipedia](https://www.wikipedia.org)
  — planned supplemental descriptions and habitat information, with source
  links when a reliable taxon match is available.
- [Catalogue of Life](https://www.catalogueoflife.org) — an additional
  taxonomic reference for future data reconciliation.

No API keys are required for the current integrations.

## Development

```text
npm install
npm run dev
npm test
npm run build
```

Milestones, acceptance criteria, and source-data rules are in
[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md). Work is developed on one branch
per milestone, tested, and deployed to a Netlify Deploy Preview before merge.
Production merges require explicit approval.
