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

This is a fork of [safe-stable-stringify](https://github.com/kitschpatrol/safe-stable-stringify) incorporating some minor fixes that I needed in other projects:

- Support direct-to-browser ESM imports. (Fixes an [upstream issue from 2022](https://github.com/BridgeAR/safe-stable-stringify/issues/36).)
- Incorporate all upstream commits since the [August 2024 2.5.0 release](https://github.com/BridgeAR/safe-stable-stringify/releases/tag/v2.5.0).
- The package now exports ESM only, no dual-package fuss.
- Port to TypeScript.
- Repository project template aligned with [kitschpatrol/create-project](https://github.com/kitschpatrol/create-project). (Massive diff, but simplifies management on my end.)

It will be deprecated if / when fixes are available upstream.

## Installation

To install:

```sh
pnpm add -D @kitschpatrol/safe-stable-stringify
```

## Acknowledgments

The original implementation was created by [Ruben Bridgewater](https://github.com/BridgeAR).

The upstream project is sponsored by [MaibornWolff](https://www.maibornwolff.de/) and [nearForm](http://nearform.com/).

## License

[MIT](license.txt)

---

## More information

Please see the [upstream readme](https://github.com/BridgeAR/safe-stable-stringify/blob/main/readme.md) for more details and documentation.
