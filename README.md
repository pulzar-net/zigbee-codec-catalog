# zigbee-codec-catalog

[![CI](https://github.com/pulzar-net/zigbee-codec-catalog/actions/workflows/ci.yml/badge.svg)](https://github.com/pulzar-net/zigbee-codec-catalog/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Every device definition of
[zigbee-herdsman-converters](https://github.com/Koenkk/zigbee-herdsman-converters),
the device library behind Zigbee2MQTT, as a **self-contained codec** that any
JavaScript engine runs: no Node, no npm, no zigbee-herdsman installed. A codec
decodes a device's ZCL frames into readings, turns a command or a setting into
the ZCL frames to send, and runs the device's configure at join, using the
library's own definition and converters, unchanged.

Each release of zigbee-herdsman-converters is published as a release here the
day it comes out, with:

- the codecs, as a shared prelude and one bundle per device module (a codec is
  the two plus one line);
- the library's own lookup, to tell which definition a device is from what
  it said at join, as one more script;
- previews of every definition: its readings, and its settings and controls as
  JSON Schema;
- checksums.

**[The format](FORMAT.md)** | **[Releases](https://github.com/pulzar-net/zigbee-codec-catalog/releases)** |
**[Served files](https://oss.pulzr.net/zigbee-codec-catalog/versions.json)**

## Why

The library is the most complete record of how Zigbee devices behave: over
4,600 definitions, many with quirks no standard describes (Tuya's datapoints
on 0xEF00, Aqara's structures in the Basic cluster). It is JavaScript written
for Node. A gateway written in another language, a cloud that decodes frames
in a sandbox, or a device with a small embedded engine cannot load it as it
is. These codecs carry it there without rewriting a line of it.

## Use

```js
const base = 'https://oss.pulzr.net/zigbee-codec-catalog/v/26.135.0'
const prelude = await (await fetch(`${base}/prelude.js`)).text()
// which definition the device is: the library's own lookup (FORMAT.md)
// evaluate prelude + "\n" + identify.js, then
await decodeUplink({ zigbee: { interview } })  // -> { data: { module: 'lumi', model: 'WSDCGQ11LM' } }
// in a fresh engine, the codec:
const codec = [prelude,
  await (await fetch(`${base}/vendors/lumi.js`)).text(),
  'globalThis.__zcc.use("lumi", "WSDCGQ11LM")'].join('\n')
// evaluate `codec` in your engine, then:
await decodeUplink({ zigbee: { interview, frame: 'GCoKAAApZgg=', endpoint: 1, cluster: 1026 } })
// -> { data: { temperature: 21.5 }, warnings: [], memo: {...} }
```

## How it is checked

On every release, before anything is published:

- golden tests: recorded interviews and frames of an Aqara sensor (including
  its 0xFF01 heartbeat), an IKEA bulb, a Tuya presence sensor, a Philips Hue
  motion sensor and a device the library does not know, decoded, configured and
  commanded through codecs assembled from the release's own files, in QuickJS;
- the lookup, run in QuickJS from the release's files, against the same
  lookup in Node, for every model id and fingerprint of every definition.

The suite prints what each codec costs (size, load time, heap, time per call).

## Develop

```sh
npm ci
npm test            # build a release from the pinned library and test it
npm run build       # write it to site/v/<version>/
```

The library version is the `zigbee-herdsman-converters` devDependency; the
release workflow installs each new upstream release in its place.

## Licence

MIT, as zigbee-herdsman-converters is. The published codecs contain
zigbee-herdsman-converters and zigbee-herdsman (both MIT, by Koen Kanters and
contributors); their licences are in each release's tarball. Maintained by
[Pulzr](https://github.com/pulzar-net).
