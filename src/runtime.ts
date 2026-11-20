// A codec: one zigbee-herdsman-converters definition, its converters and
// zigbee-herdsman's own Device and Endpoint models, run in a plain JavaScript
// engine (QuickJS) with no Node, no timers and no I/O. FORMAT.md has the
// interface and how a codec is assembled from a release's files.
//
// It is the codec interface every codec has, with Zigbee inputs:
//
//   decodeUplink({zigbee: {interview, memo, frame, endpoint, cluster, state, options}})
//     -> {data: values, warnings, memo}
//   encodeDownlink({zigbee: {action: 'command', set | get, endpoint, ...}})
//   encodeDownlink({zigbee: {action: 'configure', coordinator, ...}})
//     -> {data: {status: 'done', state} | {status: 'failed', error}}
//
// Both return a promise; the sandbox drains QuickJS's job queue after the
// call. A configure or command waits on the gateway: every frame herdsman
// builds becomes an intent, answered from `results` (the gateway's answers so
// far, in order) when the caller has them. A promise still waiting once the
// queue is drained means the next intents are wanted, and
// `__codec_pending()` says which: {data: {status: 'pending', intents}}.
//
// Static imports throughout: the bundler follows them, and nothing here may
// reach the filesystem or the network.

import { findDefinition, generateExternalDefinition, postProcessConvertedFromZigbeeMessage, prepareDefinition } from 'zigbee-herdsman-converters'
import { Zcl, Zdo } from 'zigbee-herdsman'
import { Device, Entity } from 'zigbee-herdsman/dist/controller/model/index.js'
import { InterviewState } from 'zigbee-herdsman/dist/controller/model/device.js'
import { ZclFrameConverter } from 'zigbee-herdsman/dist/controller/helpers/index.js'
import { readings } from './exposes.ts'

type Any = any // the definition's own types are the library's; this file passes them through
declare const require: (name: string) => Any

// herdsman-converters' sleep, called through its module object by every
// definition: a pause the device needs between two frames, so the gateway's
// to keep, as a `zigbee.wait` intent.
const zhcUtils = require('zigbee-herdsman-converters/lib/utils')

type Intent = Record<string, unknown> & { op: string; label: string }
type Result = { ok: true; frame?: string; payload?: string } | { ok: false; error: string }

/** The i-th request is answered by results[i]; the first without one is pending and never settles. */
class Session {
  results: Result[]
  pending: Intent[] = []
  calls = 0
  constructor(results: Result[]) { this.results = results }
  request(intent: Intent): Promise<Result> {
    const i = this.calls++
    if (i < this.results.length) return Promise.resolve(this.results[i])
    this.pending.push(intent)
    return new Promise(() => {})
  }
}

let session: Session | undefined

const b64 = (b: Buffer) => b.toString('base64')

// The transaction sequence number is the gateway's: 0 here, its own on the air.
function withoutTsn(frame: Any): Buffer {
  const buf = frame.toBuffer()
  buf[frame.header.frameControl.manufacturerSpecific ? 3 : 1] = 0
  return buf
}

let ids = 0
Entity.injectDatabase({
  *getEntriesIterator() {}, insert() {}, update() {}, remove() {}, has: () => false, newID: () => ++ids,
  write() {}, clear() {},
} as Any)
Entity.injectAdapter({
  hasZdoMessageOverhead: true,
  async sendZclFrameToEndpoint(_i: string, _n: number, endpoint: number, frame: Any, timeout: number,
    disableResponse: boolean, _r: boolean, sourceEndpoint?: number, profileId?: number) {
    if (!session) throw new Error('a decode sends nothing')
    const intent: Intent = { op: 'zigbee.zcl', label: `${frame.cluster.name}.${frame.command.name}`, endpoint,
      cluster: frame.cluster.ID, frame: b64(withoutTsn(frame)), response: !disableResponse, timeout_ms: timeout }
    if (profileId !== undefined) intent.profile = profileId
    if (sourceEndpoint !== undefined) intent.src_endpoint = sourceEndpoint
    const result = await session.request(intent)
    if (!result.ok) throw new Error(result.error)
    if (disableResponse || !result.frame) return undefined
    const data = Buffer.from(result.frame, 'base64')
    return { clusterID: frame.cluster.ID, header: Zcl.Header.fromBuffer(data), data, address: 0, endpoint,
      linkquality: 0, groupID: 0, wasBroadcast: false, destinationEndpoint: 1 }
  },
  async sendZdo(_i: string, _n: number, clusterId: number, payload: Buffer, disableResponse: boolean) {
    if (!session) throw new Error('a decode sends nothing')
    const result = await session.request({ op: 'zigbee.zdo', label: `zdo.${(Zdo.ClusterId as Any)[clusterId] ?? clusterId}`,
      cluster: clusterId, payload: b64(payload), response: !disableResponse })
    if (!result.ok) throw new Error(result.error)
    if (disableResponse) return undefined
    return Zdo.Buffalo.readResponse(true, clusterId | 0x8000, Buffer.from(result.payload ?? '', 'base64'))
  },
} as Any)

zhcUtils.sleep = async (ms: number) => {
  if (session) await session.request({ op: 'zigbee.wait', label: `wait ${ms} ms`, ms })
}

function build(iv: Any, memo: Any) {
  // One call's world: whatever an earlier call left (a configure still
  // waiting on the gateway) is dropped.
  Device.resetCache()
  const type = iv.type === 'router' ? 'Router' : iv.type === 'end_device' ? 'EndDevice' : 'Unknown'
  const device = Device.create(type, `0x${iv.ieee}`, iv.nwk ? parseInt(iv.nwk, 16) : 0, iv.manufacturer_code,
    iv.manufacturer_name, undefined, iv.model_id, InterviewState.Successful, undefined)
  const set: Record<string, string> = { power_source: 'powerSource', app_version: 'applicationVersion',
    stack_version: 'stackVersion', zcl_version: 'zclVersion', hw_version: 'hardwareVersion', date_code: 'dateCode',
    build_id: 'softwareBuildID' }
  for (const [from, to] of Object.entries(set)) if (iv[from] !== undefined) (device as Any)[to] = iv[from]
  for (const e of iv.endpoints ?? []) {
    const ep = device.createEndpoint(e.id)
    ep.profileID = e.profile
    ep.deviceID = e.device_id
    ep.inputClusters = [...(e.in ?? [])]
    ep.outputClusters = [...(e.out ?? [])]
    const kept = memo?.endpoints?.[String(e.id)]
    for (const [cluster, c] of Object.entries<Any>(kept?.clusters ?? {})) ep.saveClusterAttributeKeyValue(cluster, c.attributes)
    if (kept?.meta) ep.meta = kept.meta
  }
  device.meta = memo?.meta ?? {}
  return device
}

function memoOf(device: Any) {
  const endpoints: Any = {}
  for (const ep of device.endpoints) {
    if (Object.keys(ep.clusters).length || Object.keys(ep.meta).length) endpoints[String(ep.ID)] = { clusters: ep.clusters, meta: ep.meta }
  }
  return JSON.parse(JSON.stringify({ meta: device.meta, endpoints }))
}

function coordinatorEndpoint(ieee: string) {
  const device = Device.create('Coordinator', `0x${ieee}`, 0, undefined, undefined, undefined, undefined,
    InterviewState.Successful, undefined)
  return device.createEndpoint(1)
}

/**
 * The codec for one definition, or, with no definition, for a device the
 * library has none for: the definition it generates from the device's
 * clusters, made again for each device it is asked about.
 */
export function codec(raw: Any | undefined) {
  const fixed = raw ? prepareDefinition(raw) : undefined
  const definitionFor = async (device: Any) => fixed ?? await generateExternalDefinition(device)

  /** The definition's `start` handlers: they add its custom clusters (Aqara's, Tuya's). */
  function start(device: Any, state: Any, options: Any) {
    if (!raw) return
    const data = { device, deviceExposesChanged() {}, state, options }
    const handlers = [raw.onEvent, ...(raw.extend ?? []).flatMap((x: Any) => x.onEvent ?? [])].filter(Boolean)
    for (const h of handlers) {
      try { h({ type: 'start', data }) } catch { /* a handler that needs the network is not ours to run */ }
    }
  }

  async function decode(input: Any) {
    const z = input.zigbee
    session = undefined
    const device = build(z.interview, z.memo)
    const definition = await definitionFor(device)
    start(device, z.state ?? {}, z.options ?? {})
    const buf = Buffer.from(z.frame, 'base64')
    const endpoint = device.getEndpoint(z.endpoint) ?? device.createEndpoint(z.endpoint)
    const warnings: string[] = []
    let msg: Any
    try {
      const frame = Zcl.Frame.fromBuffer(z.cluster, Zcl.Header.fromBuffer(buf), buf, device.customClusters)
      let type: string | undefined
      let payload: Any
      if (frame.header.isGlobal) {
        type = ({ report: 'attributeReport', readRsp: 'readResponse', write: 'write', read: 'read' } as Any)[frame.command.name]
        if (type === 'read') payload = ZclFrameConverter.attributeList(frame, device.manufacturerID, device.customClusters)
        else if (type) {
          payload = ZclFrameConverter.attributeKeyValue(frame, device.manufacturerID, device.customClusters)
          // As herdsman's controller does before the converters see it: some
          // read a sibling attribute (pressure's scale) from the endpoint.
          if (type !== 'write') {
            if (frame.cluster.name === 'genBasic') device.updateGenBasic(payload)
            endpoint.saveClusterAttributeKeyValue(frame.cluster.ID, payload)
          }
        }
      } else {
        type = `command${frame.command.name[0].toUpperCase()}${frame.command.name.slice(1)}`
        payload = frame.payload
      }
      if (type) {
        msg = { type, data: payload, cluster: frame.cluster.name, endpoint, device, groupID: z.group ?? 0,
          linkquality: z.lqi ?? 0, meta: { rawData: buf, zclTransactionSequenceNumber: frame.header.transactionSequenceNumber,
            manufacturerCode: frame.header.manufacturerCode, frameControl: frame.header.frameControl } }
      }
    } catch {
      // A frame herdsman cannot parse goes to the converters raw, as its controller does.
      const name = Zcl.Utils.getCluster(z.cluster, device.manufacturerID, device.customClusters).name
      msg = { type: 'raw', data: buf, cluster: Number.isNaN(Number(name)) ? name : Number(name), endpoint, device,
        groupID: z.group ?? 0, linkquality: z.lqi ?? 0, meta: { rawData: buf } }
    }
    const values: Any = {}
    const published: Any[] = []
    if (msg) {
      const meta = { state: { ...(z.state ?? {}) }, device, deviceExposesChanged() {} }
      for (const c of definition.fromZigbee) {
        const types = Array.isArray(c.type) ? c.type : [c.type]
        if (c.cluster !== msg.cluster || !types.includes(msg.type)) continue
        try {
          // Some converters are async (Aqara's 0xFF01 heartbeat).
          const r = await c.convert(definition, msg, (p: Any) => published.push(p), z.options ?? {}, meta)
          if (r) Object.assign(values, r)
          Object.assign(meta.state, values)
        } catch (e) {
          warnings.push(`${msg.cluster}/${msg.type}: ${(e as Error).message}`)
        }
      }
      postProcessConvertedFromZigbeeMessage(definition, values, z.options ?? {}, device)
    }
    return { data: readings(Object.assign({}, ...published, values)), warnings, memo: memoOf(device) }
  }

  let waiting: (() => Any) | undefined

  async function encode(input: Any) {
    const z = input.zigbee
    session = new Session(z.results ?? [])
    const current = session
    const device = build(z.interview, z.memo)
    const definition = await definitionFor(device)
    start(device, z.state ?? {}, z.options ?? {})
    waiting = () => ({ data: { status: 'pending', intents: current.pending }, memo: memoOf(device) })
    try {
      let state: Any = {}
      if (z.action === 'configure') {
        await definition.configure?.(device, coordinatorEndpoint(z.coordinator), definition)
      } else {
        state = await command(device, definition, z)
      }
      return { data: { status: 'done', state }, memo: memoOf(device) }
    } catch (e) {
      return { data: { status: 'failed', error: String((e as Error)?.message ?? e).slice(0, 500) }, memo: memoOf(device) }
    }
  }

  /** set or get through the definition's toZigbee converters, each converter once. */
  async function command(device: Any, definition: Any, z: Any) {
    const names = definition.endpoint?.(device) ?? {}
    const endpointName: string | undefined = z.endpoint
    const id = names[endpointName ?? 'default']
    if (endpointName && id === undefined) throw new Error(`${definition.model} has no endpoint ${endpointName}`)
    const entity = id !== undefined ? device.getEndpoint(id) : device.endpoints[0]
    if (!entity) throw new Error('the device has no endpoint')
    // A converter with no key takes every key (Tuya's datapoints).
    const converterFor = (key: string) => definition.toZigbee.find((c: Any) =>
      (!c.key || c.key.includes(key)) && (!c.endpoints || !endpointName || c.endpoints.includes(endpointName)))
    const state: Any = {}
    const meta = (message: Any) => ({ message, device, mapped: definition, options: z.options ?? {},
      state: { ...(z.state ?? {}), ...state }, endpoint_name: endpointName, publish() {}, deviceExposesChanged() {} })
    const used = new Set<Any>()
    for (const [key, value] of Object.entries(z.set ?? {})) {
      const c = converterFor(key)
      if (!c?.convertSet) throw new Error(`${definition.model} has no converter that sets ${key}`)
      if (used.has(c)) continue
      used.add(c)
      const r = await c.convertSet(entity, key, value, meta(z.set))
      if (r?.state) Object.assign(state, r.state)
    }
    for (const key of z.get ?? []) {
      const c = converterFor(key)
      if (!c?.convertGet) throw new Error(`${definition.model} has no converter that reads ${key}`)
      await c.convertGet(entity, key, meta({ [key]: '' }))
    }
    return state
  }

  return { decode, encode, pending: () => waiting?.() }
}

/**
 * Which definition a device is, by the library's own lookup (findDefinition)
 * over a herdsman Device made from its interview, as a codec makes it. The
 * lookup loads its candidates' device modules by name; here each module is
 * its definitions' identities (identify.js): what the lookup reads of them.
 */
function identifier(modules: Record<string, Any[]>) {
  for (const [module, definitions] of Object.entries(modules)) {
    for (const d of definitions) {
      Object.defineProperty(d, 'module', { value: module })
      for (const f of d.fingerprint ?? []) if (f.ieeeAddr) f.ieeeAddr = new RegExp(f.ieeeAddr.source, f.ieeeAddr.flags)
    }
  }
  return async (input: Any) => {
    const found: Any = await findDefinition(build(input.zigbee.interview, undefined), false)
    return { data: found ? { module: found.module, model: found.model } : null, warnings: [] }
  }
}

// The prelude installs this; a vendor bundle adds its device module, and a
// codec's last line picks a definition (FORMAT.md, "Assembling a codec").
type Registry = Record<string, () => Any>
const installed = globalThis as Any

export function install(modules: Registry) {
  const vendors: Record<string, Any> = {}
  let identities: Record<string, Any[]> | undefined
  installed.require = (name: string) => {
    // The library's lookup asks for a device module by a path of its own.
    const asked = /^\.\/devices\/([\w-]+)$/.exec(name)
    if (asked && identities) return { definitions: identities[asked[1]] ?? [] }
    const load = modules[name]
    if (!load) throw new Error(`${name} is not in this release's prelude`)
    return load()
  }
  const expose = (c: ReturnType<typeof codec>) => {
    installed.decodeUplink = (input: Any) => c.decode(input)
    installed.encodeDownlink = (input: Any) => c.encode(input)
    installed.__codec_pending = () => c.pending()
  }
  installed.__zcc = {
    vendor(name: string, module: Any) { vendors[name] = module },
    use(name: string, model: string) {
      const raw = (vendors[name]?.definitions ?? []).find((d: Any) => d.model === model)
      if (!raw) throw new Error(`no definition ${model} in ${name}`)
      expose(codec(raw))
    },
    useGenerated() { expose(codec(undefined)) },
    identities(modules: Record<string, Any[]>) {
      identities = modules
      installed.decodeUplink = identifier(modules)
    },
  }
}
