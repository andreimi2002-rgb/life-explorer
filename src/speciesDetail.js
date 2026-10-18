import { requestGbif } from './gbif.js'
import { loadArticleSections } from './articleSections.js'
import { loadExtinctionStatus } from './extinction.js'
import { resolvePhoto } from './photos.js'
import { loadQuickFacts } from './quickFacts.js'
import { loadWikipediaDescription } from './wikipedia.js'

const GBIF_BACKBONE_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c'

const FALLBACK_ANCESTOR_RANKS = ['GENUS', 'FAMILY', 'ORDER', 'CLASS']

// Nearest ancestor (genus up to class) with a confidently matched article.
// Kingdom and phylum are skipped because their descriptions say too little
// about a specific taxon.
async function loadAncestorDescription(parents, { signal, fetchImpl }) {
  const candidates = parents
    .map((parent, index) => ({ parent, index }))
    .filter(({ parent }) =>
      FALLBACK_ANCESTOR_RANKS.includes(parent.rank) && parent.canonicalName,
    )
    .reverse()
    .slice(0, 3)
  for (const { parent, index } of candidates) {
    const description = await loadWikipediaDescription({
      key: parent.key,
      canonicalName: parent.canonicalName,
      rank: parent.rank,
    }, {
      signal,
      fetchImpl,
      ancestorNames: parents.slice(0, index).map((item) => item.canonicalName).filter(Boolean),
    })
    if (description) {
      return { ...description, ancestorName: parent.canonicalName, ancestorRank: parent.rank }
    }
  }
  return null
}

// Lightweight preflight for Random: look only for content that the profile can
// actually display, without loading sections, facts, extinction data or counts.
export async function loadTaxonInformation(taxon, {
  signal,
  fetchImpl = fetch,
} = {}) {
  const parents = await requestGbif(`/species/${Number(taxon.key)}/parents`, {}, {
    signal,
    fetchImpl,
  })
  if (!Array.isArray(parents)) {
    throw new Error('GBIF returned an unexpected classification response')
  }

  const ancestorNames = parents.map((parent) => parent.canonicalName).filter(Boolean)
  const orderKey = parents.find((parent) => parent.rank === 'ORDER')?.key ?? null
  const wikipedia = await loadWikipediaDescription(taxon, {
    signal,
    fetchImpl,
    ancestorNames,
  })
  const ancestorDescription = wikipedia
    ? null
    : await loadAncestorDescription(parents, { signal, fetchImpl })
  const resolvedPhoto = await resolvePhoto(taxon, { wikipedia, signal, fetchImpl })

  return {
    photo: resolvedPhoto.photo,
    wikipedia,
    ancestorDescription,
    orderKey,
    hasInformation: Boolean(
      resolvedPhoto.photo || wikipedia?.extract || ancestorDescription?.extract,
    ),
  }
}

export async function loadSpeciesDetail(key, {
  signal,
  fetchImpl = fetch,
  taxonHint,
} = {}) {
  if (!Number.isInteger(Number(key)) || Number(key) < 1) {
    throw new Error('Invalid species key')
  }

  const [speciesData, parents, names] = await Promise.all([
    requestGbif(`/species/${Number(key)}`, {}, { signal, fetchImpl }),
    requestGbif(`/species/${Number(key)}/parents`, {}, { signal, fetchImpl }),
    requestGbif(`/species/${Number(key)}/vernacularNames`, { limit: 100 }, { signal, fetchImpl }),
  ])
  const species = speciesData.canonicalName
    ? speciesData
    : taxonHint && Number(taxonHint.key) === Number(key)
      ? {
          ...taxonHint,
          canonicalName: taxonHint.canonicalName || taxonHint.scientificName,
          scientificName: taxonHint.scientificName || taxonHint.canonicalName,
          taxonomicStatus: taxonHint.taxonomicStatus || taxonHint.status,
        }
      : speciesData

  if (!species.canonicalName || !species.scientificName || !species.rank) {
    throw new Error('GBIF returned incomplete taxon data')
  }
  if (!Array.isArray(parents) || !Array.isArray(names.results)) {
    throw new Error('GBIF returned an unexpected classification response')
  }

  const vernacularNames = names.results
    .filter((name) => name.language === 'eng' && typeof name.vernacularName === 'string')
    .map((name) => name.vernacularName)
    .filter((name, index, allNames) =>
      allNames.findIndex((candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase()) === index,
    )

  let photo = null
  let photoError = ''
  let preferredCommonName = ''
  let wikipedia = null
  let wikipediaError = ''
  const wikipediaPromise = loadWikipediaDescription(species, {
    signal,
    fetchImpl,
    ancestorNames: parents
      .map((parent) => parent.canonicalName)
      .filter(Boolean),
  })
    .then((description) => ({ description, error: '' }))
    .catch((error) => {
      if (signal?.aborted) throw error
      return { description: null, error: error.message }
    })
  const ancestorPromise = wikipediaPromise.then(async ({ description, error }) => {
    if (description || error) return { description: null, error: '' }
    try {
      return {
        description: await loadAncestorDescription(parents, { signal, fetchImpl }),
        error: '',
      }
    } catch (ancestorError) {
      if (signal?.aborted) throw ancestorError
      return { description: null, error: ancestorError.message }
    }
  })
  const extrasPromise = wikipediaPromise.then(async ({ description }) => {
    const extras = { sections: [], facts: [], errors: [] }
    if (!description) return extras
    const [sections, facts] = await Promise.allSettled([
      loadArticleSections(description.articleUrl, species.rank, { signal, fetchImpl }),
      loadQuickFacts(description.wikidataUrl, { signal, fetchImpl }),
    ])
    if (signal?.aborted) throw signal.reason
    if (sections.status === 'fulfilled') extras.sections = sections.value
    else extras.errors.push(sections.reason.message)
    if (facts.status === 'fulfilled') extras.facts = facts.value
    else extras.errors.push(facts.reason.message)
    return extras
  })
  const extinctionPromise = extrasPromise.then((extras) => loadExtinctionStatus({
    key: species.key,
    canonicalName: species.canonicalName,
    rank: species.rank,
  }, {
    iucnStatuses: extras.facts.find((fact) => fact.id === 'status')?.values ?? [],
    signal,
    fetchImpl,
  }))
  const speciesCountPromise = ['SPECIES', 'SUBSPECIES'].includes(species.rank)
    ? Promise.resolve({ count: null, error: '' })
    : requestGbif('/species/search', {
        highertaxonKey: Number(key),
        rank: 'SPECIES',
        status: 'ACCEPTED',
        datasetKey: GBIF_BACKBONE_KEY,
        limit: 0,
      }, { signal, fetchImpl })
      .then((data) => Number.isInteger(data.count)
        ? { count: data.count, error: '' }
        : { count: null, error: 'GBIF returned an unexpected species count' })
      .catch((error) => {
        if (signal?.aborted) throw error
        return { count: null, error: error.message }
      })
  const photoPromise = wikipediaPromise
    .then(({ description }) => resolvePhoto(species, {
      wikipedia: description,
      signal,
      fetchImpl,
    }))
    .then((result) => {
      photo = result.photo
      photoError = result.photoError
      preferredCommonName = result.preferredCommonName
    })
    .catch((error) => {
      if (signal?.aborted) throw error
      photoError = error.message
    })
  const [wikipediaResult, , ancestorResult, extras, speciesCount, extinction] = await Promise.all([
    wikipediaPromise,
    photoPromise,
    ancestorPromise,
    extrasPromise,
    speciesCountPromise,
    extinctionPromise,
  ])
  wikipedia = wikipediaResult.description
  wikipediaError = wikipediaResult.error || ancestorResult.error

  return {
    ...species,
    vernacularNames,
    preferredCommonName,
    classification: [
      ...parents.map((parent) => ({
        key: parent.key,
        name: parent.canonicalName || parent.scientificName,
        rank: parent.rank,
      })),
      { key: species.key, name: species.canonicalName, rank: species.rank },
    ],
    photo,
    photoError,
    wikipedia,
    wikipediaError,
    ancestorDescription: ancestorResult.description,
    sections: extras.sections,
    quickFacts: extras.facts,
    speciesCount: speciesCount.count,
    sourceErrors: [...extras.errors, speciesCount.error, ...extinction.errors].filter(Boolean),
    extinction: {
      state: extinction.state,
      kind: extinction.kind,
      conflict: extinction.conflict === true,
      evidence: extinction.evidence,
    },
  }
}
