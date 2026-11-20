// A release's codecs, as two kinds of script (FORMAT.md):
//
//   prelude.js       zigbee-herdsman, zigbee-herdsman-converters' shared code
//                    (lib, converters, index) and the codec runtime, with each
//                    module registered under its path in node_modules
//   vendors/<m>.js   one device module (devices/<m>.js) and what it needs that
//                    the prelude does not have; it asks the prelude's registry
//                    for the rest
//
// A codec for one definition is prelude + vendor + one selecting line; so a
// release publishes the shared code once, not once per definition (4,700 of
// them at 1.5 MB each would be 7 GB a release).
//
// Node's built-ins are not there: `buffer` and `events` are their npm ports,
// `assert` a minimal one, every other one a stub that throws if called, since
// nothing a codec does calls them (they are herdsman's serial, TCP and mDNS
// adapters, which a codec never opens, and which are left out).

import { readdirSync, statSync } from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import path from 'node:path'
import { build, type BuildOptions, type Plugin } from 'esbuild'

const require = createRequire(import.meta.url)
const HERE = path.dirname(new URL(import.meta.url).pathname)
const PORTS: Record<string, string> = { buffer: require.resolve('buffer/'), events: require.resolve('events/') }

/** A module's name in the prelude's registry: its path below node_modules. */
export const keyOf = (file: string) => {
  const at = file.lastIndexOf(`${path.sep}node_modules${path.sep}`)
  return at < 0 ? undefined : file.slice(at + '/node_modules/'.length).split(path.sep).join('/')
}

const builtins: Plugin = {
  name: 'node-builtins',
  setup(b) {
    const names = new Set(builtinModules.flatMap((n) => [n, `node:${n}`]))
    // herdsman's adapters come in only through its controller, which a codec
    // never starts.
    b.onResolve({ filter: /adapter$/ }, (args) =>
      /zigbee-herdsman[\\/]dist[\\/]controller/.test(args.importer) ? { path: 'herdsman-adapter', namespace: 'stub' } : undefined)
    b.onResolve({ filter: /.*/ }, (args) => {
      if (!names.has(args.path)) return undefined
      const name = args.path.replace(/^node:/, '').split('/')[0]
      if (PORTS[name]) return { path: PORTS[name] }
      return { path: name, namespace: 'stub' }
    })
    b.onLoad({ filter: /^assert$/, namespace: 'stub' }, () => ({
      contents: `function assert(v, m) { if (!v) throw new Error(m || 'assertion failed') }
assert.ok = assert; assert.strict = assert; assert.equal = (a, b, m) => assert(a == b, m);
assert.strictEqual = (a, b, m) => assert(a === b, m); module.exports = assert;`,
      loader: 'js',
    }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: `const fail = () => { throw new Error('node:${args.path} is not available in a codec') };
module.exports = new Proxy(fail, { get: (_, k) => k === '__esModule' ? false : k === 'default' ? module.exports : fail });`,
      loader: 'js',
    }))
  },
}

const COMMON: BuildOptions = {
  bundle: true, write: false, format: 'iife', platform: 'neutral', target: 'es2020', minify: true,
  // The library tells entities apart by their class names.
  keepNames: true, mainFields: ['main', 'module'], conditions: ['require', 'default'], logLevel: 'silent',
  inject: [path.join(HERE, 'globals.ts')], define: { 'process.env.NODE_ENV': '"production"' }, metafile: true,
}

function files(dir: string, keep: (rel: string) => boolean, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return files(full, keep, base)
    const rel = path.relative(base, full).split(path.sep).join('/')
    return name.endsWith('.js') && keep(rel) ? [full] : []
  })
}

/** The modules the prelude carries: herdsman and the converters' shared code, never a device module. */
export function preludeModules(root: string) {
  const zhc = path.dirname(require.resolve('zigbee-herdsman-converters/package.json', { paths: [root] }))
  const herdsman = path.dirname(require.resolve('zigbee-herdsman/package.json', { paths: [zhc] }))
  return [
    ...files(path.join(zhc, 'dist'), (rel) => !rel.startsWith('devices/')),
    ...files(path.join(herdsman, 'dist'), (rel) => !rel.startsWith('adapter/')),
  ]
}

export async function prelude(root: string) {
  const modules = preludeModules(root)
  const registry = modules.map((file) => `  ${JSON.stringify(keyOf(file))}: () => require(${JSON.stringify(file)}),`).join('\n')
  const out = await build({
    ...COMMON,
    stdin: { contents: `import { install } from ${JSON.stringify(path.join(HERE, 'runtime.ts'))}\ninstall({\n${registry}\n})\n`,
      resolveDir: root, loader: 'ts' },
    plugins: [builtins],
  })
  return { code: out.outputFiles![0].text, keys: new Set(modules.map((f) => keyOf(f)!)) }
}

/** One device module, asking the prelude's registry for whatever the prelude has. */
export async function vendor(root: string, name: string, keys: Set<string>) {
  const zhc = path.dirname(require.resolve('zigbee-herdsman-converters/package.json', { paths: [root] }))
  const fromPrelude: Plugin = {
    name: 'from-prelude',
    setup(b) {
      b.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.inner || args.kind === 'entry-point' || args.namespace !== 'file') return undefined
        const found = await b.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, importer: args.importer,
          pluginData: { inner: true } })
        const key = found.path ? keyOf(found.path) : undefined
        return key && keys.has(key) ? { path: key, external: true } : undefined
      })
    },
  }
  const module = path.join(zhc, 'dist', 'devices', `${name}.js`)
  const out = await build({
    ...COMMON,
    stdin: { contents: `globalThis.__zcc.vendor(${JSON.stringify(name)}, require(${JSON.stringify(module)}))\n`,
      resolveDir: root, loader: 'js' },
    plugins: [fromPrelude, builtins],
  })
  return out.outputFiles![0].text
}

/** The line that makes prelude + vendor a codec for one definition. */
export const selecting = (name: string, model: string) => `globalThis.__zcc.use(${JSON.stringify(name)}, ${JSON.stringify(model)})\n`
/** The line that makes the prelude a codec for devices the library does not know. */
export const GENERATED = 'globalThis.__zcc.useGenerated()\n'
