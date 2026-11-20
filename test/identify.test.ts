// The reference identify against the library's own lookup, for every
// definition of the release: a device made from each of its model ids and
// each of its fingerprints is identified as zigbee-herdsman-converters
// identifies it.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { identify, type Interview } from '../src/identify.ts'
import { release } from './release.ts'

const require = createRequire(import.meta.url)
const zhc = require('zigbee-herdsman-converters')
const quiet = () => {}
zhc.setLogger({ debug: quiet, info: quiet, warning: quiet, error: quiet })

/** The herdsman device a lookup sees for an interview, as plain data. */
function deviceOf(iv: Interview, powerSources: Record<string, string>) {
  const endpoints = (iv.endpoints ?? []).map((e) => ({ ID: e.id, profileID: e.profile, deviceID: e.device_id,
    inputClusters: e.in ?? [], outputClusters: e.out ?? [] }))
  return { ieeeAddr: `0x${iv.ieee}`, modelID: iv.model_id, manufacturerName: iv.manufacturer_name,
    manufacturerID: iv.manufacturer_code, type: iv.type === 'router' ? 'Router' : iv.type === 'end_device' ? 'EndDevice' : 'Unknown',
    powerSource: iv.power_source !== undefined ? powerSources[String(iv.power_source)] : undefined,
    applicationVersion: iv.app_version, stackVersion: iv.stack_version, zclVersion: iv.zcl_version,
    hardwareVersion: iv.hw_version, dateCode: iv.date_code, softwareBuildID: iv.build_id, endpoints,
    getEndpoint: (id: number) => endpoints.find((e) => e.ID === id) }
}

function interviewOf(f: Record<string, any>, numberOf: Record<string, number>): Interview {
  return { ieee: '0000000000000001', model_id: f.modelID, manufacturer_name: f.manufacturerName,
    manufacturer_code: f.manufacturerID, type: f.type === 'Router' ? 'router' : f.type === 'EndDevice' ? 'end_device' : undefined,
    power_source: f.powerSource ? numberOf[f.powerSource] : undefined, app_version: f.applicationVersion,
    stack_version: f.stackVersion, zcl_version: f.zclVersion, hw_version: f.hardwareVersion, date_code: f.dateCode,
    build_id: f.softwareBuildID,
    endpoints: (f.endpoints ?? [{ ID: 1 }]).map((e: Record<string, any>) => ({ id: e.ID ?? 1, profile: e.profileID,
      device_id: e.deviceID, in: e.inputClusters, out: e.outputClusters })) }
}

test('every definition is identified as the library identifies it', { timeout: 600_000 }, async () => {
  const r = release()
  const index = r.json('identify.json')
  const numberOf = Object.fromEntries(Object.entries(index.powerSources as Record<string, string>).map(([n, s]) => [s, Number(n)]))
  const differ: string[] = []
  let checked = 0
  for (const d of r.json('catalog.json') as Record<string, any>[]) {
    const interviews = [...(d.zigbeeModel ?? []).map((m: string) => interviewOf({ modelID: m }, numberOf)),
      ...(d.fingerprint ?? []).filter((f: Record<string, any>) => !f.ieeeAddr).map((f: Record<string, any>) => interviewOf(f, numberOf))]
    for (const iv of interviews) {
      checked++
      const theirs = await zhc.findDefinition(deviceOf(iv, index.powerSources), false)
      const ours = identify(iv, index)
      if ((theirs?.model ?? null) !== (ours?.model ?? null)) {
        differ.push(`${d.module}/${d.model} via ${iv.model_id}/${iv.manufacturer_name}: library ${theirs?.model}, ours ${ours?.model}`)
      }
    }
  }
  assert.ok(checked > 5000, `only ${checked}`)
  assert.deepEqual(differ.slice(0, 20), [])
})
