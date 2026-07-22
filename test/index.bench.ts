import fastJsonStableStringify from 'fast-json-stable-stringify'
import fastSafeStringify from 'fast-safe-stringify'
import fastStableStringify from 'fast-stable-stringify'
import fasterStableStringify from 'faster-stable-stringify'
import fastestStableStringify from 'fastest-stable-stringify'
import jsonStableStringify from 'json-stable-stringify'
import jsonStringifyDeterministic from 'json-stringify-deterministic'
import upstreamStringify from 'safe-stable-stringify'
import { bench, describe } from 'vitest'
import { createBenchmarkFixture } from './benchmark-fixture.ts'

type MutableRecord = Record<string, unknown>
type SafeStableStringifier = (
	value: unknown,
	replacer?: ((key: string, value: unknown) => unknown) | Array<number | string>,
	space?: number | string,
) => unknown
type SafeStableModule = {
	configure: (options: { deterministic: boolean }) => SafeStableStringifier
}
type Stringifier = (value: unknown) => unknown

const localBuildUrl = new URL('../dist/index.js', import.meta.url)
const { configure: configureLocalStringify } = (await import(
	/* @vite-ignore */ localBuildUrl.href
)) as SafeStableModule

const array = Array.from({ length: 10 }, (_value, index) => index)
const simpleObject = { array }

const circularObject: MutableRecord = structuredClone(simpleObject)
circularObject.object = circularObject
circularObject.array = array

const deepObject: MutableRecord = {
	array,
	data: createBenchmarkFixture(),
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

const safeStableImplementations: ReadonlyArray<readonly [string, SafeStableStringifier]> = [
	['@kitschpatrol/safe-stable-stringify', configureLocalStringify({ deterministic: true })],
	['safe-stable-stringify', upstreamStringify.configure({ deterministic: true })],
]
const identityReplacer = (_key: string, value: unknown): unknown => value

function addCaseBenchmarks(
	name: string,
	serialize: (implementation: SafeStableStringifier, value: unknown) => unknown,
): void {
	for (const benchmarkCase of benchmarkCases) {
		describe(`${name}: ${benchmarkCase.name}`, () => {
			for (const [implementationName, implementation] of safeStableImplementations) {
				bench(implementationName, () => {
					serialize(implementation, benchmarkCase.value)
				})
			}
		})
	}
}

addCaseBenchmarks('simple', (implementation, value) => implementation(value))
addCaseBenchmarks('function replacer', (implementation, value) =>
	implementation(value, identityReplacer),
)
addCaseBenchmarks('array replacer', (implementation, value) => implementation(value, ['array']))
addCaseBenchmarks('function replacer with indentation', (implementation, value) =>
	implementation(value, identityReplacer, 2),
)
addCaseBenchmarks('array replacer with indentation', (implementation, value) =>
	implementation(value, ['array'], 2),
)
addCaseBenchmarks('indentation', (implementation, value) => implementation(value, undefined, 2))

const implementationComparisonFixture = createBenchmarkFixture()
const comparisonImplementations: ReadonlyArray<readonly [string, Stringifier]> = [
	['fast-json-stable-stringify', fastJsonStableStringify],
	['fast-safe-stringify', fastSafeStringify.stable],
	['fast-stable-stringify', fastStableStringify],
	['faster-stable-stringify', fasterStableStringify],
	['fastest-stable-stringify', fastestStableStringify],
	['json-stable-stringify', jsonStableStringify],
	['json-stringify-deterministic', jsonStringifyDeterministic],
	...safeStableImplementations,
]

describe('implementation comparison', () => {
	for (const [name, implementation] of comparisonImplementations) {
		bench(name, () => {
			implementation(implementationComparisonFixture)
		})
	}
})
