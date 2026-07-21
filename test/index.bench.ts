import fastJsonStableStringify from 'fast-json-stable-stringify'
import fastSafeStringify from 'fast-safe-stringify'
import fastStableStringify from 'fast-stable-stringify'
import fasterStableStringify from 'faster-stable-stringify'
import fastestStableStringify from 'fastest-stable-stringify'
import jsonStableStringify from 'json-stable-stringify'
import jsonStringifyDeterministic from 'json-stringify-deterministic'
import { bench, describe } from 'vitest'
import { stringify } from '../src/index.ts'
import { benchmarkFixture } from './benchmark-fixture.ts'

type MutableRecord = Record<string, unknown>
type Stringifier = (value: unknown) => unknown

const array = Array.from({ length: 10 }, (_value, index) => index)
const simpleObject = { array }

const circularObject: MutableRecord = structuredClone(simpleObject)
circularObject.object = circularObject
circularObject.array = array

const deepObject: MutableRecord = {
	array,
	data: benchmarkFixture,
	name: 'safe-stable-stringify',
}
const deepLevelOne: MutableRecord = structuredClone(deepObject)
const deepLevelTwo: MutableRecord = structuredClone(deepObject)
const deepLevelThree: MutableRecord = structuredClone(deepObject)
deepObject.deep = deepLevelOne
deepLevelOne.deep = deepLevelTwo
deepLevelTwo.deep = deepLevelThree

const deepCircularObject: MutableRecord = structuredClone(deepObject)
const deepCircularLevelOne = deepCircularObject.deep as MutableRecord
const deepCircularLevelTwo = deepCircularLevelOne.deep as MutableRecord
const deepCircularLevelThree = deepCircularLevelTwo.deep as MutableRecord
deepCircularLevelOne.circular = deepCircularObject
deepCircularLevelTwo.circular = deepCircularObject
deepCircularLevelThree.circular = deepCircularObject
deepCircularObject.array = array

const benchmarkCases = [
	{ name: 'simple object', value: simpleObject },
	{ name: 'circular', value: circularObject },
	{ name: 'deep', value: deepObject },
	{ name: 'deep circular', value: deepCircularObject },
]

const configuredStringify = stringify.configure({ deterministic: true })
const identityReplacer = (_key: string, value: unknown): unknown => value

function addCaseBenchmarks(name: string, serialize: (value: unknown) => unknown): void {
	describe(name, () => {
		for (const benchmarkCase of benchmarkCases) {
			bench(benchmarkCase.name, () => {
				serialize(benchmarkCase.value)
			})
		}
	})
}

addCaseBenchmarks('simple', (value) => configuredStringify(value))
addCaseBenchmarks('function replacer', (value) => configuredStringify(value, identityReplacer))
addCaseBenchmarks('array replacer', (value) => configuredStringify(value, ['array']))
addCaseBenchmarks('function replacer with indentation', (value) =>
	configuredStringify(value, identityReplacer, 2),
)
addCaseBenchmarks('array replacer with indentation', (value) =>
	configuredStringify(value, ['array'], 2),
)
addCaseBenchmarks('indentation', (value) => configuredStringify(value, undefined, 2))

const comparisonImplementations: Record<string, Stringifier> = {
	'fast-json-stable-stringify': fastJsonStableStringify,
	'fast-safe-stringify': fastSafeStringify.stable,
	'fast-stable-stringify': fastStableStringify,
	'faster-stable-stringify': fasterStableStringify,
	'fastest-stable-stringify': fastestStableStringify,
	'json-stable-stringify': jsonStableStringify,
	'json-stringify-deterministic': jsonStringifyDeterministic,
	'safe-stable-stringify': stringify,
}

describe('implementation comparison', () => {
	for (const [name, implementation] of Object.entries(comparisonImplementations)) {
		bench(name, () => {
			implementation(benchmarkFixture)
		})
	}
})
