import { readFileSync } from 'node:fs'

const benchmarkFixtureJson = readFileSync(
	new URL('benchmark-fixture.json', import.meta.url),
	'utf8',
)

/** Creates an isolated copy of the upstream implementation-comparison fixture. */
export function createBenchmarkFixture(): unknown {
	return JSON.parse(benchmarkFixtureJson) as unknown
}
