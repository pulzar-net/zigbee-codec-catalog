// The reference identify over a release's identify.json (FORMAT.md,
// "Identifying a device"): which definition a device's interview is, as
// zigbee-herdsman-converters' own lookup decides. A consumer in another
// language implements the same steps; test/identify.test.ts checks this one
// against the library for every definition of the release.

export type Interview = {
  model_id?: string; manufacturer_name?: string; manufacturer_code?: number; type?: 'router' | 'end_device'
  power_source?: number; app_version?: number; stack_version?: number; zcl_version?: number; hw_version?: number
  date_code?: string; build_id?: string; ieee?: string
  endpoints?: { id: number; profile?: number; device_id?: number; in?: number[]; out?: number[] }[]
}
type Fingerprint = Record<string, any>
type Candidate = { module: string; model: string; zigbeeModel?: string[]; fingerprint?: Fingerprint[] }
export type IdentifyIndex = { powerSources: Record<string, string>; models: Record<string, Candidate[]> }

const same = (a: number[] = [], b: number[] = []) => a.length === b.length && a.every((x, i) => x === b[i])

export function matches(f: Fingerprint, iv: Interview, powerSources: Record<string, string>) {
  const type = iv.type === 'router' ? 'Router' : iv.type === 'end_device' ? 'EndDevice' : undefined
  const power = iv.power_source !== undefined ? powerSources[String(iv.power_source & 0x7f)] : undefined
  const eps = iv.endpoints ?? []
  const ok = (f.applicationVersion === undefined || iv.app_version === f.applicationVersion)
    && (f.manufacturerID === undefined || iv.manufacturer_code === f.manufacturerID)
    && (!f.type || type === f.type)
    && (!f.dateCode || iv.date_code === f.dateCode)
    && (f.hardwareVersion === undefined || iv.hw_version === f.hardwareVersion)
    && (!f.manufacturerName || iv.manufacturer_name === f.manufacturerName)
    && (!f.modelID || iv.model_id === f.modelID)
    && (!f.powerSource || power === f.powerSource)
    && (!f.softwareBuildID || iv.build_id === f.softwareBuildID)
    && (f.stackVersion === undefined || iv.stack_version === f.stackVersion)
    && (f.zclVersion === undefined || iv.zcl_version === f.zclVersion)
    && (!f.ieeeAddr || new RegExp(f.ieeeAddr).test(`0x${iv.ieee ?? ''}`))
    && (!f.endpoints || same(eps.map((e) => e.id), f.endpoints.map((e: Fingerprint) => e.ID)))
  if (!ok || !f.endpoints) return ok
  return f.endpoints.every((fe: Fingerprint) => {
    const de = fe.ID !== undefined ? eps.find((e) => e.id === fe.ID) : undefined
    return (fe.deviceID === undefined || de?.device_id === fe.deviceID)
      && (fe.profileID === undefined || de?.profile === fe.profileID)
      && (!fe.inputClusters || (de !== undefined && same(de.in, fe.inputClusters)))
      && (!fe.outputClusters || (de !== undefined && same(de.out, fe.outputClusters)))
  })
}

/** {module, model} of the definition, or null for one the library has none for (use the generated codec). */
export function identify(iv: Interview, index: IdentifyIndex): { module: string; model: string } | null {
  // An empty model id is looked up as "null", as the library does.
  const lower = (iv.model_id || 'null').toLowerCase()
  // A model id may carry a NUL and junk after it on the air.
  const normalized = lower.replace(/\0[\s\S]*$/, '').trim()
  const candidates = index.models[lower] ?? index.models[normalized]
  if (!candidates) return null
  if (candidates.length === 1 && candidates[0].zigbeeModel) return pick(candidates[0])
  let best: { priority: number; candidate: Candidate } | undefined
  for (const c of candidates) {
    for (const f of c.fingerprint ?? []) {
      const priority = f.priority ?? 0
      if (matches(f, iv, index.powerSources) && (!best || priority > best.priority)) best = { priority, candidate: c }
    }
  }
  if (best) return pick(best.candidate)
  const id = iv.model_id?.toLowerCase()
  const byModel = id ? candidates.find((c) => c.zigbeeModel?.some((m) => {
    const l = m.toLowerCase()
    return l === id || l === normalized
  })) : undefined
  return byModel ? pick(byModel) : null
}

const pick = (c: Candidate) => ({ module: c.module, model: c.model })
