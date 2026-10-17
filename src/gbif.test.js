import test from 'node:test'
import assert from 'node:assert/strict'
import { requestGbif } from './gbif.js'

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

test('requestGbif reuses successful responses from the same fetch implementation', async () => {
  let requestCount = 0
  const fetchImpl = async () => {
    requestCount += 1
    return response({ results: ['cached'] })
  }

  const first = await requestGbif('/species/1/children', { limit: 12 }, { fetchImpl })
  const second = await requestGbif('/species/1/children', { limit: 12 }, { fetchImpl })

  assert.deepEqual(first, { results: ['cached'] })
  assert.equal(second, first)
  assert.equal(requestCount, 1)
})

test('requestGbif does not cache unsuccessful responses', async () => {
  let requestCount = 0
  const fetchImpl = async () => {
    requestCount += 1
    return response({}, 503)
  }

  await assert.rejects(requestGbif('/species/1', {}, { fetchImpl }), /GBIF request failed \(503\)/)
  await assert.rejects(requestGbif('/species/1', {}, { fetchImpl }), /GBIF request failed \(503\)/)
  assert.equal(requestCount, 2)
})

test('requestGbif expires cached responses after five minutes', async () => {
  const originalNow = Date.now
  let now = 1000
  let requestCount = 0
  const fetchImpl = async () => {
    requestCount += 1
    return response({ requestCount })
  }
  Date.now = () => now

  try {
    await requestGbif('/species/2', {}, { fetchImpl })
    now += 5 * 60 * 1000
    const refreshed = await requestGbif('/species/2', {}, { fetchImpl })
    assert.deepEqual(refreshed, { requestCount: 2 })
    assert.equal(requestCount, 2)
  } finally {
    Date.now = originalNow
  }
})
