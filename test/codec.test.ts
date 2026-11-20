// Golden tests: recorded interviews and frames of common devices, each run
// through a codec assembled from a freshly built release's files (prelude,
// vendor bundle, selecting line), in QuickJS (test/sandbox.ts). Prints each
// codec's size, load time, heap and time per decode.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { identify } from '../src/identify.ts'
import { type Attributes, converse } from './gateway.ts'
import { release } from './release.ts'
import { load } from './sandbox.ts'

const COORDINATOR = '00124b0012345678'
const dir = new URL('./fixtures/zigbee/', import.meta.url)
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(new URL(f, dir), 'utf8')) }))
const b64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64')
const hex = (b64: string) => Buffer.from(b64, 'base64').toString('hex')
const rows: string[] = []

for (const f of fixtures) {
  test(`${f.file}`, { timeout: 180_000 }, async (t) => {
    const r = release()
    const found = identify(f.interview, r.json('identify.json'))
    await t.test(`identifies as ${f.definition.vendor} ${f.definition.model}`, () => {
      if (f.definition.generated) assert.equal(found, null)
      else assert.deepEqual(found, { module: f.definition.vendorModule, model: f.definition.model })
    })
    if (found) {
      await t.test('previews its fields', () => {
        const preview = r.json(`previews/${found.module}.json`)[found.model]
        const ids = preview.fields.map((x: { id: string }) => x.id)
        for (const field of f.fields as string[]) assert.ok(ids.includes(field), `${field} in ${ids}`)
      })
    }

    const source = found ? r.codec(found.module, found.model) : r.codec()
    const codec = await load(source)
    const times: number[] = []
    const encode = (z: object) => (results: unknown[]) => {
      const out = codec.call('encodeDownlink', { zigbee: { interview: f.interview, results, ...z } })
      return Promise.resolve({ ...out.data, memo: out.memo })
    }
    for (const m of f.messages) {
      await t.test(`decodes ${m.what}`, () => {
        for (let i = 0; i < 5; i++) {
          const s = performance.now()
          const d = codec.call('decodeUplink', { zigbee: { interview: f.interview, frame: b64(m.frame), endpoint: m.endpoint, cluster: m.cluster } })
          times.push(performance.now() - s)
          assert.deepEqual(d.warnings, [])
          // The same frame again is a retransmission, which the library drops; repeats are only timed.
          if (i === 0) for (const [k, v] of Object.entries(m.values)) assert.deepEqual(d.data[k], v, k)
        }
      })
    }
    await t.test('configure runs to the end', async () => {
      const { last, intents } = await converse(encode({ action: 'configure', coordinator: COORDINATOR }), (f.attributes ?? {}) as Attributes)
      assert.equal(last.status, 'done', 'error' in last ? String(last.error) : '')
      const labels = intents.map((i) => i.label)
      for (const label of f.configure.includes) assert.ok(labels.includes(label), `${label} in ${labels}`)
      const binds = intents.filter((i) => i.op === 'zigbee.zdo' && i.cluster === 0x0021)
      assert.equal(binds.length, f.configure.binds ?? binds.length)
      const coordinator = Buffer.from(COORDINATOR, 'hex').reverse().toString('hex')
      for (const b of binds) assert.ok(hex(b.payload).includes(coordinator))
    })
    for (const c of f.commands) {
      await t.test(`${JSON.stringify(c.set)} is ${c.intents.map((i: { label: string }) => i.label)}`, async () => {
        const { last, intents } = await converse(encode({ action: 'command', set: c.set }), (f.attributes ?? {}) as Attributes)
        assert.equal(last.status, 'done', 'error' in last ? String(last.error) : '')
        assert.deepEqual((last as any).state, c.state)
        assert.deepEqual(intents.map((i) => i.op === 'zigbee.zcl'
          ? { label: i.label, endpoint: i.endpoint, cluster: i.cluster, frame: hex(i.frame) } : i), c.intents)
      })
    }
    times.sort((a, b) => a - b)
    rows.push([(found?.model ?? `generated (${f.definition.model})`).padEnd(28), `${(Buffer.byteLength(source) / 1024).toFixed(0)} KB`.padStart(9),
      `${codec.loadMs.toFixed(0)} ms`.padStart(8), `${(codec.heap() / 1048576).toFixed(1)} MB`.padStart(9),
      `${times[0].toFixed(2)}`.padStart(7), `${times[Math.floor(times.length / 2)].toFixed(2)}`.padStart(7),
      `${times.at(-1)!.toFixed(2)} ms`.padStart(10)].join(' '))
    codec.dispose()
  })
}

test('cost of a codec', () => {
  console.log(`\n${'codec'.padEnd(28)} ${'source'.padStart(9)} ${'load'.padStart(8)} ${'heap'.padStart(9)} ` +
    `${'min'.padStart(7)} ${'median'.padStart(7)} ${'max'.padStart(10)}\n${rows.join('\n')}\n`)
})
