// node src/build.ts <out>
//
// Builds the release of zigbee-herdsman-converters installed in
// node_modules into <out>/v/<version>/ (FORMAT.md): the prelude, a bundle per
// device module, the catalog, the fingerprint index, the previews, a
// manifest and SHA256SUMS. A version once published is never written again.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { prelude, vendor } from './bundle.ts'
import { cases } from './cases.ts'
import { fieldsOf, settingsAndControls } from './exposes.ts'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const zhc = require('zigbee-herdsman-converters')
const quiet = () => {}
zhc.setLogger({ debug: quiet, info: quiet, warning: quiet, error: quiet })
const { Zcl } = require('zigbee-herdsman')
const zhcRoot = path.dirname(require.resolve('zigbee-herdsman-converters/package.json'))
const VERSION: string = require('zigbee-herdsman-converters/package.json').version
const HERDSMAN: string = require('zigbee-herdsman/package.json').version
const SELF: string = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version

const out = path.resolve(process.argv[2] ?? 'site')
const dir = path.join(out, 'v', VERSION)
const written: Record<string, string> = {}

function put(rel: string, content: string) {
  const file = path.join(dir, rel)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
  written[rel] = createHash('sha256').update(content).digest('hex')
}
const json = (value: unknown) => JSON.stringify(value) + '\n'

type Raw = Record<string, any>
const index: Record<string, [string, number][]> = JSON.parse(readFileSync(path.join(zhcRoot, 'dist', 'models-index.json'), 'utf8'))
const modules = [...new Set(Object.values(index).flat().map(([m]) => m.replace(/\.js$/, '')))].sort()
const definitionsOf = (m: string): Raw[] => require(`zigbee-herdsman-converters/devices/${m}`).definitions

// A fingerprint as data: its RegExp, the one field that is not, as source.
const fingerprint = (f: Raw) => ({ ...f, ...(f.ieeeAddr instanceof RegExp ? { ieeeAddr: f.ieeeAddr.source } : {}) })

const started = Date.now()
const p = await prelude(root)
put('prelude.js', p.code)

const catalog: Raw[] = []
const models: Record<string, { module: string; model: string; zigbeeModel?: string[]; fingerprint?: Raw[]; priority?: number }[]> = {}
for (const [key, entries] of Object.entries(index)) {
  models[key] = entries.map(([m, i]) => {
    const d = definitionsOf(m.replace(/\.js$/, ''))[i]
    return { module: m.replace(/\.js$/, ''), model: d.model,
      ...(d.zigbeeModel ? { zigbeeModel: d.zigbeeModel } : {}),
      ...(d.fingerprint ? { fingerprint: d.fingerprint.map(fingerprint) } : {}) }
  })
}

let failed = 0
for (const m of modules) {
  put(`vendors/${m}.js`, await vendor(root, m, p.keys))
  const previews: Record<string, unknown> = {}
  for (const raw of definitionsOf(m)) {
    catalog.push({ module: m, model: raw.model, vendor: raw.vendor, description: raw.description,
      ...(raw.zigbeeModel ? { zigbeeModel: raw.zigbeeModel } : {}),
      ...(raw.fingerprint ? { fingerprint: raw.fingerprint.map(fingerprint) } : {}),
      ...(raw.whiteLabel ? { whiteLabel: raw.whiteLabel.map((w: Raw) => ({ model: w.model, vendor: w.vendor,
        description: w.description, ...(w.fingerprint ? { fingerprint: w.fingerprint.map(fingerprint) } : {}) })) } : {}) })
    try {
      const definition = zhc.prepareDefinition(raw)
      const exposes = typeof definition.exposes === 'function'
        ? definition.exposes({ isDummyDevice: true }, {}) : definition.exposes
      previews[raw.model] = {
        fields: fieldsOf(exposes), ...settingsAndControls(exposes),
        options: JSON.parse(JSON.stringify(definition.options ?? [])),
        exposes: JSON.parse(JSON.stringify(exposes)),
        configure: Boolean(definition.configure), version: definition.version, ota: Boolean(definition.ota),
      }
    } catch (e) {
      failed++
      previews[raw.model] = { error: String((e as Error).message).slice(0, 300) }
    }
  }
  put(`previews/${m}.json`, json(previews))
}

// The libraries every codec carries, with their licences.
for (const name of ['zigbee-herdsman-converters', 'zigbee-herdsman']) {
  const pkg = path.dirname(require.resolve(`${name}/package.json`))
  const licence = ['LICENSE', 'LICENSE.md', 'license'].map((f) => path.join(pkg, f)).find((f) => existsSync(f))
  if (licence) put(`licenses/${name}.txt`, readFileSync(licence, 'utf8'))
}
put('catalog.json', json(catalog))
// herdsman reports a device's power source by these names; a fingerprint names one.
const powerSources = Object.fromEntries(Object.entries(Zcl.PowerSource)
  .filter(([k]) => !Number.isNaN(Number(k)))) as Record<string, string>
put('identify.json', json({ powerSources, models }))
put('identify-cases.json', json(await cases(catalog, powerSources)))
put('manifest.json', json({ format: 1, library: 'zigbee-herdsman-converters', version: VERSION,
  herdsman: HERDSMAN, builder: SELF, modules, definitions: catalog.length, previewErrors: failed }))
writeFileSync(path.join(dir, 'SHA256SUMS'), Object.entries(written).sort().map(([f, h]) => `${h}  ${f}`).join('\n') + '\n')
console.log(`${VERSION}: ${modules.length} modules, ${catalog.length} definitions, ${failed} previews failed, ` +
  `${((Date.now() - started) / 1000).toFixed(0)} s`)
