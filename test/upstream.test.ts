import upstream from 'safe-stable-stringify'
import { expect, test } from 'vitest'
import localStringify, { configure } from '../src/index.ts'

type Serializer = (
	value: unknown,
	replacer?: ((key: string, value: unknown) => unknown) | string[],
	space?: number | string,
) => unknown
type Options = Parameters<typeof upstream.configure>[0]
type NullValue = Exclude<ReturnType<RegExp['exec']>, RegExpExecArray>

const JSON_NULL = /a/v.exec('b') as NullValue
const keys = ['array', 'child', 'link', 'nested', 'root', 'self', 'value']
const options: Options[] = [
	{},
	{ deterministic: false },
	{ maximumDepth: 2 },
	{ maximumBreadth: 1 },
	{ bigint: 'string' },
	{ bigint: false },
	{ safe: true },
	{ strict: true },
	{ safe: true, strict: true },
	{ circularValue: Error },
	{ circularValue: TypeError, safe: true },
	{ circularValue: '[Circular]' },
	{ circularValue: '[Circular: 0]' },
	{ circularValue: JSON_NULL },
]
const scenarios = [
	{
		create() {
			return {
				array: [
					JSON_NULL,
					undefined,
					true,
					false,
					0,
					-0,
					NaN,
					Infinity,
					1n,
					'\n"\\',
					Symbol('value'),
				],
				child: new Float64Array([NaN, Infinity, -Infinity, -0, 1.5]),
				value: new BigInt64Array([1n, -1n]),
			}
		},
		name: 'primitive and typed array values',
	},
	{
		create() {
			type MutableRecord = Record<string, unknown>
			const array: unknown[] = []
			const child: MutableRecord = { array }
			const root: MutableRecord = { child, nested: { child } }
			root.self = root
			child.self = child
			child.root = root
			array.push(root, child, array)
			return root
		},
		name: 'circular and shared ancestors',
	},
	{
		create() {
			const array: unknown[] = []
			array.push(array)
			return array
		},
		name: 'root circular arrays',
	},
	{
		create() {
			let reads = 0
			return {
				child: {
					get toJSON() {
						reads++
						return () => reads
					},
				},
			}
		},
		name: 'toJSON accessors',
	},
	{
		create() {
			return {
				child: {
					get value() {
						throw new Error('property access failed')
					},
				},
			}
		},
		name: 'failing property accessors',
	},
	{
		create() {
			const error = Object.assign(() => 'function error', { message: 'function error' })
			return {
				toJSON() {
					throw error
				},
			}
		},
		name: 'function errors with a message',
	},
	{
		create() {
			let reads = 0
			const error = {
				get message() {
					return `error ${++reads}`
				},
			}
			return {
				toJSON() {
					throw error
				},
			}
		},
		name: 'error message accessors',
	},
	{
		create() {
			return {
				toJSON() {
					throw {
						get message() {
							throw new Error('message access failed')
						},
					}
				},
			}
		},
		name: 'failing error message accessors',
	},
]

function capture(callback: () => unknown): unknown {
	try {
		return { value: callback() }
	} catch (error) {
		return error instanceof Error
			? { error: error.name, message: error.message }
			: { thrown: typeof error }
	}
}

function serialize(
	serializer: Serializer,
	create: () => unknown,
	replacer: Parameters<Serializer>[1],
	space: number | undefined,
): unknown {
	return capture(() => serializer(create(), replacer, space))
}

test.each(scenarios)('$name match upstream in every mode', (scenario) => {
	for (const config of options) {
		for (const replacer of [undefined, (_key: string, value: unknown) => value, keys]) {
			for (const space of [undefined, 2]) {
				const create = () => scenario.create()
				const expected = serialize(upstream.configure(config), create, replacer, space)
				const actual = serialize(configure(config), create, replacer, space)
				expect(actual).toEqual(expected)
			}
		}
	}
})

test('strict mode validates invalid bigint options like upstream', () => {
	for (const bigint of [JSON_NULL, 1, 'invalid']) {
		const config = { bigint, strict: true }
		expect(
			capture(
				() =>
					// @ts-expect-error -- Check runtime validation of unsupported option values.
					typeof configure(config),
			),
		).toEqual(
			capture(
				() =>
					// @ts-expect-error -- Check runtime validation of unsupported option values.
					typeof upstream.configure(config),
			),
		)
	}
})

test('safe replacers receive the upstream receiver and captured error name', () => {
	function receiverReplacer(this: unknown, key: string, value: unknown): unknown {
		return key === 'value' ? this === undefined : value
	}

	function createFailingReplacer() {
		let nameReads = 0
		function replacer(key: string, value: unknown): unknown {
			if (key === 'value') {
				throw new Error('replacer failed')
			}

			return value
		}

		Object.defineProperty(replacer, 'name', {
			get() {
				return `replacer ${++nameReads}`
			},
		})
		return replacer
	}

	for (const safe of [false, true]) {
		for (const space of [undefined, 2]) {
			const local = configure({ safe })
			const original = upstream.configure({ safe })
			expect(local({ value: 0 }, receiverReplacer, space)).toBe(
				original({ value: 0 }, receiverReplacer, space),
			)
			expect(capture(() => local({ value: 0 }, createFailingReplacer(), space))).toEqual(
				capture(() => original({ value: 0 }, createFailingReplacer(), space)),
			)
		}
	}
})

test('the default export exposes upstream aliases and function names', () => {
	expect(Object.keys(localStringify)).toEqual(Object.keys(upstream))
	expect(localStringify.default).toBe(localStringify)
	expect(localStringify.stringify).toBe(localStringify)
	expect(localStringify.configure).toBe(configure)
	expect(localStringify.name).toBe(upstream.name)
	expect(localStringify.length).toBe(upstream.length)
	expect(configure.length).toBe(upstream.configure.length)
	expect(configure().name).toBe(upstream.configure({}).name)
})
