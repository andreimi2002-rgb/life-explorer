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
- Randomly open an accepted GBIF species with a verified photo or description,
  filtered by kingdom and living/extinct status.
- Taxonomic child lists omit unranked and non-accepted backbone records.
- Search URLs preserve the query so returning from a profile restores its
  result list.
- English Wikipedia descriptions appear when Wikidata links the taxon to an
  article by GBIF key and exact scientific name, or, when no item carries the
  GBIF key, by a unique exact name with matching rank and classification. The
  article, Wikidata match, and reuse licence are shown alongside the text.
- A taxon without its own article may show the description of its nearest
  genus, family, order or class that has one, clearly labelled as describing
  that group.
- Profile photos are selected from verified Wikipedia/Wikimedia Commons lead
  images first, then licensed iNaturalist taxon or observation photos; otherwise
  a clear no-photo fallback appears. Every displayed image shows its author,
  licence, source link and, where needed, the represented member taxon.
- Responsive search and profile pages.

**M3 and M4a are complete.** M4b (descriptions) is in progress: the strict
second name-matching tier and the labelled ancestor description are
implemented; Wikipedia article sections (habitat, behaviour, diet, ecology,
description) and Wikidata quick facts (IUCN status, food, habitat) are shown
when available, with a species count for groups. A coverage
script (`npm run coverage`) measures how many sampled taxa have a description,
photo and extinction signal.

M4c (extinct vs living) is implemented on its own branch: profiles show a
Living / † Extinct / Status unknown badge with the sources behind it, and child
lists have a Living / Extinct / All filter and a dagger mark. "Living" is shown
only with positive evidence; no evidence or conflicting sources stay unknown.
Extinct ancestors in the classification path are not marked yet.

## Data and coverage

Data is requested from upstream sources when needed; the app does not download
or bundle a copy of every species. Large result sets and taxonomic groups are
explored page by page. Coverage, names, and classifications depend on the
upstream catalogue, so an absent result does not prove that an organism does
not exist. Life Explorer shows information only when it can be linked to a
taxon and source; uncertain supplemental facts are omitted.

## Data sources

- [GBIF](https://www.gbif.org) — names, taxonomic classification and the
  extinct/not-extinct flag.
- [iNaturalist](https://www.inaturalist.org) — taxon names, licensed photos
  with contributor attribution, and an extinct flag.
- [Wikidata](https://www.wikidata.org) — links GBIF taxon identifiers to
  matching Wikipedia articles; IUCN status is used as an extinction signal.
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
npm run coverage -- --per-group 10   # coverage report, separate from the site
```

Milestones, acceptance criteria, and source-data rules are in
[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md). Work is developed on one branch
per milestone and checked with a Netlify Deploy Preview. Never merge or push to
`main`: production deployments cost Netlify credits, and the owner's budget is
limited. Deploy Previews are free.
