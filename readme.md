<!-- title -->

# @kitschpatrol/safe-stable-stringify

<!-- /title -->

<!-- badges -->

[![NPM Package @kitschpatrol/safe-stable-stringify](https://img.shields.io/npm/v/@kitschpatrol/safe-stable-stringify.svg)](https://npmjs.com/package/@kitschpatrol/safe-stable-stringify)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/license/mit/)
[![CI](https://github.com/kitschpatrol/safe-stable-stringify/actions/workflows/ci.yml/badge.svg)](https://github.com/kitschpatrol/safe-stable-stringify/actions/workflows/ci.yml)

<!-- /badges -->

<!-- short-description -->

**Fork of safe-stable-stringify with an ESM fix.**

<!-- /short-description -->

## Changes

This is a fork of [BridgeAR/safe-stable-stringify](https://github.com/BridgeAR/safe-stable-stringify) incorporating some minor fixes that I needed in other projects:

- Support direct-to-browser ESM imports. (Fixes an [upstream issue from 2022](https://github.com/BridgeAR/safe-stable-stringify/issues/36).)
- Drop the CJS export.
- Incorporate all upstream commits since the [August 2024 2.5.0 release](https://github.com/BridgeAR/safe-stable-stringify/releases/tag/v2.5.0).
- Port to TypeScript.
- Repository project template aligned with [kitschpatrol/create-project](https://github.com/kitschpatrol/create-project). (Massive diff, but simplifies management on my end.)

It will be deprecated if / when fixes are available upstream.

## Installation

To install:

```sh
pnpm add -D @kitschpatrol/safe-stable-stringify
```

## Performance

Performance tracks upstream.

As tested on an Apple M3 Max + Node.js 26:

<!-- performance -->

### Compared with upstream

Values show the throughput of `@kitschpatrol/safe-stable-stringify` vs. the upstream `safe-stable-stringify`. 1.00× means equal throughput; higher means this repo is faster.

| Task                               | Simple object | Circular |  Deep | Deep circular |
| :--------------------------------- | ------------: | -------: | ----: | ------------: |
| Simple                             |         1.08× |    0.99× | 0.99× |         0.99× |
| Function replacer                  |         1.06× |    0.99× | 0.99× |         1.01× |
| Array replacer                     |         0.97× |    1.00× | 1.02× |         0.99× |
| Function replacer with indentation |         1.01× |    0.98× | 1.00× |         0.98× |
| Array replacer with indentation    |         1.04× |    1.03× | 0.98× |         0.97× |
| Indentation                        |         1.00× |    1.07× | 1.00× |         1.03× |

### Compared with other implementations

Values show the throughput of `@kitschpatrol/safe-stable-stringify` relative to each named implementation. 1.00× means equal throughput; higher means this repo is faster.

| Compared with                                                                               | Relative speed |
| :------------------------------------------------------------------------------------------ | -------------: |
| [`fast-json-stable-stringify`](https://github.com/epoberezkin/fast-json-stable-stringify)   |          1.06× |
| [`fast-safe-stringify`](https://github.com/davidmarkclements/fast-safe-stringify)           |          1.17× |
| [`fast-stable-stringify`](https://github.com/nickyout/fast-stable-stringify)                |          0.94× |
| [`faster-stable-stringify`](https://github.com/ppaskaris/faster-stable-stringify)           |          1.06× |
| [`fastest-stable-stringify`](https://github.com/streamich/fastest-stable-stringify)         |          0.93× |
| [`json-stable-stringify`](https://github.com/ljharb/json-stable-stringify)                  |          1.32× |
| [`json-stringify-deterministic`](https://github.com/Kikobeats/json-stringify-deterministic) |          1.45× |
| [`safe-stable-stringify`](https://github.com/BridgeAR/safe-stable-stringify) (upstream)     |          1.05× |

<!-- /performance -->

## Acknowledgments

The original implementation was created by [Ruben Bridgewater](https://github.com/BridgeAR).

The upstream project is sponsored by [MaibornWolff](https://www.maibornwolff.de/) and [nearForm](http://nearform.com/).

## License

[MIT](license.txt)

---

## More information

Please see the [upstream readme](https://github.com/BridgeAR/safe-stable-stringify/blob/main/readme.md) for more details and documentation.
