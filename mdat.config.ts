import { mdatConfig } from '@kitschpatrol/mdat-config'
import { readFile } from 'node:fs/promises'

export default mdatConfig({
	performance,
})

// --------------

type Benchmark = {
	hz: number
	name: string
}

type BenchmarkGroup = {
	benchmarks: Benchmark[]
	fullName: string
}

type BenchmarkReport = {
	files: Array<{ groups: BenchmarkGroup[] }>
}

const localPackageName = '@kitschpatrol/safe-stable-stringify'
const upstreamPackageName = 'safe-stable-stringify'
const comparisonGroupName = 'implementation comparison'
const benchmarkReportUrl = new URL('test/benchmarks/compare.json', import.meta.url)
const firstCharacterPattern = /^./v
const implementationRepositories: Readonly<Record<string, string>> = {
	'fast-json-stable-stringify': 'https://github.com/epoberezkin/fast-json-stable-stringify',
	'fast-safe-stringify': 'https://github.com/davidmarkclements/fast-safe-stringify',
	'fast-stable-stringify': 'https://github.com/nickyout/fast-stable-stringify',
	'faster-stable-stringify': 'https://github.com/ppaskaris/faster-stable-stringify',
	'fastest-stable-stringify': 'https://github.com/streamich/fastest-stable-stringify',
	'json-stable-stringify': 'https://github.com/ljharb/json-stable-stringify',
	'json-stringify-deterministic': 'https://github.com/Kikobeats/json-stringify-deterministic',
	'safe-stable-stringify': 'https://github.com/BridgeAR/safe-stable-stringify',
}

function getTaskName(group: BenchmarkGroup): string {
	return group.fullName.split(' > ').at(-1) ?? group.fullName
}

function getBenchmark(group: BenchmarkGroup, name: string): Benchmark {
	const benchmark = group.benchmarks.find((candidate) => candidate.name === name)

	if (benchmark === undefined) {
		throw new Error(`Benchmark "${getTaskName(group)}" has no result for "${name}".`)
	}

	return benchmark
}

function formatRelativeSpeed(local: Benchmark, comparison: Benchmark): string {
	return `${(local.hz / comparison.hz).toFixed(2)}×`
}

function formatTableLabel(value: string): string {
	return value.replace(firstCharacterPattern, (character) => character.toUpperCase())
}

function formatImplementationLink(name: string): string {
	const implementationRepoUrl = implementationRepositories[name]

	if (implementationRepoUrl === undefined) {
		throw new Error(`No repository configured for benchmark implementation "${name}".`)
	}

	const qualifier = name === upstreamPackageName ? ' (upstream)' : ''

	return `[\`${name}\`](${implementationRepoUrl})${qualifier}`
}

async function performance() {
	const report = JSON.parse(await readFile(benchmarkReportUrl, 'utf8')) as BenchmarkReport
	const groups = report.files.flatMap((file) => file.groups)
	const implementationGroup = groups.find((group) => getTaskName(group) === comparisonGroupName)

	if (implementationGroup === undefined) {
		throw new Error(`Benchmark report has no "${comparisonGroupName}" group.`)
	}

	const taskComparisons = groups
		.filter((group) => group !== implementationGroup)
		.map((group) => {
			const [task = getTaskName(group), input = ''] = getTaskName(group).split(': ', 2)
			const local = getBenchmark(group, localPackageName)
			const upstream = getBenchmark(group, upstreamPackageName)

			return { input, relativeSpeed: formatRelativeSpeed(local, upstream), task }
		})
	const inputNames = [...new Set(taskComparisons.map(({ input }) => input))]
	const inputHeadings = inputNames.map((input) => formatTableLabel(input))
	const taskNames = [...new Set(taskComparisons.map(({ task }) => task))]
	const taskRows = taskNames.map((task) => {
		const relativeSpeeds = inputNames.map(
			(input) =>
				taskComparisons.find((comparison) => comparison.input === input && comparison.task === task)
					?.relativeSpeed ?? '—',
		)

		return `| ${formatTableLabel(task)} | ${relativeSpeeds.join(' | ')} |`
	})
	const local = getBenchmark(implementationGroup, localPackageName)
	const implementationRows = implementationGroup.benchmarks
		.filter((benchmark) => benchmark !== local)
		.map(
			(benchmark) =>
				`| ${formatImplementationLink(benchmark.name)} | ${formatRelativeSpeed(local, benchmark)} |`,
		)

	return [
		'### Compared with upstream',
		'',
		`Values show the throughput of \`${localPackageName}\` vs. the upstream ` +
			`\`${upstreamPackageName}\`. 1.00× means equal throughput; higher means this repo is faster.`,
		'',
		`| Task | ${inputHeadings.join(' | ')} |`,
		`| :--- | ${inputNames.map(() => '---:').join(' | ')} |`,
		...taskRows,
		'',
		'### Compared with other implementations',
		'',
		`Values show the throughput of \`${localPackageName}\` relative to each named implementation. ` +
			'1.00× means equal throughput; higher means this repo is faster.',
		'',
		'| Compared with | Relative speed |',
		'| :--- | ---: |',
		...implementationRows,
	].join('\n')
}
