// One release built for the tests, as the workflow builds it, and read back
// from its files as a consumer reads them.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let built: string | undefined

export function release() {
  if (!built) {
    const out = mkdtempSync(path.join(os.tmpdir(), 'zcc-'))
    execFileSync(process.execPath, [new URL('../src/build.ts', import.meta.url).pathname, out], { stdio: 'pipe' })
    const manifest = JSON.parse(readFileSync(path.join(out, 'v', readVersion(out), 'manifest.json'), 'utf8'))
    built = path.join(out, 'v', manifest.version)
  }
  const dir = built
  const read = (rel: string) => readFileSync(path.join(dir, rel), 'utf8')
  return {
    dir, read, json: (rel: string) => JSON.parse(read(rel)),
    /** prelude + vendor + the selecting line, or prelude + the generated line (FORMAT.md). */
    codec: (module?: string, model?: string) => module && model
      ? `${read('prelude.js')}\n${read(`vendors/${module}.js`)}\nglobalThis.__zcc.use(${JSON.stringify(module)}, ${JSON.stringify(model)})\n`
      : `${read('prelude.js')}\nglobalThis.__zcc.useGenerated()\n`,
  }
}

function readVersion(out: string) {
  return readdirSync(path.join(out, 'v'))[0]
}
