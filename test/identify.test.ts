// The reference identify (src/identify.ts) against the library's own lookup,
// for every model id and fingerprint of every definition, through the
// release's identify-cases.json, which the build made with the library.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { identify } from '../src/identify.ts'
import { release } from './release.ts'

test('every definition is identified as the library identifies it', { timeout: 600_000 }, () => {
  const r = release()
  const index = r.json('identify.json')
  const cases = r.json('identify-cases.json') as { interview: Record<string, any>; expected: { module: string; model: string } | null }[]
  assert.ok(cases.length > 5000, `only ${cases.length}`)
  const differ = cases.filter((c) => (identify(c.interview, index)?.model ?? null) !== (c.expected?.model ?? null))
    .map((c) => `${c.interview.model_id}/${c.interview.manufacturer_name}: library ${c.expected?.model}, ours ${identify(c.interview, index)?.model}`)
  assert.deepEqual(differ.slice(0, 20), [])
  // Every case names a module of the release.
  assert.ok(cases.every((c) => c.expected === null || c.expected.module !== '?'))
})
