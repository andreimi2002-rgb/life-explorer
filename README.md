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
- Profile photos are selected from verified Wikipedia/Wikimedia Commons lead
  images first, then licensed iNaturalist taxon or observation photos; otherwise
  a clear no-photo fallback appears. Every displayed image shows its author,
  licence, source link and, where needed, the represented member taxon.
- Responsive search and profile pages.

**M3 is complete.** M4a photo selection is implemented on the `m4a-photos`
branch: profiles prefer a verified Commons lead image, then an iNaturalist
photo with a reusable licence and attribution. The exact-match Wikipedia lead
description (the baseline for M4b) is already available; measuring its coverage
and extending descriptions comes next.

## Data and coverage

Data is requested from upstream sources when needed; the app does not download
or bundle a copy of every species. Large result sets and taxonomic groups are
explored page by page. Coverage, names, and classifications depend on the
upstream catalogue, so an absent result does not prove that an organism does
not exist. Life Explorer shows information only when it can be linked to a
taxon and source; uncertain supplemental facts are omitted.

## Data sources

- [GBIF](https://www.gbif.org) — names and taxonomic classification.
- [iNaturalist](https://www.inaturalist.org) — taxon names and licensed photos
  with contributor attribution.
- [Wikidata](https://www.wikidata.org) — links GBIF taxon identifiers to
  matching Wikipedia articles.
- [Wikipedia](https://www.wikipedia.org) — English descriptions, shown with
  article attribution and licence information.
- [Wikimedia Commons](https://commons.wikimedia.org) — lead images with verified
  author, reuse licence, and source link.

Planned, not yet integrated:

- [Catalogue of Life](https://www.catalogueoflife.org) — possible future
  taxonomic reference for data reconciliation.
- Paleobiology Database and Wikispecies — candidates to assess after measuring
  information coverage; not currently connected.

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
per milestone and checked with a Netlify Deploy Preview. Never merge or push to
`main`: production deployments cost Netlify credits, and the owner's budget is
limited. Deploy Previews are free.
