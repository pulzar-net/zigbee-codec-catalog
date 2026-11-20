// A gateway and a device for tests: answers the service's intents as a
// coordinator and a well-behaved device would, with frames herdsman builds.
// It is told the device's attribute values; what it does not have it answers
// as UNSUPPORTED_ATTRIBUTE.

export type Intent = Record<string, any> & { op: string; label: string }
export type Result = { ok: true; frame?: string; payload?: string } | { ok: false; error: string }
import { Zcl } from 'zigbee-herdsman'

export type Attributes = Record<number, Record<number, Record<number, { type: number; value: unknown }>>>

const b64 = (b: Buffer) => b.toString('base64')

export function answer(intent: Intent, attributes: Attributes = {}): Result {
  if (intent.op === 'zigbee.wait') return { ok: true }
  // ZDO with the overhead byte: transaction number, then SUCCESS.
  if (intent.op === 'zigbee.zdo') return { ok: true, payload: b64(Buffer.from([0, 0])) }
  const data = Buffer.from(intent.frame, 'base64')
  const header = Zcl.Header.fromBuffer(data)!
  const reply = (command: string, payload: unknown, type = Zcl.FrameType.GLOBAL) => ({
    ok: true as const,
    frame: b64(Zcl.Frame.create(type, Zcl.Direction.SERVER_TO_CLIENT, true, header.manufacturerCode,
      header.transactionSequenceNumber, command, intent.cluster, payload as never, {}).toBuffer()),
  })
  if (!intent.response) return { ok: true }
  if (header.isGlobal) {
    const frame = Zcl.Frame.fromBuffer(intent.cluster, header, data, {})
    const name = frame.command.name
    const items = frame.payload as { attrId: number }[]
    if (name === 'read') {
      const known = attributes[intent.endpoint]?.[intent.cluster] ?? {}
      return reply('readRsp', items.map(({ attrId }) => known[attrId]
        ? { attrId, status: 0, dataType: known[attrId].type, attrData: known[attrId].value }
        : { attrId, status: Zcl.Status.UNSUPPORTED_ATTRIBUTE }))
    }
    if (name === 'configReport') return reply('configReportRsp', [{ status: 0 }])
    if (name === 'write') return reply('writeRsp', [{ status: 0 }])
    return reply('defaultRsp', { cmdId: header.commandIdentifier, statusCode: 0 })
  }
  return reply('defaultRsp', { cmdId: header.commandIdentifier, statusCode: 0 })
}

/** Calls `step` with the answers so far until it stops asking; returns every intent in order. */
export async function converse<R extends { status: string; intents?: Intent[] }>(
  step: (results: Result[]) => Promise<R>, attributes: Attributes = {}, rounds = 50,
): Promise<{ last: R; intents: Intent[] }> {
  const results: Result[] = []
  const intents: Intent[] = []
  for (let i = 0; i < rounds; i++) {
    const r = await step(results)
    if (r.status !== 'pending') return { last: r, intents }
    for (const intent of r.intents!) {
      intents.push(intent)
      results.push(answer(intent, attributes))
    }
  }
  throw new Error(`still pending after ${rounds} rounds`)
}
