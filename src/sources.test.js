import test from 'node:test'
import assert from 'node:assert/strict'
import { SOURCES } from './sources.js'

test('every data source has a name, https url and purpose', () => {
  assert.ok(SOURCES.length >= 3)
  for (const s of SOURCES) {
    assert.ok(s.name)
    assert.match(s.url, /^https:\/\//)
    assert.ok(s.use)
  }
})
