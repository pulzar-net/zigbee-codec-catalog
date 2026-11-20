// A definition's exposes as data a consumer can use without the library:
// what it reports (fields), what a person changes once (settings) and what
// they operate (controls), the last two as JSON Schema. Generic: nothing here
// knows what a consumer calls a quantity.

import type { Expose } from 'zigbee-herdsman-converters'

// zigbee-herdsman-converters' access bits (lib/exposes.ts `access`).
const STATE = 0b001
const SET = 0b010

// The kinds of expose that are something a person operates: whatever is
// inside one is a control; every other settable leaf is a setting.
const OPERATED = new Set(['light', 'switch', 'lock', 'cover', 'fan', 'climate'])

/** Each leaf of an expose tree with whether it sits inside an operated expose. */
export function controlled(exposes: Expose[]): [Expose, boolean][] {
  const out: [Expose, boolean][] = []
  const walk = (e: Expose, inside: boolean) => e.features?.length
    ? e.features.forEach((f) => walk(f as Expose, inside || OPERATED.has(e.type)))
    : out.push([e, inside])
  exposes.forEach((e) => walk(e, false))
  return out
}

export type Field = {
  /** The property a codec's readings carry it under. */
  id: string
  /** The expose's name, the same for one kind of reading in every definition (temperature, contact). */
  name: string
  type: 'number' | 'boolean' | 'string'
  label: string
  unit?: string
  endpoint?: string
  writable?: boolean
  category?: 'config' | 'diagnostic'
  /** For a binary: the values that mean on and off. */
  on?: unknown
  off?: unknown
}

/** The fields a definition reports. */
export function fieldsOf(exposes: Expose[]): Field[] {
  const fields: Field[] = []
  const seen = new Set<string>()
  for (const [e] of controlled(exposes)) {
    if (!e.property || !(e.access & STATE) || seen.has(e.property)) continue
    seen.add(e.property)
    const x = e as Expose & Record<string, any>
    const field: Field = { id: e.property, name: e.name, label: e.label,
      type: e.type === 'numeric' ? 'number' : e.type === 'binary' ? 'boolean' : 'string' }
    if (x.unit) field.unit = String(x.unit)
    if (e.endpoint) field.endpoint = e.endpoint
    if (e.access & SET) field.writable = true
    if (e.category) field.category = e.category
    if (e.type === 'binary') { field.on = x.value_on; field.off = x.value_off }
    fields.push(field)
  }
  return fields
}

/** JSON Schema of the settable leaves given, as a form renderer draws them. */
export function settableSchema(exposes: Expose[]) {
  const properties: Record<string, Record<string, unknown>> = {}
  for (const e of exposes) {
    if (!e.property || !(e.access & SET)) continue
    const s: Record<string, unknown> = { title: e.label }
    if (e.description) s.description = e.description
    const x = e as Expose & Record<string, any>
    if (e.type === 'numeric') {
      s.type = 'number'
      if (x.value_min !== undefined) s.minimum = x.value_min
      if (x.value_max !== undefined) s.maximum = x.value_max
      if (x.value_step !== undefined) s.multipleOf = x.value_step
      if (x.unit) s['x-unit'] = x.unit
      if (x.presets?.length) s.examples = x.presets.map((p: { value: unknown }) => p.value)
    } else if (e.type === 'binary') {
      if (typeof x.value_on === 'boolean') s.type = 'boolean'
      else s.enum = [x.value_on, x.value_off, ...(x.value_toggle !== undefined ? [x.value_toggle] : [])]
    } else if (e.type === 'enum') {
      s.enum = x.values
    } else if (e.type === 'text') {
      s.type = 'string'
    } else {
      s.type = 'object'
    }
    if (e.category) s['x-category'] = e.category
    properties[e.property] = s
  }
  return { type: 'object', properties, additionalProperties: false }
}

/** What a person changes once, and what they operate (a one-value enum is a button: a control). */
export function settingsAndControls(exposes: Expose[]) {
  const leaves = controlled(exposes)
  const isControl = ([e, inside]: [Expose, boolean]) =>
    inside || (e.type === 'enum' && (e as { values?: unknown[] }).values?.length === 1)
  return {
    settings: settableSchema(leaves.filter((l) => !isControl(l)).map(([e]) => e)),
    controls: settableSchema(leaves.filter(isControl).map(([e]) => e)),
  }
}

/**
 * A converter's payload as reading values: numbers, booleans and strings, an
 * object's members one level down as `key.member`. What a codec returns.
 */
export function readings(payload: Record<string, unknown>): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {}
  const put = (key: string, v: unknown) => {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) return
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
    else if (typeof v === 'boolean' || typeof v === 'string') out[key] = v
    else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)) {
      for (const [k, inner] of Object.entries(v)) if (inner === null || typeof inner !== 'object') put(`${key}.${k}`, inner)
    }
  }
  for (const [k, v] of Object.entries(payload)) put(k, v)
  return out
}
