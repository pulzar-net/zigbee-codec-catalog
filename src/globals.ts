// What a codec expects to find globally in Node and QuickJS lacks.
import { Buffer } from 'buffer'

export { Buffer }
export const process = { env: {}, nextTick: (fn: () => void) => Promise.resolve().then(fn), platform: 'quickjs', versions: {} }
export const setTimeout = () => 0
export const clearTimeout = () => {}
export const setInterval = () => 0
export const clearInterval = () => {}
export const setImmediate = () => 0
const quiet = () => {}
export const console = { log: quiet, debug: quiet, info: quiet, warn: quiet, error: quiet, trace: quiet }
