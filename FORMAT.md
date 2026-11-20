# Format, version 1

What a release of zigbee-codec-catalog contains, and how to use it without
Node or zigbee-herdsman-converters: identify a Zigbee device from its
interview, then decode its frames, encode its commands and run its
configure with a codec any JavaScript engine can run (QuickJS included).

A release is built from one release of
[zigbee-herdsman-converters](https://github.com/Koenkk/zigbee-herdsman-converters)
(MIT) and named after it.

## Where

| | |
|---|---|
| `https://pulzar-net.github.io/zigbee-codec-catalog/versions.json` | `{latest, versions}`: the releases served below, newest first |
| `https://pulzar-net.github.io/zigbee-codec-catalog/v/<version>/<file>` | a release's files, for the newest ten |
| GitHub release `zhc-<version>` | every release, permanently: `zigbee-codec-catalog-<version>.tar.gz` (the files below) and `SHA256SUMS` |

Files are never changed once published. `manifest.json` names the builder
that made them.

## Files

| File | What |
|---|---|
| `manifest.json` | `{format: 1, library, version, herdsman, builder, modules, definitions}` |
| `SHA256SUMS` | the SHA-256 of every other file, `sha256sum` format |
| `catalog.json` | every definition: `{module, model, vendor, description, zigbeeModel?, fingerprint?, whiteLabel?}` |
| `identify.js` | every definition's identity (model ids, fingerprints), per device module in the library's order: with the prelude, the library's own lookup (below) |
| `identify-cases.json` | `[{interview, expected}]`: for every model id and fingerprint of every definition, an interview made from it and the `{module, model}` the library's own lookup takes it for in Node (`null`: none). identify.js is held to these |
| `licenses/<package>.txt` | the licences of zigbee-herdsman-converters and zigbee-herdsman, which every codec carries |
| `previews/<module>.json` | per model in the module: `{fields, settings, controls, options, exposes, configure, version, ota}` |
| `prelude.js` | the library's shared code, zigbee-herdsman, and the codec runtime (about 2 MB) |
| `vendors/<module>.js` | one device module of the library (`devices/<module>.js`) |

`module` is the library's device module (`lumi`, `ikea`, `tuya`, ...),
`model` a definition's own model in it.

## Identifying a device

The interview is what a coordinator learns at join, as an object:
`ieee` (16 hex digits), `model_id`, `manufacturer_name`,
`manufacturer_code`, `type` (`router` or `end_device`), `power_source` (the
Basic cluster's value), `app_version`, `stack_version`, `zcl_version`,
`hw_version`, `date_code`, `build_id` and `endpoints[{id, profile,
device_id, in, out}]` (cluster ids). Codecs take the same object.

Which definition a device is, is the library's own lookup
(`findDefinition`: its model index, then fingerprints by priority, then model
ids), run on a zigbee-herdsman Device made from the interview. It is not
reimplemented: one script runs it,

```
prelude.js + "\n" + identify.js
```

and its `decodeUplink({zigbee: {interview}})` answers `{data: {module,
model}}`, or `{data: null}` for a device the library has no definition for
(use the generated codec). identify.js holds what the lookup reads of every
definition, so the script needs no device module. About 2.5 MB, 10 MB of
heap, under a millisecond a call.

## Assembling a codec

A codec is one script:

```
prelude.js + "\n" + vendors/<module>.js + "\n" + globalThis.__zcc.use("<module>", "<model>")
```

and for a device the library has no definition for, the definition the
library would generate from its clusters, made inside the codec:

```
prelude.js + "\n" + globalThis.__zcc.useGenerated()
```

It defines `decodeUplink(input)` and `encodeDownlink(input)`, both returning
a promise, and `__codec_pending()`. It needs no global but the language's.
Engine limits that suit it: 4 MB of source, 32 MB of heap, about 300 ms to
load and under 3 ms a call (the test suite prints the numbers).

## The codec interface

```
decodeUplink({zigbee: {interview, memo?, frame, endpoint, cluster, group?, lqi?, state?, options?}})
  -> {data: readings, warnings, memo}
encodeDownlink({zigbee: {action: "command", set | get, endpoint?, interview, memo?, results?, state?, options?}})
encodeDownlink({zigbee: {action: "configure", coordinator, interview, memo?, results?}})
  -> {data: {status: "done", state} | {status: "failed", error}, memo}
```

- `frame` is a ZCL frame as received (header and payload, base64); `endpoint`
  and `cluster` where it came from. `data` is the definition's own readings:
  numbers, booleans, strings, an object's members as `key.member`.
- A command or configure runs the definition's own code against
  zigbee-herdsman's models. Every frame the library would send is an
  **intent**: `{op: "zigbee.zcl", endpoint, cluster, frame, response,
  timeout_ms, profile?, src_endpoint?, label}`, `{op: "zigbee.zdo", cluster,
  payload, response, label}` or `{op: "zigbee.wait", ms, label}` (a pause the
  device needs). The transaction sequence number in a frame (byte 1, or byte 3
  with the manufacturer-specific bit) and in a ZDO payload (byte 0) is 0: the
  sender writes its own and matches the reply by it.
- The i-th intent is answered from `results[i]`: `{ok: true, frame?}` for
  `zigbee.zcl` (the reply ZCL frame, base64), `{ok: true, payload?}` for
  `zigbee.zdo` (the response, sequence number first), `{ok: true}` for a wait,
  `{ok: false, error}` for a failure. With fewer results than intents, the
  promise does not settle: drain the engine's job queue, then
  `__codec_pending()` returns `{data: {status: "pending", intents}, memo}`,
  the intents still wanted. Send them, append their answers to `results`, and
  call again: the codec keeps nothing between calls.
- `memo` is what the definition keeps on the device between calls (attribute
  values, metadata); store it and pass it back.
- `coordinator` is the coordinator's IEEE address (16 hex digits), which
  configure binds to.

## Previews

`fields` are what a definition reports: `{id, name, type, label, unit?,
endpoint?, writable?, category?, on?, off?}`, `id` the reading's property and
`name` the kind of reading (the same for one kind across every definition).
`settings` (changed once) and `controls` (operated: a light's state and
brightness) are JSON Schema; `options` and `exposes` are the library's own.
They are made with no device at hand, so a definition whose exposes depend on
the device shows its general case.
