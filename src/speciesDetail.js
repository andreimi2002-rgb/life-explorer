import { requestGbif } from './gbif.js'
import { resolvePhoto } from './photos.js'
import { loadWikipediaDescription } from './wikipedia.js'

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
  const wikipediaPromise = loadWikipediaDescription(species, { signal, fetchImpl })
    .then((description) => ({ description, error: '' }))
    .catch((error) => {
      if (signal?.aborted) throw error
      return { description: null, error: error.message }
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
  const [wikipediaResult] = await Promise.all([wikipediaPromise, photoPromise])
  wikipedia = wikipediaResult.description
  wikipediaError = wikipediaResult.error

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
  }
}
