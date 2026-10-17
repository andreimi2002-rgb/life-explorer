# Life Explorer

Life Explorer is a field guide to the tree of life. Search an organism by common
or scientific name, open its taxon profile, and follow its classification.
The same search and navigation flows are designed to work across taxa rather
than being built separately for individual species.

## Current features

- Ranked GBIF scientific-name results and English common names from GBIF and
  iNaturalist, cross-checked against an exact accepted GBIF taxon match.
- Familiar-name matches are prioritized; scientific-name matches stay
  collapsed unless there are no common-name results.
- Taxon profiles with common and scientific names, rank, status, and
  navigable classification.
- Taxonomic child lists omit unranked and non-accepted backbone records.
- Search URLs preserve the query so returning from a profile restores its
  result list.
- English Wikipedia descriptions appear when Wikidata links the exact GBIF
  taxon key and scientific name to an article; the article, Wikidata match, and
  reuse licence are shown alongside the text.
- iNaturalist photos only when the taxon match, contributor attribution, and a
  Creative Commons licence can be verified; otherwise a clear no-photo fallback.
- Responsive search and profile pages.

**M4 is in progress:** connecting exact GBIF taxa to English Wikipedia articles
through Wikidata, then measuring which taxa still lack descriptions before
choosing additional sources.

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
- [Wikidata](https://www.wikidata.org) — links GBIF taxon identifiers to
  matching Wikipedia articles.
- [Wikipedia](https://www.wikipedia.org) — English descriptions, shown with
  article attribution and licence information.
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
