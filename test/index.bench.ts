/* eslint-disable test/expect-expect -- Benchmark tests measure throughput instead of asserting behavior. */

import type { TestContext } from 'vitest'
import fastJsonStableStringify from 'fast-json-stable-stringify'
import fastSafeStringify from 'fast-safe-stringify'
import fastStableStringify from 'fast-stable-stringify'
import fasterStableStringify from 'faster-stable-stringify'
import fastestStableStringify from 'fastest-stable-stringify'
import jsonStableStringify from 'json-stable-stringify'
import jsonStringifyDeterministic from 'json-stringify-deterministic'
import upstreamStringify from 'safe-stable-stringify'
import { test } from 'vitest'
import { createBenchmarkFixture } from './benchmark-fixture.ts'

type Bench = TestContext['bench']
type BenchRegistration = ReturnType<Bench>
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

const localImplementationName = '@kitschpatrol/safe-stable-stringify'
const safeStableImplementations: ReadonlyArray<readonly [string, SafeStableStringifier]> = [
	[localImplementationName, configureLocalStringify({ deterministic: true })],
	['safe-stable-stringify', upstreamStringify.configure({ deterministic: true })],
]
const identityReplacer = (_key: string, value: unknown): unknown => value

// `write` stores the local implementation's results, `compare` adds the stored results to each comparison
const baselineMode = process.env.BENCH_BASELINE
const nonAlphanumericPattern = /[^a-z\d]+/gv

function getBaselinePath(testName: string): string {
	return `./test/benchmarks/baseline/${testName.toLowerCase().replaceAll(nonAlphanumericPattern, '-')}.json`
}

/**
 * Compare implementations within a single benchmark test, recording or
 * replaying the local implementation's baseline according to `BENCH_BASELINE`.
 */
async function compareImplementations(
	bench: Bench,
	testName: string,
	implementations: ReadonlyArray<readonly [string, () => void]>,
): Promise<void> {
	const baselinePath = getBaselinePath(testName)
	const registrations: BenchRegistration[] = implementations.map(([name, run]) =>
		name === localImplementationName && baselineMode === 'write'
			? bench(name, { writeResult: baselinePath }, run)
			: bench(name, run),
	)

	if (baselineMode === 'compare') {
		registrations.push(bench.from(`${localImplementationName} (baseline)`, baselinePath))
	}

	await bench.compare(...registrations)
}

function addCaseBenchmarks(
	name: string,
	serialize: (implementation: SafeStableStringifier, value: unknown) => unknown,
): void {
	for (const benchmarkCase of benchmarkCases) {
		const testName = `${name}: ${benchmarkCase.name}`
		test(testName, async ({ bench }) => {
			await compareImplementations(
				bench,
				testName,
				safeStableImplementations.map(([implementationName, implementation]) => [
					implementationName,
					() => {
						serialize(implementation, benchmarkCase.value)
					},
				]),
			)
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

test('implementation comparison', async ({ bench }) => {
	await compareImplementations(
		bench,
		'implementation comparison',
		comparisonImplementations.map(([name, implementation]) => [
			name,
			() => {
				implementation(implementationComparisonFixture)
			},
		]),
	)
})
