// identify.js, the library's own lookup run in QuickJS over the release's
// identities, against the same lookup in Node: for every model id and
// fingerprint of every definition, through the release's identify-cases.json.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { release } from './release.ts'
import { load } from './sandbox.ts'

test('every definition is identified as the library identifies it', { timeout: 900_000 }, async () => {
  const r = release()
  const cases = r.json('identify-cases.json') as { interview: Record<string, any>; expected: { module: string; model: string } | null }[]
  assert.ok(cases.length > 5000, `only ${cases.length}`)
  const identifier = await load(r.identifier())
  const started = performance.now()
  const differ: string[] = []
  for (const c of cases) {
    const out = identifier.call('decodeUplink', { zigbee: { interview: c.interview } })
    if (JSON.stringify(out.data) !== JSON.stringify(c.expected)) {
      differ.push(`${c.interview.model_id}/${c.interview.manufacturer_name}: library ${JSON.stringify(c.expected)}, here ${JSON.stringify(out.data ?? out)}`)
    }
  }
  console.log(`identify.js: ${cases.length} cases, ${((performance.now() - started) / cases.length).toFixed(2)} ms each, ` +
    `load ${identifier.loadMs.toFixed(0)} ms, heap ${(identifier.heap() / 1048576).toFixed(1)} MB, ` +
    `${(Buffer.byteLength(r.identifier()) / 1048576).toFixed(2)} MB of source`)
  identifier.dispose()
  assert.deepEqual(differ.slice(0, 20), [])
  assert.ok(cases.every((c) => c.expected === null || c.expected.module !== '?'))
})
