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
| M3 General search and taxonomy explorer (complete) | Shared GBIF client with short-lived in-memory cache, broader search, synonyms/common names, taxon pages, paginated child taxa, navigate to parent/child and browser history | Any available group can be explored through its paginated hierarchy; benchmark groups include Rhinocerotidae, Canidae, Felidae, Fagaceae, Ranidae and Pythonidae |
| M4a Photos (complete) | Resolve a verified Wikipedia/Commons lead image first, then any licensed iNaturalist taxon or observation photo, then the existing no-photo fallback | Benchmark taxa show photos only with author, licence and source link; higher-rank photos identify the member species shown or state when the member is not identifiable |
| M4b Descriptions (complete) | Existing exact-match Wikipedia lead description; measure coverage, then consider a second exact matching tier, article sections, Wikidata facts, labelled ancestor and data-based fallbacks | Every description or fact shows source, link and licence; uncertain matches are omitted and missing articles have a useful labelled fallback |
| M4c Extinct vs living (complete) | Classify taxa as living, extinct or unknown; distinguish recent extinction from prehistoric/fossil taxa | Profiles and child lists show status accurately, with unknown never treated as living |
| M4d Information grouping and coverage | Fetch information flags in batches and group children by available information; add kingdom-level coverage reporting | No request per child; grouping remains consistent within pages and low-information taxa stay reachable |
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

- One branch per milestone or sub-milestone. Run tests and build before
  requesting a Deploy Preview. Never merge or push to `main`; Deploy Previews
  are free and production deployments consume the owner's limited Netlify
  credits.
- Test varied ranks and kingdoms, plus ambiguous names such as "jaguar",
  "python", and "mouse"; these are reusable benchmark cases, not special-case
  implementations.
- Attribute source data and photo licences. Only display photos when the
  contributor and compatible licence can be shown.
- Supplemental facts must match the selected taxon confidently. Omit facts
  when identity or source attribution is uncertain.
- Wikipedia descriptions are discovered through the exact GBIF identifier
  (Wikidata property P846) and must also have an exact scientific-name match
  (Wikidata property P225). Do not use fuzzy title/name search as a fallback.

## M4 scope and rules

Current state: profiles show the English Wikipedia lead paragraph, found
through Wikidata using the GBIF key (P846) and exact scientific name (P225),
with Wikipedia, Wikidata and CC BY-SA attribution. The work below extends that
baseline.

### Photos (M4a)

- Use one `resolvePhoto(taxon)` function that returns
  `{url, author, licence, source}` or `null`; the rest of the app should not
  depend on which source supplied the photo.
- Priority: (1) Wikipedia/Commons lead image when the article is matched through
  Wikidata, the file exists on Commons, and Commons metadata provides licence
  and author; (2) the first iNaturalist taxon photo with an accepted licence
  and attribution, not only the default photo; (3) the existing no-photo
  fallback.
- Reuse the image fields in the Wikipedia summary response when available.
- Skip likely non-organism images (maps, ranges, diagrams, skulls, fossils,
  illustrations and SVGs) when a better source exists.
- For genera and higher groups, label a photo that shows one member species.
- Always show author, licence and source link under the photo.
- A small gallery mixing both sources is optional future work.
- Benchmark cheetah (iNaturalist default photo rejected, Wikipedia suitable),
  a taxon only on iNaturalist, a microorganism with no photo, and a taxon whose
  lead image is a map.
- Wikimedia Commons image lookup is now implemented; retain the verification,
  fallback and attribution requirements above as acceptance criteria.
- The resolver and mocked fallback cases are implemented on `m4a-photos`;
  Cheetah was checked against live GBIF, Wikidata, Wikipedia, Commons and
  iNaturalist APIs.

### Descriptions (M4b)

- Do not guess. Show text only when the taxon match is confident; otherwise
  omit it.
- First measure how many taxa the current GBIF-key lookup misses, since not
  every Wikidata taxon item carries a GBIF key.
- If the GBIF-key lookup finds nothing, a second tier may use an exact
  scientific name (P225) only when the result is unique and rank and ancestry
  also match. Do not use fuzzy title search. The iNaturalist `wikipedia_url`
  may also be considered for taxa already matched by exact name and rank.
- Replace per-profile SPARQL requests with a lighter lookup that can later run
  in batches for M4d.
- Where available, show selected article sections (for example description,
  distribution and habitat, behaviour, diet and ecology) as separate short
  blocks with the same attribution.
- Add a quick-facts card for available Wikidata properties (for example
  conservation status, main food source and habitat), each with a source link;
  omit absent fields.
- A taxon without its own article may show a nearby ancestor's description,
  labelled as such (for example, "About the genus X"). Implemented: nearest
  genus, family, order or class with an exact match; kingdom and phylum are
  skipped.
- Status: the second exact-name tier is implemented. On a 41-taxon live sample
  it found nothing extra, because those taxa have no Wikidata article at all;
  the tier is kept as a safe, tested fallback.
- Implemented: selected article sections (habitat, behaviour, diet, ecology,
  description; each shortened, with attribution) and a quick-facts card from
  Wikidata (IUCN status, main food source, habitat; absent fields omitted).
- Implemented: species count for genera and higher groups (GBIF Backbone), rank-
  dependent section order, a fallback message that names the parent taxon, and
  raw source errors moved into a collapsed "Technical details" block.
- Not done: replacing per-profile SPARQL requests with a batch-friendly lookup
  (to be done together with M4d), names in other languages, countries and
  observation counts.
- Data-based facts such as child-taxon counts, names in other languages,
  countries and observation counts are allowed with source attribution.
- Adapt the panel by rank: species emphasise habitat, behaviour and diet;
  genera and higher groups emphasise how many species they include, with
  examples linking to children.
- Replace empty-panel messaging with a useful fallback. Keep raw error text in
  a developer-friendly place rather than showing it as biological information.
- AI-generated descriptions are not used unless clearly labelled and separately
  approved. A Romanian Wikipedia toggle is a possible later enhancement.

### Extinct vs living (M4c)

- Use three states: living, extinct and unknown. Unknown must never default to
  living.
- Evaluate signals in order of trust: iNaturalist `extinct`; IUCN status from
  Wikidata/Wikipedia (Extinct or Extinct in the wild); GBIF flags or geological
  period where available; Paleobiology Database for fossil taxa; fossil
  specimen records as a weak signal. Measure how often each signal exists.
- Distinguish recently extinct (with date where known) from prehistoric/fossil.
- Add a dagger badge, Living / Extinct / All filter, living taxa first and
  extinct taxa grouped separately; mark extinct taxa in the classification
  path.
- Check whether GBIF child listings can be filtered server-side. If not, group
  taxa within each page rather than across pages.
- Paleobiology Database and other additional sources are candidates to assess,
  not currently integrated.

Status (implemented): profile badge from GBIF, iNaturalist and IUCN-via-Wikidata
signals; "Living" only with positive evidence; conflicts stay unknown. Child
lists use GBIF `isExtinct` searches for the Living/Extinct filters (all
descendants of the dominant child rank) and flag sets for badges and in-page
grouping on All (capped at 2000 flags per set, otherwise "unchecked"). Not done:
marking extinct ancestors in the classification path (no batch lookup), a
recent-vs-prehistoric date, and PBDB.

### Information grouping (M4d)

- Fetch information flags in batches per page of children (Wikipedia accepts
  up to 50 titles per request; iNaturalist `/taxa` accepts several IDs per
  request), never one request per child.
- Group taxa into with description, basic data only and little information.
  Low-information taxa must remain reachable.
- Sort and group within each page so ordering stays consistent between pages.

### Coverage measurement

- Build a script that samples a few hundred random taxa per kingdom or phylum
  and reports how many have a description, photo and extinct flag, and how
  many are missed only because of the GBIF-key lookup.
- Use the results to decide whether sources such as Paleobiology Database or
  Wikispecies are worth adding and how to handle taxa that remain without
  information. These sources are candidates only, not implemented.

### Cleanup

- Replace the hard-coded `COMMON_NAME_ALIASES` (wolf, mouse, rhino) with
  data-driven matching, in line with the no-special-cases rule.

### Suggested order

1. M4a Photos.
2. Coverage script.
3. M4b extensions (second matching tier, ancestor fallback, sections and quick
   facts).
4. M4c Extinct vs living.
5. M4d Information grouping.
6. Consider additional sources for information that remains unavailable.
