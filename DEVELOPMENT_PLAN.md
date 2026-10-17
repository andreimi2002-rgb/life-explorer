# Development plan

## Product direction

Life Explorer is a general-purpose explorer of biodiversity data, not a set of
hand-built pages for selected species. Search, taxonomic navigation, and species
profiles must use the same data-driven flow for any taxon available from our
sources.

Data is requested on demand and paginated. We do not download or maintain a
copy of every species. Coverage, names, and classifications depend on the
upstream dataset; missing or uncertain data must be identified rather than
guessed.

## Milestones

| Milestone | Content | Done when |
|---|---|---|
| M0 Foundation | Repository, Netlify, React shell, source attribution, base tests | Site deploys and build is green |
| M1 Search | GBIF scientific and English common-name search, useful result ordering, loading and error states | Search returns relevant results and empty/error states are clear |
| M2 Taxon profile | Names, taxonomic status, classification, licensed iNaturalist photo and source links | Search results open a shareable profile with a no-photo fallback |
| M3 General search and taxonomy explorer | Shared GBIF client with short-lived in-memory cache, broader search, synonyms/common names, taxon pages, paginated child taxa, navigate to parent/child and browser history | Any available group can be explored through its paginated hierarchy; benchmark groups include Rhinocerotidae, Canidae, Felidae, Fagaceae, Ranidae and Pythonidae |
| M4 Species information | Enrich profiles with descriptions and habitat from Wikidata/Wikipedia when identity matching is reliable; show attribution and source links | Supplemental facts link to a confidently matched taxon and absent/uncertain facts are omitted |
| M5 Distribution map | GBIF occurrence-based map with caveats about observation coverage | Maps load for different taxa and clearly distinguish records from complete range |
| M6 Learning features | Random taxon, identification quiz, compare taxa and common ancestry | At least two complete, playable modes work with general taxon data |
| M7 Quality and delivery | Accessibility, responsive polish, PWA, caching/performance, end-to-end tests | Core flows pass automated checks and performance targets |
| M8 Optional data | Conservation status and thematic filters where reliable data is available | Each added field has a clear source, attribution, and missing-data behavior |

## M3 scope and acceptance

- Search scientific names, English common names, and GBIF synonyms where
  available. Common names from iNaturalist may be used only after an exact,
  accepted GBIF name-and-rank match. Results are ranked, not treated as a
  complete list.
- Show result totals and paginate larger search result sets rather than silently
  implying a limited first page contains every match.
- Open taxon profiles for species and higher groups. Browse a group's direct
  children in pages, then continue into child groups until reaching species.
- Parent and child navigation must work for arbitrary GBIF taxa; no species-
  specific branches or hard-coded taxonomic trees.
- Validate the flow with multiple groups and names, including "rhino" /
  "rhinoceros" and Rhinocerotidae. Users can explore all records returned by
  GBIF by moving through groups and pages; this does not imply that GBIF's
  catalogue is a complete inventory of life.
- Reuse fetched GBIF responses in a short-lived in-memory cache. Cache only
  requested records/pages; do not bulk-download biodiversity datasets.
- Keep source errors visible. Unknown, absent, or ambiguous data must not be
  presented as a successful match.
- Omit unranked and non-accepted GBIF records from user-facing search and child
  lists; keep scientific-name matches secondary when the query is a familiar
  name.
- Keep the current query in the URL so returning from a taxon restores the
  matching result list instead of the landing page.

## Workflow and data rules

- One branch per milestone. Run tests and build before requesting a Deploy
  Preview. Merge to `main` only with explicit approval.
- Test varied ranks and kingdoms, plus ambiguous names such as "jaguar",
  "python", and "mouse"; these are reusable benchmark cases, not special-case
  implementations.
- Attribute source data and photo licences. Only display photos when the
  contributor and compatible licence can be shown.
- Supplemental facts must match the selected taxon confidently. Omit facts
  when identity or source attribution is uncertain.
