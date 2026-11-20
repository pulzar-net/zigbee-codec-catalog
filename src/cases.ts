// identify-cases.json: for every model id and fingerprint of every
// definition, an interview made from it and the definition the library's own
// lookup takes that device for, in Node. identify.js, run anywhere else,
// checks itself against these.

import { createRequire } from 'node:module'

/** What a coordinator learns at join (FORMAT.md, "The interview"). */
export type Interview = {
  model_id?: string; manufacturer_name?: string; manufacturer_code?: number; type?: 'router' | 'end_device'
  power_source?: number; app_version?: number; stack_version?: number; zcl_version?: number; hw_version?: number
  date_code?: string; build_id?: string; ieee?: string
  endpoints?: { id: number; profile?: number; device_id?: number; in?: number[]; out?: number[] }[]
}

const require = createRequire(import.meta.url)

/** The herdsman device the library's lookup sees for an interview, as plain data. */
export function deviceOf(iv: Interview, powerSources: Record<string, string>) {
  const endpoints = (iv.endpoints ?? []).map((e) => ({ ID: e.id, profileID: e.profile, deviceID: e.device_id,
    inputClusters: e.in ?? [], outputClusters: e.out ?? [] }))
  return { ieeeAddr: `0x${iv.ieee}`, modelID: iv.model_id, manufacturerName: iv.manufacturer_name,
    manufacturerID: iv.manufacturer_code, type: iv.type === 'router' ? 'Router' : iv.type === 'end_device' ? 'EndDevice' : 'Unknown',
    powerSource: iv.power_source !== undefined ? powerSources[String(iv.power_source)] : undefined,
    applicationVersion: iv.app_version, stackVersion: iv.stack_version, zclVersion: iv.zcl_version,
    hardwareVersion: iv.hw_version, dateCode: iv.date_code, softwareBuildID: iv.build_id, endpoints,
    getEndpoint: (id: number) => endpoints.find((e) => e.ID === id) }
}

/** An interview carrying exactly what a fingerprint names. */
export function interviewOf(f: Record<string, any>, numberOf: Record<string, number>): Interview {
  const iv: Interview = { ieee: '0000000000000001',
    endpoints: (f.endpoints ?? [{ ID: 1 }]).map((e: Record<string, any>) => ({ id: e.ID ?? 1, profile: e.profileID,
      device_id: e.deviceID, in: e.inputClusters, out: e.outputClusters })) }
  const set = (k: keyof Interview, v: unknown) => { if (v !== undefined) (iv as Record<string, unknown>)[k] = v }
  set('model_id', f.modelID); set('manufacturer_name', f.manufacturerName); set('manufacturer_code', f.manufacturerID)
  set('type', f.type === 'Router' ? 'router' : f.type === 'EndDevice' ? 'end_device' : undefined)
  set('power_source', f.powerSource ? numberOf[f.powerSource] : undefined); set('app_version', f.applicationVersion)
  set('stack_version', f.stackVersion); set('zcl_version', f.zclVersion); set('hw_version', f.hardwareVersion)
  set('date_code', f.dateCode); set('build_id', f.softwareBuildID)
  return iv
}

export async function cases(catalog: Record<string, any>[], powerSources: Record<string, string>) {
  const zhc = require('zigbee-herdsman-converters')
  const numberOf = Object.fromEntries(Object.entries(powerSources).map(([n, s]) => [s, Number(n)]))
  const out: { interview: Interview; expected: { module: string; model: string } | null }[] = []
  const where = new Map(catalog.map((d) => [`${d.vendor}\u0000${d.model}`, d.module]))
  for (const d of catalog) {
    const interviews = [...(d.zigbeeModel ?? []).map((m: string) => interviewOf({ modelID: m }, numberOf)),
      ...(d.fingerprint ?? []).filter((f: Record<string, any>) => !f.ieeeAddr).map((f: Record<string, any>) => interviewOf(f, numberOf))]
    for (const interview of interviews) {
      const theirs = await zhc.findDefinition(deviceOf(interview, powerSources), false)
      out.push({ interview, expected: theirs ? { module: where.get(`${theirs.vendor}\u0000${theirs.model}`) ?? '?', model: theirs.model } : null })
    }
  }
  return out
}
