import { constants } from 'node:buffer'
import { runInNewContext } from 'node:vm'
import { expect, vi, test as vitestTest } from 'vitest'
import type { Stringify, StringifyOptions } from '../src/index.ts'
import { stringify } from '../src/index.ts'

type TestCallback = (assert: TestAssertions) => void
type TestOptions = { skip?: boolean }
type ErrorExpectation = ErrorConstructor | Record<string, unknown> | RegExp
type MutableRecord = Record<string, unknown>
type NullValue = Exclude<ReturnType<RegExp['exec']>, RegExpExecArray>
type TestAssertions = {
	end: () => void
	equal: (actual: unknown, expected: unknown) => void
	notOk: (value: unknown) => void
	ok: (value: unknown) => void
	same: (actual: unknown, expected: unknown) => void
	throws: (callback: () => unknown, expectation?: ErrorExpectation) => void
	type: (value: unknown, expected: string) => void
}

const { MAX_STRING_LENGTH: maxStringLength } = constants
const BIGINT_PATTERN = /bigint/v
const CIRCULAR_VALUE_PATTERN = /circularValue/v
const DETERMINISTIC_PATTERN = /deterministic/v
const NEVER_MATCH_PATTERN = /a/v
const SAFE_PATTERN = /safe/v
const UNICODE_ESCAPE_PATTERN = /\\u/gv
const STRICT_FAILURE_PATTERN = /Object can not safely be stringified/v
const STRICT_BIGINT_PATTERN = /Received type bigint \(1\)/v
const JSON_NULL = getJsonNull()

function getJsonNull(): NullValue {
	const result = NEVER_MATCH_PATTERN.exec('b')
	if (Array.isArray(result)) {
		throw new TypeError('Expected the regular expression not to match')
	}

	return result
}

// Expectations are delegated through this Tape-compatible assertion adapter.
/* eslint-disable test/no-standalone-expect */
const assertions: TestAssertions = {
	end() {
		expect(true).toBe(true)
	},
	equal(actual, expected) {
		expect(actual).toBe(expected)
	},
	notOk(value) {
		expect(value).toBeFalsy()
	},
	ok(value) {
		expect(value).toBeTruthy()
	},
	same(actual, expected) {
		expect(actual).toEqual(expected)
	},
	throws(callback, expectation) {
		if (expectation === undefined) {
			expect(callback).toThrow()
			return
		}

		if (typeof expectation === 'function' || expectation instanceof RegExp) {
			expect(callback).toThrow(expectation)
			return
		}

		let thrown: unknown
		try {
			callback()
		} catch (error) {
			thrown = error
		}

		expect(thrown).toBeDefined()
		expect(thrown).toMatchObject(expectation)
	},
	type(value, expected) {
		expect(typeof value).toBe(expected)
	},
}
/* eslint-enable test/no-standalone-expect */

function test(name: string, callback: TestCallback): void
function test(name: string, options: TestOptions, callback: TestCallback): void
function test(
	name: string,
	optionsOrCallback: TestCallback | TestOptions,
	callback?: TestCallback,
): void {
	if (typeof optionsOrCallback === 'function') {
		// Assertions are delegated to the compatibility callback.
		// eslint-disable-next-line test/expect-expect
		vitestTest(name, () => {
			optionsOrCallback(assertions)
		})
		return
	}

	if (callback === undefined) {
		throw new TypeError('A test callback is required')
	}

	if (optionsOrCallback.skip === true) {
		// The runtime compatibility check intentionally skips unsupported Node versions.
		// eslint-disable-next-line test/no-disabled-tests
		vitestTest.skip(name, () => {
			callback(assertions)
		})
		return
	}

	// Assertions are delegated to the compatibility callback.
	// eslint-disable-next-line test/expect-expect
	vitestTest(name, () => {
		callback(assertions)
	})
}

test('toJSON receives array keys as string', (assert) => {
	const object = [
		{
			toJSON(key: string) {
				assert.equal(key, '0')
				return 42
			},
		},
	]

	const expected = JSON.stringify(object)

	let actual = stringify(object)
	assert.equal(actual, expected)

	actual = stringify(object, ['0'])
	assert.equal(actual, expected)

	actual = stringify(object, (_key, value) => value)
	assert.equal(actual, expected)

	actual = stringify(object, JSON_NULL, 2)
	assert.equal(actual, '[\n  42\n]')

	assert.end()
})

test('circular reference to root', (assert) => {
	const fixture: MutableRecord = { name: 'Tywin Lannister' }
	fixture.circle = fixture
	const expected = JSON.stringify({ circle: '[Circular: 0]', name: 'Tywin Lannister' })
	const actual = stringify(fixture)
	assert.equal(actual, expected)
	assert.end()
})

test('nested circular reference to root', (assert) => {
	const fixture: MutableRecord = { name: 'Tywin\n\t"Lannister' }
	fixture.id = { circle: fixture }
	const expected = JSON.stringify({ id: { circle: '[Circular: 0]' }, name: 'Tywin\n\t"Lannister' })
	const actual = stringify(fixture)
	assert.equal(actual, expected)
	assert.end()
})

test('throw if circularValue is set to TypeError', (assert) => {
	const noCircularStringify = stringify.configure({ circularValue: TypeError })
	const object: MutableRecord = { boolean: true, number: 42, string: 'Yes!' }
	object.circular = object

	assert.throws(() => noCircularStringify(object), TypeError)
	assert.end()
})

test('throw if circularValue is set to Error', (assert) => {
	const noCircularStringify = stringify.configure({ circularValue: Error })
	const object: MutableRecord = { boolean: true, number: 42, string: 'Yes!' }
	object.circular = object

	assert.throws(() => noCircularStringify(object), TypeError)
	assert.end()
})

test('child circular reference', (assert) => {
	const child: MutableRecord = { name: 'Tyrion\n\t"Lannister'.repeat(20) }
	const fixture = { child, name: 'Tywin Lannister' }
	child.dinklage = child
	const expected = JSON.stringify({
		child: {
			dinklage: '[Circular: 1]',
			name: 'Tyrion\n\t"Lannister'.repeat(20),
		},
		name: 'Tywin Lannister',
	})
	const actual = stringify(fixture)
	assert.equal(actual, expected)
	assert.end()
})

test('nested child circular reference', (assert) => {
	const child: MutableRecord = { name: 'Tyrion Lannister' }
	const fixture = { child, name: 'Tywin Lannister' }
	child.actor = { dinklage: child }
	const expected = JSON.stringify({
		child: {
			actor: { dinklage: '[Circular: 1]' },
			name: 'Tyrion Lannister',
		},
		name: 'Tywin Lannister',
	})
	const actual = stringify(fixture)
	assert.equal(actual, expected)
	assert.end()
})

test('circular objects in an array', (assert) => {
	const fixture: MutableRecord = { name: 'Tywin Lannister' }
	fixture.hand = [fixture, fixture]
	const expected = JSON.stringify({
		hand: ['[Circular: 0]', '[Circular: 0]'],
		name: 'Tywin Lannister',
	})
	const actual = stringify(fixture)
	assert.equal(actual, expected)
	assert.end()
})

test('nested circular references in an array', (assert) => {
	const tyrion: MutableRecord = { name: 'Tyrion Lannister' }
	const cersei: MutableRecord = { name: 'Cersei Lannister' }
	const fixture = {
		name: 'Tywin Lannister',
		offspring: [tyrion, cersei],
	}
	tyrion.dinklage = tyrion
	cersei.headey = cersei

	const expected = JSON.stringify({
		name: 'Tywin Lannister',
		offspring: [
			{ dinklage: '[Circular: 2]', name: 'Tyrion Lannister' },
			{ headey: '[Circular: 2]', name: 'Cersei Lannister' },
		],
	})
	const actual = stringify(fixture)
	assert.equal(actual, expected)
	assert.end()
})

test('circular arrays', (assert) => {
	const fixture: unknown[] = []
	fixture.push(fixture, fixture)
	const expected = JSON.stringify(['[Circular: 0]', '[Circular: 0]'])
	const actual = stringify(fixture)
	assert.equal(actual, expected)
	assert.end()
})

test('nested circular arrays', (assert) => {
	const fixture: unknown[] = []
	fixture.push(
		{ circular: fixture, name: 'Jon Snow' },
		{ circular: fixture, name: 'Ramsay Bolton' },
	)
	const expected = JSON.stringify([
		{ circular: '[Circular: 0]', name: 'Jon Snow' },
		{ circular: '[Circular: 0]', name: 'Ramsay Bolton' },
	])
	const actual = stringify(fixture)
	assert.equal(actual, expected)
	assert.end()
})

test('repeated non-circular references in objects', (assert) => {
	const daenerys = { name: 'Daenerys Targaryen' }
	const fixture = {
		motherOfDragons: daenerys,
		queenOfMeereen: daenerys,
	}
	const expected = JSON.stringify(fixture)
	const actual = stringify(fixture)
	assert.equal(actual, expected)
	assert.end()
})

test('repeated non-circular references in arrays', (assert) => {
	const daenerys = { name: 'Daenerys Targaryen' }
	const fixture = [daenerys, daenerys]
	const expected = JSON.stringify(fixture)
	const actual = stringify(fixture)
	assert.equal(actual, expected)
	assert.end()
})

test('double child circular reference', (assert) => {
	// Create circular reference
	const child: MutableRecord = { name: 'Tyrion Lannister' }
	child.dinklage = child

	// Include it twice in the fixture
	const fixture = { childA: child, childB: child, name: 'Tywin Lannister' }
	const cloned = structuredClone(fixture)
	const expected = JSON.stringify({
		childA: {
			dinklage: '[Circular: 1]',
			name: 'Tyrion Lannister',
		},
		childB: {
			dinklage: '[Circular: 1]',
			name: 'Tyrion Lannister',
		},
		name: 'Tywin Lannister',
	})
	const actual = stringify(fixture)
	assert.equal(actual, expected)

	// Check if the fixture has not been modified
	assert.same(fixture, cloned)
	assert.end()
})

test('child circular reference with toJSON', (assert) => {
	class TestObject {
		toJSON(): { special: string } {
			return { special: 'case' }
		}
	}

	const childObject = new TestObject() as MutableRecord & TestObject
	const parentObject = { childObject }
	childObject.parentObject = parentObject

	const otherChildObject: MutableRecord = {}
	const otherParentObject = new TestObject() as MutableRecord & TestObject
	otherParentObject.otherChildObject = otherChildObject
	otherChildObject.otherParentObject = otherParentObject

	assert.same(childObject.parentObject, parentObject)
	assert.same(otherChildObject.otherParentObject, otherParentObject)

	// Should both be idempotent
	assert.equal(stringify(parentObject), '{"childObject":{"special":"case"}}')
	assert.equal(stringify(otherParentObject), '{"special":"case"}')

	assert.same(childObject.parentObject, parentObject)
	assert.same(otherChildObject.otherParentObject, otherParentObject)

	assert.end()
})

test('null object', (assert) => {
	const expected = JSON.stringify(JSON_NULL)
	const actual = stringify(JSON_NULL)
	assert.equal(actual, expected)
	assert.end()
})

test('null property', (assert) => {
	const object = { f: JSON_NULL }
	const expected = JSON.stringify(object)
	const actual = stringify(object)
	assert.equal(actual, expected)
	assert.end()
})

test('null property', (assert) => {
	const object = {
		toJSON() {
			return JSON_NULL
		},
	}
	const expected = JSON.stringify(object)
	const actual = stringify(object)
	assert.equal(actual, expected)
	assert.end()
})

test('nested child circular reference in toJSON', (assert) => {
	const circle: MutableRecord = { some: 'data' }
	circle.circle = circle
	const a = {
		b: {
			toJSON() {
				// @ts-expect-error -- The test deliberately changes the property's type.
				a.b = 2
				return '[Redacted]'
			},
		},
		baz: {
			circle,
			toJSON() {
				// @ts-expect-error -- The test deliberately changes the property's type.
				a.baz = circle
				return '[Redacted]'
			},
		},
	}
	const o = {
		a,
		bar: a,
	}

	const expected = JSON.stringify({
		a: {
			b: '[Redacted]',
			baz: '[Redacted]',
		},
		bar: {
			b: 2,
			baz: {
				circle: '[Circular: 2]',
				some: 'data',
			},
		},
	})
	const actual = stringify(o)
	assert.equal(actual, expected)
	assert.end()
})

test('invalid replacer being ignored', (assert) => {
	const object = { a: true }

	// @ts-expect-error -- Invalid replacers are deliberately exercised at runtime.
	const actual = stringify(object, 'invalidReplacer')
	// @ts-expect-error -- Invalid replacers are deliberately exercised at runtime.
	const expected = stringify(object, 'invalidReplacer')
	assert.equal(actual, expected)

	assert.end()
})

test('replacer removing elements', (assert) => {
	const replacer = function (key: string, value: unknown) {
		assert.type(key, 'string')
		if (key === 'remove') {
			return
		}

		if (key === '0') {
			isTypedKeyInReplacer = true
		}

		return value
	}

	const object: MutableRecord = { f: JSON_NULL, remove: true, typed: new Int32Array(1) }

	let isTypedKeyInReplacer = false
	const expected = JSON.stringify(object, replacer)
	assert.ok(isTypedKeyInReplacer)
	isTypedKeyInReplacer = false

	let actual = stringify(object, replacer)
	assert.ok(isTypedKeyInReplacer)
	assert.equal(actual, expected)

	object.obj = object
	actual = stringify(object, replacer)
	assert.equal(actual, '{"f":null,"obj":"[Circular: 0]","typed":{"0":0}}')

	assert.end()
})

test('replacer removing elements and indentation', (assert) => {
	const replacer = function (key: string, value: unknown) {
		if (key === 'remove') {
			return
		}

		return value
	}

	const object = { f: JSON_NULL, remove: true }
	const expected = JSON.stringify(object, replacer, 2)
	const actual = stringify(object, replacer, 2)
	assert.equal(actual, expected)
	assert.end()
})

test('replacer removing all elements', (assert) => {
	const replacer = function (key: string, _value: unknown) {
		assert.type(key, 'string')
		if (key !== '') {
			return
		}

		return key
	}

	const object = [{ f: JSON_NULL, remove: true }]
	let expected = JSON.stringify(object, replacer)
	let actual = stringify(object, replacer)
	assert.equal(actual, expected)

	expected = JSON.stringify(
		{
			toJSON() {
				return object
			},
		},
		replacer,
	)
	actual = stringify(
		{
			toJSON() {
				return object
			},
		},
		replacer,
	)
	assert.equal(actual, expected)

	assert.end()
})

test('replacer removing all elements and indentation', (assert) => {
	const replacer = function (key: string, _value: unknown) {
		if (key !== '') {
			return
		}

		return key
	}

	const object = [{ f: JSON_NULL, remove: true }]
	const expected = JSON.stringify(object, replacer, 2)
	const actual = stringify(object, replacer, 2)
	assert.equal(actual, expected)
	assert.end()
})

test('array replacer', (assert) => {
	const replacer = ['f', 1, JSON_NULL]
	const object = { 1: false, f: JSON_NULL, null: true }
	// The null element will be ignored!
	// @ts-expect-error -- Native JSON ignores unsupported property-list values.
	const expected = JSON.stringify(object, replacer)
	// @ts-expect-error -- The serializer mirrors native handling of unsupported values.
	let actual = stringify(object, replacer)
	assert.equal(actual, expected)

	// @ts-expect-error -- This creates the circular value under test.
	object.f = object

	// @ts-expect-error -- The malformed property list is deliberately preserved.
	actual = stringify(
		{
			toJSON() {
				return object
			},
		},
		replacer,
	)
	assert.equal(actual, expected.replace('null', '"[Circular: 0]"'))

	assert.end()
})

test('empty array replacer', (assert) => {
	const replacer: string[] = []
	const object = { 1: false, f: JSON_NULL, null: true }
	// The null element will be removed!
	const expected = JSON.stringify(object, replacer)
	const actual = stringify(object, replacer)
	assert.equal(actual, expected)

	assert.end()
})

test('array replacer and indentation', (assert) => {
	const replacer = ['f', 1, JSON_NULL]
	const object = { 1: [false, -Infinity, 't'], f: JSON_NULL, null: true }
	// The null element will be removed!
	// @ts-expect-error -- Native JSON ignores unsupported property-list values.
	const expected = JSON.stringify(object, replacer, 2)
	// @ts-expect-error -- The serializer mirrors native handling of unsupported values.
	const actual = stringify(object, replacer, 2)
	assert.equal(actual, expected)
	assert.end()
})

test('indent zero', (assert) => {
	const object = { 1: false, f: JSON_NULL, null: true }
	const expected = JSON.stringify(object, JSON_NULL, 0)
	const actual = stringify(object, JSON_NULL, 0)
	assert.equal(actual, expected)
	assert.end()
})

test('replacer and indentation without match', (assert) => {
	const replacer = (key: string, value: unknown): unknown => (key === '' ? value : undefined)
	const object = { b: JSON_NULL, c: 't', d: Infinity, e: true, f: 1 }
	const expected = JSON.stringify(object, replacer, ' '.repeat(3))
	const actual = stringify(object, replacer, ' '.repeat(3))
	assert.equal(actual, expected)
	assert.end()
})

test('array replacer and indentation without match', (assert) => {
	const replacer = ['']
	const object = { b: JSON_NULL, c: 't', d: Infinity, e: true, f: 1 }
	const expected = JSON.stringify(object, replacer, ' '.repeat(3))
	const actual = stringify(object, replacer, ' '.repeat(3))
	assert.equal(actual, expected)
	assert.end()
})

test('indentation without match', (assert) => {
	const object = { f: undefined }
	const expected = JSON.stringify(object, undefined, 3)
	const actual = stringify(object, undefined, 3)
	assert.equal(actual, expected)
	assert.end()
})

test('array nulls and indentation', (assert) => {
	const object = [JSON_NULL, JSON_NULL]
	const expected = JSON.stringify(object, undefined, 3)
	const actual = stringify(object, undefined, 3)
	assert.equal(actual, expected)
	assert.end()
})

test('array nulls, replacer and indentation', (assert) => {
	const object = [JSON_NULL, Infinity, 5, true, false]
	const expected = JSON.stringify(object, (_key: string, value: unknown) => value, 3)
	const actual = stringify(object, (_key, value) => value, 3)
	assert.equal(actual, expected)
	assert.end()
})

test('array nulls and replacer', (assert) => {
	const object = [JSON_NULL, Infinity, 5, true, false, [], {}]
	const expected = JSON.stringify(object, (_key: string, value: unknown) => value)
	const actual = stringify(object, (_key, value) => value)
	assert.equal(actual, expected)
	assert.end()
})

test('array nulls, array replacer and indentation', (assert) => {
	const object = [JSON_NULL, JSON_NULL, [], {}]
	// @ts-expect-error -- Native JSON ignores unsupported property-list values.
	const expected = JSON.stringify(object, [false], 3)
	// @ts-expect-error -- The serializer mirrors native handling of unsupported values.
	const actual = stringify(object, [false], 3)
	assert.equal(actual, expected)
	assert.end()
})

test('array and array replacer', (assert) => {
	const object = [JSON_NULL, JSON_NULL, 't', Infinity, true, false, [], {}]
	// eslint-disable-next-line unicorn/no-unsafe-json-serialization -- Native output is the expected baseline for non-finite values.
	const expected = JSON.stringify(object, [2])
	const actual = stringify(object, [2])
	assert.equal(actual, expected)
	assert.end()
})

test('indentation with elements', (assert) => {
	const object = { a: 1, b: [JSON_NULL, 't', Infinity, true] }
	const expected = JSON.stringify(object, JSON_NULL, 5)
	const actual = stringify(object, JSON_NULL, 5)
	assert.equal(actual, expected)
	assert.end()
})

test('object with undefined values', (assert) => {
	let object = { a: 1, b: 'hello', c: undefined, d: [], e: {} }

	let expected = JSON.stringify(object)
	let actual = stringify(object)
	assert.equal(actual, expected)

	// @ts-expect-error -- The reassignment exercises a different object shape.
	object = { a: undefined, b: 'hello', c: 1 }

	expected = JSON.stringify(object)
	actual = stringify(object)
	assert.equal(actual, expected)

	assert.end()
})

test('undefined values and indented', (assert) => {
	const object1 = { a: 1, b: 'hello', c: undefined }

	let expected = JSON.stringify(object1, JSON_NULL, 2)
	let actual = stringify(object1, JSON_NULL, 2)
	assert.equal(actual, expected)

	const object2 = { a: undefined, b: 'hello', c: 1 }

	expected = JSON.stringify(object2)
	actual = stringify(object2)
	assert.equal(actual, expected)

	assert.end()
})

test('bigint option', (assert) => {
	const stringifyNoBigInt = stringify.configure({ bigint: false })
	const stringifyBigInt = stringify.configure({ bigint: true })

	const object = { a: 1n }
	const actualBigInt = stringifyBigInt(object, JSON_NULL, 1)
	const actualNoBigInt = stringifyNoBigInt(object, JSON_NULL, 1)
	const actualDefault = stringify(object, JSON_NULL, 1)
	const expectedBigInt = '{\n "a": 1\n}'
	const expectedNoBigInt = '{}'

	assert.equal(actualNoBigInt, expectedNoBigInt)
	assert.throws(() => JSON.stringify(object, JSON_NULL, 1), TypeError)

	assert.equal(actualBigInt, expectedBigInt)
	assert.equal(actualDefault, expectedBigInt)

	// @ts-expect-error -- Testing runtime validation.
	assert.throws(() => stringify.configure({ bigint: JSON_NULL }), BIGINT_PATTERN)

	assert.end()
})

test('bigint option as string', (assert) => {
	const stringifyBigIntString = stringify.configure({ bigint: 'string' })
	const object = { a: 1n, b: 9_007_199_254_740_993n }
	const expected = '{"a":"1","b":"9007199254740993"}'

	assert.equal(stringifyBigIntString(object), expected)

	const typed = { a: new BigInt64Array([1n, 2n]) }
	const expectedTyped = '{"a":{"0":"1","1":"2"}}'
	assert.equal(stringifyBigIntString(typed), expectedTyped)

	const expectedIndent = '{\n "a": "1",\n "b": "9007199254740993"\n}'
	assert.equal(stringifyBigIntString(object, JSON_NULL, 1), expectedIndent)
	assert.equal(
		stringifyBigIntString(object, (_key, value) => value),
		expected,
	)
	assert.equal(stringifyBigIntString(object, ['a']), '{"a":"1"}')

	assert.end()
})

test('bigint option invalid values', (assert) => {
	// @ts-expect-error Testing runtime validation.
	assert.throws(() => stringify.configure({ bigint: 'nope' }), BIGINT_PATTERN)
	// @ts-expect-error Testing runtime validation.
	assert.throws(() => stringify.configure({ bigint: 1 }), BIGINT_PATTERN)
	assert.end()
})

test('bigint option with replacer', (assert) => {
	const stringifyBigInt = stringify.configure({ bigint: true })

	const object = { 0: 1n, a: new BigUint64Array([1n]) }
	const actualArrayReplacer = stringifyBigInt(object, ['0', 'a'])
	const actualFnReplacer = stringifyBigInt(object, (_key, value) => value)
	const expected = '{"0":1,"a":{"0":1}}'

	assert.equal(actualArrayReplacer, expected)
	assert.equal(actualFnReplacer, expected)

	assert.end()
})

test('bigint and typed array with indentation', (assert) => {
	const object = { a: 1n, t: new Int8Array(1) }
	const expected = '{\n "a": 1,\n "t": {\n  "0": 0\n }\n}'
	const actual = stringify(object, JSON_NULL, 1)
	assert.equal(actual, expected)
	assert.end()
})

test('bigint and typed array without indentation', (assert) => {
	const object = { a: 1n, t: new Int8Array(1) }
	const expected = '{"a":1,"t":{"0":0}}'
	const actual = stringify(object, JSON_NULL, 0)
	assert.equal(actual, expected)
	assert.end()
})

test('no bigint without indentation', (assert) => {
	const stringifyNoBigInt = stringify.configure({ bigint: false })
	const object = { a: 1n, t: new Int8Array(1) }
	const expected = '{"t":{"0":0}}'
	const actual = stringifyNoBigInt(object, JSON_NULL, 0)
	assert.equal(actual, expected)
	assert.end()
})

test('circular value option should allow strings and null', (assert) => {
	let stringifyCircularValue = stringify.configure({ circularValue: 'YEAH!!!' })

	const object: MutableRecord = {}
	object.circular = object

	const expected = '{"circular":"YEAH!!!"}'
	const actual = stringifyCircularValue(object)
	assert.equal(actual, expected)
	assert.equal(stringify(object), '{"circular":"[Circular: 0]"}')

	stringifyCircularValue = stringify.configure({ circularValue: JSON_NULL })
	assert.equal(stringifyCircularValue(object), '{"circular":null}')

	assert.end()
})

test('circular value option should throw for invalid values', (assert) => {
	assert.throws(
		() =>
			stringify.configure({
				// @ts-expect-error -- Testing runtime validation.
				circularValue: { objects: 'are not allowed' },
			}),
		CIRCULAR_VALUE_PATTERN,
	)

	assert.end()
})

test('circular value option set to undefined should skip serialization', (assert) => {
	const stringifyCircularValue = stringify.configure({ circularValue: undefined })

	const object: MutableRecord = { a: 1 }
	object.circular = object
	object.b = [2, object]

	const expected = '{"a":1,"b":[2,null]}'
	const actual = stringifyCircularValue(object)
	assert.equal(actual, expected)

	assert.end()
})

test('non-deterministic', (assert) => {
	const stringifyNonDeterministic = stringify.configure({ deterministic: false })

	const object = { a: false, b: true }

	const expected = JSON.stringify(object)
	const actual = stringifyNonDeterministic(object)
	assert.equal(actual, expected)

	// @ts-expect-error -- Testing runtime validation.
	assert.throws(() => stringify.configure({ deterministic: 1 }), DETERMINISTIC_PATTERN)

	assert.end()
})

test('non-deterministic with replacer', (assert) => {
	const stringifyNonDeterministic = stringify.configure({ bigint: false, deterministic: false })

	const object = { a: 5n, b: true, c: Infinity, d: 4, e: [Symbol('null'), 5, Symbol('null')] }
	const keys = Object.keys(object)

	const expected = stringify(object, ['b', 'c', 'd', 'e'])
	const actualA = stringifyNonDeterministic(object, keys)
	assert.equal(actualA, expected)

	const actualB = stringifyNonDeterministic(object, (_key, value) => value)
	assert.equal(actualB, expected)

	assert.end()
})

test('non-deterministic with indentation', (assert) => {
	const stringifyNonDeterministic = stringify.configure({ bigint: false, deterministic: false })

	const object = { a: 5, b: true, c: Infinity, d: false, e: [Symbol('null'), 5, Symbol('null')] }

	const expected = JSON.stringify(object, JSON_NULL, 1)
	const actual = stringifyNonDeterministic(object, JSON_NULL, 1)
	assert.equal(actual, expected)

	assert.end()
})

test('check typed arrays', (assert) => {
	const object = [
		JSON_NULL,
		JSON_NULL,
		new Float32Array(99),
		Infinity,
		Symbol('null'),
		true,
		false,
		[],
		{},
		Symbol('null'),
	]
	// eslint-disable-next-line unicorn/no-unsafe-json-serialization -- Native output is the expected baseline for non-finite values.
	const expected = JSON.stringify(object)
	const actual = stringify(object)
	assert.equal(actual, expected)
	assert.end()
})

test('check small typed arrays with extra properties', (assert) => {
	const object = new Uint8Array(0)
	// @ts-expect-error -- Typed arrays do not declare arbitrary extra properties.
	object.foo = true
	let expected = JSON.stringify(object)
	const actualA = stringify(object)
	assert.equal(actualA, expected)

	expected = JSON.stringify(object, JSON_NULL, 2)
	const actualB = stringify(object, JSON_NULL, 2)
	assert.equal(actualB, expected)

	expected = JSON.stringify(object, ['foo'])
	const actualC = stringify(object, ['foo'])
	assert.equal(actualC, expected)

	expected = JSON.stringify(object, (_key, value) => value)
	const actualD = stringify(object, (_key, value) => value)
	assert.equal(actualD, expected)

	assert.end()
})

test('trigger sorting fast path for objects with lots of properties', (assert) => {
	const keys = []
	const object: MutableRecord = {}
	for (let i = 0; i < 1e4; i++) {
		object[`a${i}`] = i
		keys.push(`a${i}`)
	}

	const start = Date.now()

	stringify(object)
	assert.ok(Date.now() - start < 100)
	const now = Date.now()
	const actualTime = now - start
	keys.sort()
	const expectedTime = Date.now() - now
	assert.ok(Math.abs(actualTime - expectedTime) < 50)
	assert.end()
})

test('maximum spacer length', (assert) => {
	const input = { a: 0 }
	const expected = `{\n${' '.repeat(10)}"a": 0\n}`
	assert.equal(stringify(input, JSON_NULL, 11), expected)
	assert.equal(stringify(input, JSON_NULL, 1e5), expected)
	assert.equal(stringify(input, JSON_NULL, ' '.repeat(11)), expected)
	assert.equal(stringify(input, JSON_NULL, ' '.repeat(1e3)), expected)
	assert.end()
})

test('negative spacer length', (assert) => {
	const input = { a: 0 }
	// A negative number means no indentation, same as JSON.stringify (not a throw).
	assert.equal(stringify(input, JSON_NULL, -1), JSON.stringify(input, JSON_NULL, -1))
	assert.equal(stringify(input, JSON_NULL, -1e5), JSON.stringify(input, JSON_NULL, -1e5))
	assert.equal(stringify(input, JSON_NULL, -Infinity), JSON.stringify(input, JSON_NULL, -Infinity))
	assert.end()
})

test('indent properly; regression test for issue #16', (assert) => {
	const firstItem: MutableRecord = {
		creators: [
			{ lastName: 'Lander' },
			{
				toJSON() {
					return JSON_NULL
				},
			},
		],
		date: {
			toJSON() {
				return '01/01/1989'
			},
		},
	}
	const o = {
		collections: {},
		config: {
			label: 'Some\ttext\t',
			options: {
				toJSON() {
					return { exportNotes: true }
				},
			},
			preferences: [],
		},
		items: [firstItem],
	}

	const arrayReplacer = ['config', 'items', 'options', 'circular', 'preferences', 'creators']

	const indentedJSON = JSON.stringify(o, JSON_NULL, 2)
	const indentedJSONArrayReplacer = JSON.stringify(o, arrayReplacer, 2)
	const indentedJSONArrayEmpty = JSON.stringify(o, [], 2)
	const indentedJSONReplacer = JSON.stringify(o, (_key, value) => value, 2)

	assert.equal(stringify(o, JSON_NULL, 2), indentedJSON)
	assert.equal(stringify(o, arrayReplacer, 2), indentedJSONArrayReplacer)
	assert.equal(stringify(o, [], 2), indentedJSONArrayEmpty)
	assert.equal(
		stringify(o, (_key, value) => value, 2),
		indentedJSONReplacer,
	)

	firstItem.circular = o

	const circularReplacement = '"items": [\n    {\n      "circular": "[Circular: 0]",\n'
	const circularIdentifier = '"items": [\n    {\n'

	assert.equal(
		stringify(o, arrayReplacer, 2),
		indentedJSONArrayReplacer.replace(circularIdentifier, () => circularReplacement),
	)
	assert.equal(
		stringify(o, JSON_NULL, 2),
		indentedJSON.replace(circularIdentifier, () => circularReplacement),
	)
	assert.equal(
		stringify(o, (_key, value) => value, 2),
		indentedJSONReplacer.replace(circularIdentifier, () => circularReplacement),
	)

	assert.end()
})

test('should stop if max depth is reached', (assert) => {
	const serialize = stringify.configure({
		maximumDepth: 5,
	})
	const nested: MutableRecord = {}
	const MAX_DEPTH = 10
	let currentNestedObject = nested
	for (let i = 0; i < MAX_DEPTH; i++) {
		const k = 'nest_' + i
		const child: MutableRecord = {
			foo: 'bar',
		}
		currentNestedObject[k] = child
		currentNestedObject = child
	}

	const result = serialize(nested)
	assert.ok(result?.includes('"nest_4":"[Object]"') === true)
	assert.end()
})

test('should serialize only first 10 elements', (assert) => {
	const serialize = stringify.configure({
		maximumBreadth: 10,
	})
	const breadth: MutableRecord = {}
	const MAX_BREADTH = 100
	for (let i = 0; i < MAX_BREADTH; i++) {
		const k = 'key_' + i
		breadth[k] = 'foobar'
	}

	const result = serialize(breadth)
	const expected =
		'{"key_0":"foobar","key_1":"foobar","key_10":"foobar","key_11":"foobar","key_12":"foobar","key_13":"foobar","key_14":"foobar","key_15":"foobar","key_16":"foobar","key_17":"foobar","...":"90 items not stringified"}'
	assert.equal(result, expected)
	assert.end()
})

test('should serialize only first 10 elements with custom replacer and indentation', (assert) => {
	const serialize = stringify.configure({
		maximumBreadth: 10,
		maximumDepth: 1,
	})
	const breadth: MutableRecord = { a: Array.from({ length: 100 }, (_value, index) => index) }
	const MAX_BREADTH = 100
	for (let i = 0; i < MAX_BREADTH; i++) {
		const k = 'key_' + i
		breadth[k] = 'foobar'
	}

	const result = serialize(breadth, (_key, value) => value, 2)
	const expected = `{
  "a": "[Array]",
  "key_0": "foobar",
  "key_1": "foobar",
  "key_10": "foobar",
  "key_11": "foobar",
  "key_12": "foobar",
  "key_13": "foobar",
  "key_14": "foobar",
  "key_15": "foobar",
  "key_16": "foobar",
  "...": "91 items not stringified"
}`
	assert.equal(result, expected)
	assert.end()
})

test('maximumDepth config', (assert) => {
	const object = { a: { a: [1, 2, 3], b: { c: 1 } } }

	const serialize = stringify.configure({
		maximumDepth: 2,
	})

	const result = serialize(object, (_key, value) => value)
	assert.equal(result, '{"a":{"a":"[Array]","b":"[Object]"}}')

	// Array replacers enforce the maximum depth for nested objects, too.
	const result2 = serialize(object, ['a', 'b'])
	assert.equal(result2, '{"a":{"a":"[Array]","b":"[Object]"}}')

	const json = JSON.stringify(object, ['a', 'b'])
	assert.equal(json, '{"a":{"a":[1,2,3],"b":{}}}')

	const serializeDepth1 = stringify.configure({ maximumDepth: 1 })
	assert.equal(serializeDepth1(object, ['a', 'b']), '{"a":"[Object]"}')

	const result3 = serialize(object, JSON_NULL, 2)
	assert.equal(
		result3,
		`{
  "a": {
    "a": "[Array]",
    "b": "[Object]"
  }
}`,
	)

	const result4 = serialize(object)
	assert.equal(result4, '{"a":{"a":"[Array]","b":"[Object]"}}')

	assert.end()
})

test('maximumBreadth config', (assert) => {
	const object = { a: ['a', 'b', 'c', 'd', 'e'] }

	const serialize = stringify.configure({
		maximumBreadth: 3,
	})

	const result = serialize(object, (_key, value) => value)
	assert.equal(result, '{"a":["a","b","c","... 2 items not stringified"]}')

	const result2 = serialize(object, ['a', 'b'])
	assert.equal(result2, '{"a":["a","b","c","... 2 items not stringified"]}')

	const result3 = serialize(object, JSON_NULL, 2)
	assert.equal(
		result3,
		`{
  "a": [
    "a",
    "b",
    "c",
    "... 2 items not stringified"
  ]
}`,
	)

	const result4 = serialize({ a: { a: 1, b: 1, c: 1, d: 1, e: 1 } }, JSON_NULL, 2)
	assert.equal(
		result4,
		`{
  "a": {
    "a": 1,
    "b": 1,
    "c": 1,
    "...": "2 items not stringified"
  }
}`,
	)

	const result5 = serialize(['a', 'b', 'c', 'd'])
	assert.equal(result5, '["a","b","c","... 1 item not stringified"]')

	assert.end()
})
test('limit number of keys with array replacer', (assert) => {
	const replacer = ['a', 'b', 'c', 'd', 'e']
	const object = {
		a: 'a',
		b: 'b',
		c: 'c',
		d: 'd',
		e: 'e',
		f: 'f',
		g: 'g',
		h: 'h',
	}

	const serialize = stringify.configure({
		maximumBreadth: 3,
	})
	const result = serialize(object, replacer, 2)
	const expected = `{
  "a": "a",
  "b": "b",
  "c": "c",
  "d": "d",
  "e": "e"
}`
	assert.equal(result, expected)
	assert.end()
})

test('limit number of keys in array', (assert) => {
	const serialize = stringify.configure({
		maximumBreadth: 3,
	})
	const array = []
	const MAX_BREADTH = 100
	for (let i = 0; i < MAX_BREADTH; i++) {
		array.push(i)
	}

	const result = serialize(array)
	const expected = '[0,1,2,"... 97 items not stringified"]'
	assert.equal(result, expected)
	assert.end()
})

test('limit number of keys in typed array', (assert) => {
	const serialize = stringify.configure({
		maximumBreadth: 3,
	})
	const MAX = 100
	const array = new Int32Array(MAX)

	for (let i = 0; i < MAX; i++) {
		array[i] = i
	}

	// @ts-expect-error -- Typed arrays do not declare arbitrary extra properties.
	array.foobar = true
	const result = serialize(array)
	const expected = '{"0":0,"1":1,"2":2,"...":"98 items not stringified"}'
	assert.equal(result, expected)
	const result2 = serialize(array, (_key, value) => value)
	assert.equal(result2, expected)
	const result3 = serialize(array, [0, 1, 2])
	assert.equal(result3, '{"0":0,"1":1,"2":2}')
	const result4 = serialize(array, JSON_NULL, 4)
	assert.equal(
		result4,
		`{
    "0": 0,
    "1": 1,
    "2": 2,
    "...": "98 items not stringified"
}`,
	)
	assert.end()
})

test('show skipped keys even none were serializable', (assert) => {
	const serialize = stringify.configure({
		maximumBreadth: 1,
	})

	const input = { a: Symbol('ignored'), b: Symbol('ignored') }

	const actual1 = serialize(input)
	let expected = '{"...":"1 item not stringified"}'
	assert.equal(actual1, expected)

	const actual2 = serialize(input, (_key, value) => value)
	assert.equal(actual2, expected)

	const actual3 = serialize(input, JSON_NULL, 1)
	expected = '{\n "...": "1 item not stringified"\n}'
	assert.equal(actual3, expected)

	const actual4 = serialize(input, (_key, value) => value, 1)
	assert.equal(actual4, expected)

	const actual5 = serialize(input, ['a'])
	expected = '{}'
	assert.equal(actual5, expected)

	const actual6 = serialize(input, ['a', 'b', 'c'])
	assert.equal(actual6, expected)

	assert.end()
})

test('array replacer entries are unique', (assert) => {
	const input = { 0: 0, b: 1 }

	const replacer = ['b', {}, [], 0, 'b', '0']
	// @ts-expect-error -- The property list deliberately contains unsupported values.
	const actual = stringify(input, replacer)
	// @ts-expect-error -- Native JSON is given the same unsupported property list.
	const expected = JSON.stringify(input, replacer)
	assert.equal(actual, expected)

	assert.end()
})

test('should throw when maximumBreadth receives malformed input', (assert) => {
	assert.throws(() => {
		stringify.configure({
			// @ts-expect-error -- Testing runtime validation.
			maximumBreadth: '3',
		})
	})
	assert.throws(() => {
		stringify.configure({
			maximumBreadth: 3.1,
		})
	})
	assert.throws(() => {
		stringify.configure({
			maximumBreadth: 0,
		})
	})
	assert.end()
})

test('check that all single characters are identical to JSON.stringify', (assert) => {
	for (let i = 0; i < 2 ** 16; i++) {
		const string = String.fromCharCode(i)
		const actual = stringify(string)
		const expected = JSON.stringify(string)
		assert.equal(actual, expected)
	}

	assert.end()
})

test(
	'check for lone surrogate pairs',
	{ skip: Number(process.version.slice(1, 3)) <= 11 },
	(assert) => {
		const edgeChar = String.fromCharCode(0xd7_99)

		for (let charCode = 0xd8_00; charCode < 0xdf_ff; charCode++) {
			const surrogate = String.fromCharCode(charCode)

			assert.equal(stringify(surrogate), String.raw`"\u${charCode.toString(16)}"`)
			assert.equal(
				stringify(`${'a'.repeat(200)}${surrogate}`),
				String.raw`"${'a'.repeat(200)}\u${charCode.toString(16)}"`,
			)
			assert.equal(
				stringify(`${surrogate}${'a'.repeat(200)}`),
				String.raw`"\u${charCode.toString(16)}${'a'.repeat(200)}"`,
			)
			if (charCode < 0xdc_00) {
				const highSurrogate = surrogate
				const lowSurrogate = String.fromCharCode(charCode + 1024)
				assert.notOk(
					(stringify(`${edgeChar}${highSurrogate}${lowSurrogate}${edgeChar}`) ?? '').includes(
						String.raw`\u`,
					),
				)
				assert.equal(
					(
						(stringify(`${highSurrogate}${highSurrogate}${lowSurrogate}`) ?? '').match(
							UNICODE_ESCAPE_PATTERN,
						) ?? []
					).length,
					1,
				)
			} else {
				assert.equal(
					stringify(`${edgeChar}${surrogate}${edgeChar}`),
					String.raw`"${edgeChar}\u${charCode.toString(16)}${edgeChar}"`,
				)
			}
		}

		assert.end()
	},
)

test('strict option possibilities', (assert) => {
	assert.throws(
		() => {
			// @ts-expect-error -- Testing runtime validation.
			stringify.configure({ strict: 1 })
		},
		{
			message: 'The "strict" argument must be of type boolean',
			name: 'TypeError',
		},
	)

	const serializer = stringify.configure({ strict: false })

	serializer(NaN)

	const strictWithoutBigInt = stringify.configure({ bigint: true, strict: true })
	strictWithoutBigInt(5n)

	assert.throws(
		() => {
			strictWithoutBigInt(NaN)
		},
		{
			message: 'Object can not safely be stringified. Received type number (NaN)',
		},
	)

	const strictWithoutCircular = stringify.configure({ circularValue: 'Circular', strict: true })
	strictWithoutBigInt(5n)

	const circular: MutableRecord = {}
	circular.circular = circular
	strictWithoutCircular(circular)

	assert.end()
})

test('strict option simple', (assert) => {
	const strictSerializer = stringify.configure({ strict: true })

	assert.throws(
		() => {
			strictSerializer({ a: NaN })
		},
		{
			message: 'Object can not safely be stringified. Received type number (NaN)',
			name: 'Error',
		},
	)

	assert.throws(
		() => {
			strictSerializer({ a: 5n })
		},
		{
			message: 'Object can not safely be stringified. Received type bigint (5)',
			name: 'Error',
		},
	)

	assert.throws(
		() => {
			strictSerializer({
				a() {
					return true
				},
			})
		},
		{
			message: 'Object can not safely be stringified. Received type function',
			name: 'Error',
		},
	)

	assert.throws(
		() => {
			const circular: MutableRecord = {}
			circular.circular = circular
			strictSerializer(circular)
		},
		{
			message: 'Converting circular structure to JSON',
			name: 'TypeError',
		},
	)

	assert.end()
})

test('strict option indentation', (assert) => {
	const strictSerializer = stringify.configure({ strict: true })

	assert.throws(
		() => {
			strictSerializer({ a: -Infinity }, JSON_NULL, 2)
		},
		{
			message: 'Object can not safely be stringified. Received type number (-Infinity)',
			name: 'Error',
		},
	)

	assert.throws(
		() => {
			strictSerializer({ a: 5n }, JSON_NULL, 2)
		},
		{
			message: 'Object can not safely be stringified. Received type bigint (5)',
			name: 'Error',
		},
	)

	assert.throws(
		() => {
			strictSerializer(
				{
					a() {
						return true
					},
				},
				JSON_NULL,
				2,
			)
		},
		{
			message: 'Object can not safely be stringified. Received type function',
			name: 'Error',
		},
	)

	assert.throws(
		() => {
			const circular: MutableRecord = {}
			circular.circular = circular
			strictSerializer(circular, JSON_NULL, 2)
		},
		{
			message: 'Converting circular structure to JSON',
			name: 'TypeError',
		},
	)

	assert.end()
})

test('strict option replacer function', (assert) => {
	const strictSerializer = stringify.configure({ strict: true })

	assert.throws(
		() => {
			strictSerializer(Symbol('test'), (_key_, value) => value)
		},
		{
			message: 'Object can not safely be stringified. Received type symbol (Symbol(test))',
		},
	)

	assert.throws(
		() => {
			strictSerializer(5n, (_key_, value) => value)
		},
		{
			message: 'Object can not safely be stringified. Received type bigint (5)',
		},
	)

	assert.throws(
		() => {
			strictSerializer(NaN, (_key_, value) => value)
		},
		{
			message: 'Object can not safely be stringified. Received type number (NaN)',
		},
	)

	assert.throws(
		() => {
			const circular: MutableRecord = {}
			circular.circular = circular
			strictSerializer(circular, (_key_, value) => value)
		},
		{
			message: 'Converting circular structure to JSON',
			name: 'TypeError',
		},
	)

	assert.end()
})

test('strict option replacer array', (assert) => {
	assert.throws(
		() => {
			// @ts-expect-error -- Testing runtime validation.
			stringify.configure({ strict: 1 })
		},
		{
			message: 'The "strict" argument must be of type boolean',
			name: 'TypeError',
		},
	)

	const strictSerializer = stringify.configure({ strict: true })

	assert.throws(
		() => {
			strictSerializer(
				{
					a() {
						return true
					},
				},
				['a'],
			)
		},
		{
			message: 'Object can not safely be stringified. Received type function',
		},
	)

	assert.throws(
		() => {
			strictSerializer({ a: 5n }, ['a'])
		},
		{
			message: 'Object can not safely be stringified. Received type bigint (5)',
		},
	)

	assert.throws(
		() => {
			strictSerializer({ a: Infinity }, ['a'])
		},
		{
			message: 'Object can not safely be stringified. Received type number (Infinity)',
		},
	)

	assert.throws(
		() => {
			const circular: MutableRecord = {}
			circular.circular = circular
			strictSerializer(circular, ['circular'])
		},
		{
			message: 'Converting circular structure to JSON',
			name: 'TypeError',
		},
	)

	assert.end()
})

test('deterministic option possibilities', (assert) => {
	assert.throws(
		() => {
			// @ts-expect-error -- Testing runtime validation.
			stringify.configure({ deterministic: 1 })
		},
		{
			message: 'The "deterministic" argument must be of type boolean or comparator function',
			name: 'TypeError',
		},
	)

	const serializer1 = stringify.configure({ deterministic: false })
	serializer1(NaN)

	const serializer2 = stringify.configure({ deterministic: (a, b) => a.localeCompare(b) })
	serializer2(NaN)

	assert.end()
})

test('deterministic default sorting', (assert) => {
	const serializer = stringify.configure({ deterministic: true })

	const object = { a: 1, b: 2, c: 3 }
	const expected = '{\n "a": 1,\n "b": 2,\n "c": 3\n}'
	const actual = serializer(object, JSON_NULL, 1)
	assert.equal(actual, expected)

	assert.end()
})

test('deterministic custom sorting', (assert) => {
	// Descending
	const serializer = stringify.configure({ deterministic: (a, b) => b.localeCompare(a) })

	const object = { a: 1, b: 2, c: 3 }
	const expected = '{\n "c": 3,\n "b": 2,\n "a": 1\n}'
	const actual = serializer(object, JSON_NULL, 1)
	assert.equal(actual, expected)

	assert.end()
})

test('safe option defaults and explicit false', (assert) => {
	const defaultSerializer = stringify.configure({})
	const falseSerializer = stringify.configure({ safe: false })

	assert.equal(defaultSerializer({ a: 1 }), '{"a":1}')
	assert.equal(falseSerializer({ a: 1 }), '{"a":1}')

	assert.end()
})

test('safe option must be boolean', (assert) => {
	// @ts-expect-error Testing runtime validation.
	assert.throws(() => stringify.configure({ safe: 'yes' }), SAFE_PATTERN)
	assert.end()
})

test('safe mode safeguards against failing getters', (assert) => {
	const serializer = stringify.configure({ safe: true })

	const object = {
		a: 1,
		b: 2,
		c: {
			a: true,
			get b() {
				throw new Error('Oops')
			},
		},
	}
	const expected = '{\n "a": 1,\n "b": 2,\n "c": "Error: Stringification failed (Oops)"\n}'
	const actual = serializer(object, JSON_NULL, 1)
	assert.equal(actual, expected)

	assert.end()
})

test('safe mode safeguards against too long string', (assert) => {
	const serializer = stringify.configure({ safe: true })

	const object = {
		a: 1,
		b: 2,
		get c() {
			return 'a'.repeat(maxStringLength + 1)
		},
	}
	const expected = '"Error: Stringification failed (Invalid string length)"'
	const actual = serializer(object, JSON_NULL, 1)
	assert.equal(actual, expected)

	assert.end()
})

test('safe mode safeguards against too long string in nested object still being stringified', (assert) => {
	const serializer = stringify.configure({ safe: true })

	const object = {
		a: 1,
		b: 2,
		get c() {
			return 'a'.repeat(maxStringLength)
		},
	}
	const expected =
		'{\n "a": 1,\n "b": 2,\n "c": "Error: Stringification failed (Invalid string length)"\n}'
	const actual = serializer(object, JSON_NULL, 1)
	assert.equal(actual, expected)

	assert.end()
})

test('safe mode safeguards against failing toJSON method in nested object', (assert) => {
	const serializer = stringify.configure({ safe: true })

	const object = {
		a: 1,
		b: 2,
		c: {
			a: true,
			toJSON() {
				throw 'Oops'
			},
		},
	}
	const expected =
		'{\n "a": 1,\n "b": 2,\n "c": "Error: Stringification failed with toJSON (Oops)"\n}'
	const actual = serializer(object, ['a', 'b', 'c'], 1)
	assert.equal(actual, expected)

	assert.end()
})

test('safe mode safeguards against failing toJSON on root object', (assert) => {
	const serializer = stringify.configure({ safe: true })

	const object = {
		toJSON() {
			throw new Error('Oops')
		},
	}
	const expected = '"Error: Stringification failed with toJSON (Oops)"'
	const actual = serializer(object)
	assert.equal(actual, expected)

	assert.end()
})

test('safe mode safeguards against failing replacer function', (assert) => {
	const serializer = stringify.configure({ safe: true })

	const replacer = (key: string, value: unknown) => {
		if (key === 'b') {
			throw new Error('Oops')
		}

		return value
	}

	const object = { a: 1, b: 2 }
	const expected = '{\n "a": 1,\n "b": "Error: Stringification failed with replacer (Oops)"\n}'
	const actual = serializer(object, replacer, 1)
	assert.equal(actual, expected)

	assert.end()
})

test('safe mode safeguards against failing toJSON method in nested object with replacer function', (assert) => {
	const serializer = stringify.configure({ safe: true })

	const replacer = (_key: string, value: unknown) => value
	const object = {
		a: 1,
		b: 2,
		c: {
			toJSON() {
				throw new Error('Oops')
			},
		},
	}
	const expected =
		'{\n "a": 1,\n "b": 2,\n "c": "Error: Stringification failed with toJSON (Oops)"\n}'
	const actual = serializer(object, replacer, 1)
	assert.equal(actual, expected)

	assert.end()
})

test('safe mode safeguards against failing toJSON and a difficult to stringify error', (assert) => {
	const serializer = stringify.configure({ safe: true })

	const object = {
		a: 1,
		b: 2,
		c: {
			a: true,
			toJSON() {
				throw {
					toString() {
						throw new Error('Yikes')
					},
				}
			},
		},
	}
	const expected =
		'{\n "a": 1,\n "b": 2,\n "c": "Error: Stringification failed with toJSON (Failed)"\n}'
	const actual = serializer(object, JSON_NULL, 1)
	assert.equal(actual, expected)

	assert.end()
})

type ReplacerArgument = Parameters<typeof stringify>[1]

function identityReplacer(_key: string, value: unknown): unknown {
	return value
}

// Combines the default, function, and array replacer modes with and without indentation.
function getModes(keys: string[]) {
	return [undefined, identityReplacer, keys].flatMap((replacer) =>
		[undefined, 2].map((space) => ({ replacer, space })),
	)
}

function nativeStringify(value: unknown, replacer?: ReplacerArgument, space?: number | string) {
	// The native API accepts the same replacer shapes, but its overloads are narrower.
	return JSON.stringify(value, replacer as Parameters<typeof JSON.stringify>[1], space)
}

const escapeRuntimes: unknown[] = [
	undefined,
	JSON_NULL,
	{},
	{ versions: {} },
	{ versions: { node: '21.0.0' } },
	{ versions: { node: '22.0.0' } },
	{ versions: { node: '26.3.1' } },
]

async function importWithProcess(runtime: unknown): Promise<Stringify> {
	vi.resetModules()
	vi.stubGlobal('process', runtime)
	try {
		const freshModule = await import('../src/index.ts')
		return freshModule.stringify
	} finally {
		vi.unstubAllGlobals()
	}
}

function countNativeStringifyCalls(callback: () => unknown): number {
	const spy = vi.spyOn(JSON, 'stringify')
	try {
		callback()
		return spy.mock.calls.length
	} finally {
		spy.mockRestore()
	}
}

// Assertions are delegated to the compatibility adapter.
// eslint-disable-next-line test/expect-expect
vitestTest(
	'escaping preserves output across runtime and string length boundaries',
	async () => {
		for (const runtime of escapeRuntimes) {
			const serializer = await importWithProcess(runtime)
			const nodeVersion = (runtime as undefined | { versions?: { node?: string } })?.versions?.node
			const threshold = Number(nodeVersion?.split('.', 1)[0]) >= 22 ? 128 : 5000
			for (const length of [0, 31, 32, 127, 128, 4999, 5000]) {
				const value = 'x'.repeat(length)
				// Native escaping follows the runtime threshold.
				assertions.equal(
					countNativeStringifyCalls(() => serializer(value)),
					length >= threshold ? 1 : 0,
				)
				assertions.equal(serializer(value), JSON.stringify(value))

				for (const ending of [
					'',
					'"',
					'\\',
					'\n',
					'\u{D800}',
					'\u{DFFF}',
					'\u{1F600}',
					'\u{100}',
				]) {
					const text = 'x'.repeat(Math.max(0, length - ending.length)) + ending
					const cases = [text, [text], { [text]: text }].flatMap((input) =>
						[JSON_NULL, identityReplacer, [text]].map((replacer) => ({ input, replacer })),
					)
					for (const { input, replacer } of cases) {
						assertions.equal(serializer(input, replacer), nativeStringify(input, replacer))
						assertions.equal(serializer(input, replacer, 2), nativeStringify(input, replacer, 2))
					}
				}
			}
		}
	},
	60_000,
)

for (const name of ['Float16Array', 'Float32Array', 'Float64Array']) {
	type FloatArrayConstructor = { from: (values: number[]) => ArrayLike<number> }
	const floatArray = (globalThis as Record<string, unknown>)[name] as
		FloatArrayConstructor | undefined
	test(`${name} serializes non-finite values`, { skip: floatArray === undefined }, (assert) => {
		const typedArray = floatArray!
		const strict = stringify.configure({ strict: true })
		for (const space of [undefined, 2]) {
			for (const number of [NaN, Infinity, -Infinity]) {
				for (const values of [
					[number, 1],
					[1, number],
				]) {
					const value = { metrics: typedArray.from(values) }
					assert.equal(stringify(value, JSON_NULL, space), JSON.stringify(value, JSON_NULL, space))
					assert.throws(() => strict(value, JSON_NULL, space), {
						message: `Object can not safely be stringified. Received type number (${number})`,
					})
				}
			}

			const finite = typedArray.from([-0, 1.5, -2])
			assert.equal(strict(finite, JSON_NULL, space), JSON.stringify(finite, JSON_NULL, space))
			const empty = typedArray.from([])
			assert.equal(strict(empty, JSON_NULL, space), JSON.stringify(empty, JSON_NULL, space))
			const limited = stringify.configure({ maximumBreadth: 1, strict: true })
			assert.equal(
				limited(typedArray.from([1, NaN]), JSON_NULL, space),
				JSON.stringify({ 0: 1, '...': '1 item not stringified' }, JSON_NULL, space),
			)
		}

		assert.end()
	})
}

test('floating typed arrays retain their intrinsic type', (assert) => {
	class FloatSubclass extends Float32Array {}
	const foreign = runInNewContext('new Float64Array([1, Infinity])') as Float64Array
	const subclass = new FloatSubclass([1, -Infinity])
	const disguised = new Float32Array([1, NaN])
	Object.defineProperties(disguised, {
		constructor: { value: Int32Array },
		[Symbol.toStringTag]: { value: 'Int32Array' },
	})
	for (const value of [foreign, subclass, disguised]) {
		for (const space of [undefined, 2]) {
			assert.equal(stringify(value, JSON_NULL, space), JSON.stringify(value, JSON_NULL, space))
		}
	}

	assert.end()
})

test('integer and bigint typed arrays retain their formatting', (assert) => {
	const integerArrays: Array<{ from: (values: number[]) => ArrayLike<number> }> = [
		Int8Array,
		Uint8Array,
		Uint8ClampedArray,
		Int16Array,
		Uint16Array,
		Int32Array,
		Uint32Array,
	]
	for (const integerArray of integerArrays) {
		const value = integerArray.from([0, 1, 2])
		for (const space of [undefined, 2]) {
			assert.equal(stringify(value, JSON_NULL, space), JSON.stringify(value, JSON_NULL, space))
		}
	}

	const bigintArrays: Array<{ from: (values: bigint[]) => ArrayLike<bigint> }> = [
		BigInt64Array,
		BigUint64Array,
	]
	for (const bigintArray of bigintArrays) {
		const value = bigintArray.from([0n, 1n, 2n])
		for (const bigint of [true, 'string'] as const) {
			const serialize = stringify.configure({ bigint })
			const expected = bigint === 'string' ? { 0: '0', 1: '1', 2: '2' } : { 0: 0, 1: 1, 2: 2 }
			for (const space of [undefined, 2]) {
				assert.equal(serialize(value, JSON_NULL, space), JSON.stringify(expected, JSON_NULL, space))
			}
		}
	}

	assert.end()
})

function assertCircularOutput(
	assert: TestAssertions,
	serializer: ReturnType<typeof stringify.configure>,
	value: unknown,
	expected: unknown,
	keys: string[],
): void {
	for (const replacer of [undefined, identityReplacer, keys]) {
		for (const space of [undefined, 2]) {
			assert.equal(serializer(value, replacer, space), JSON.stringify(expected, JSON_NULL, space))
		}
	}
}

test('circular markers report ancestor depth in every serialization mode', (assert) => {
	const array: unknown[] = []
	const child: MutableRecord = { array }
	const root: MutableRecord = { child }
	root.root = root
	child.root = root
	child.self = child
	array.push(root, child, array)

	const expected = {
		child: {
			array: ['[Circular: 0]', '[Circular: 1]', '[Circular: 2]'],
			root: '[Circular: 0]',
			self: '[Circular: 1]',
		},
		root: '[Circular: 0]',
	}
	const arrayRoot: unknown[] = []
	const nestedArray: unknown[] = []
	arrayRoot.push(nestedArray, arrayRoot)
	nestedArray.push(arrayRoot, nestedArray)
	for (const serializer of [
		stringify,
		stringify.configure({ deterministic: false }),
		stringify.configure({ safe: true }),
	]) {
		assertCircularOutput(assert, serializer, root, expected, ['child', 'array', 'root', 'self'])
		assertCircularOutput(
			assert,
			serializer,
			arrayRoot,
			[['[Circular: 0]', '[Circular: 1]'], '[Circular: 0]'],
			[],
		)
	}

	assert.end()
})

test('shared objects use the depth of their current branch', (assert) => {
	const child: MutableRecord = {}
	child.self = child
	const root = { child, nested: { child } }
	const expected = {
		child: { self: '[Circular: 1]' },
		nested: { child: { self: '[Circular: 2]' } },
	}
	assertCircularOutput(assert, stringify, root, expected, ['child', 'nested', 'self'])
	assert.end()
})

test('circular depth takes precedence over maximumDepth', (assert) => {
	const array: unknown[] = []
	const child: MutableRecord = {}
	const root: MutableRecord = { array, child }
	array.push(root, array)
	child.root = root
	child.self = child
	const keys = ['array', 'child', 'root', 'self']
	assertCircularOutput(
		assert,
		stringify.configure({ maximumDepth: 1 }),
		root,
		{ array: '[Array]', child: '[Object]' },
		keys,
	)
	assertCircularOutput(
		assert,
		stringify.configure({ maximumDepth: 2 }),
		root,
		{
			array: ['[Circular: 0]', '[Circular: 1]'],
			child: { root: '[Circular: 0]', self: '[Circular: 1]' },
		},
		keys,
	)
	assert.end()
})

test('toJSON results refer to serialized ancestor depths', (assert) => {
	const root: MutableRecord = {}
	root.child = {
		link: {
			toJSON() {
				return root
			},
		},
	}
	const wrapper = {
		toJSON() {
			return root
		},
	}
	assertCircularOutput(assert, stringify, wrapper, { child: { link: '[Circular: 0]' } }, [
		'child',
		'link',
	])
	assert.end()
})

test('function replacers can create circular references to ancestors', (assert) => {
	function circularReplacer(this: unknown, key: string, value: unknown): unknown {
		return key === 'self' ? this : value
	}

	const root = { child: { self: 0 }, self: 0 }
	const expected = { child: { self: '[Circular: 1]' }, self: '[Circular: 0]' }
	for (const space of [undefined, 2]) {
		assert.equal(
			stringify(root, circularReplacer, space),
			JSON.stringify(expected, JSON_NULL, space),
		)
	}

	assert.end()
})

test('explicit circular values retain their behavior in every mode', (assert) => {
	const array: unknown[] = []
	const child: MutableRecord = {}
	const root: MutableRecord = { array, child }
	array.push(root, array)
	child.root = root
	child.self = child
	root.self = root
	for (const circularValue of ['', '[Circular]', '[Circular: 0]', 'custom', JSON_NULL, undefined]) {
		const expected =
			circularValue === undefined
				? { array: [JSON_NULL, JSON_NULL], child: {} }
				: {
						array: [circularValue, circularValue],
						child: { root: circularValue, self: circularValue },
						self: circularValue,
					}
		assertCircularOutput(assert, stringify.configure({ circularValue }), root, expected, [
			'array',
			'child',
			'root',
			'self',
		])
	}

	for (const circularValue of [Error, TypeError]) {
		const serializer = stringify.configure({ circularValue })
		for (const replacer of [undefined, identityReplacer, ['array', 'self']]) {
			for (const space of [undefined, 2]) {
				assert.throws(() => serializer(root, replacer, space), TypeError)
			}
		}
	}

	assert.end()
})

test('circular depths can have multiple digits', (assert) => {
	const root: MutableRecord = {}
	let child = root
	const expected: MutableRecord = {}
	let expectedChild = expected
	for (let index = 1; index < 12; index++) {
		const next: MutableRecord = {}
		child.next = next
		child = next
		const expectedNext: MutableRecord = {}
		expectedChild.next = expectedNext
		expectedChild = expectedNext
	}

	child.self = child
	expectedChild.self = '[Circular: 11]'
	assertCircularOutput(assert, stringify, root, expected, ['next', 'self'])
	assert.end()
})

test('toJSON receives array keys as string in every mode', (assert) => {
	for (const safe of [false, true]) {
		const serializer = stringify.configure({ safe })
		for (const replacer of [undefined, identityReplacer, ['nested']]) {
			for (const space of [undefined, 2]) {
				const keys: string[] = []
				const array: unknown[] = Array.from({ length: 1001 })
				for (const index of [0, 10, 1000]) {
					array[index] = {
						toJSON(key: string) {
							keys.push(key)
							return index
						},
					}
				}

				array[1] = {
					toJSON(key: string) {
						keys.push(key)
						return {
							nested: [
								{
									toJSON(nestedKey: string) {
										keys.push(nestedKey)
										return JSON_NULL
									},
								},
							],
						}
					},
				}
				const expected: unknown[] = Array.from({ length: 1001 })
				expected[0] = 0
				expected[1] = { nested: [JSON_NULL] }
				expected[10] = 10
				expected[1000] = 1000
				assert.equal(serializer(array, replacer, space), JSON.stringify(expected, JSON_NULL, space))
				assert.same(keys, ['0', '1', '0', '10', '1000'])
			}
		}
	}

	assert.end()
})

test('primitive values preserve their formatting in every mode', (assert) => {
	const values: unknown[] = [
		0,
		-0,
		1.5,
		NaN,
		Infinity,
		-Infinity,
		'',
		'text',
		'\n"\\',
		'\u{D800}',
		JSON_NULL,
		undefined,
		true,
		false,
		Symbol('value'),
		() => 'value',
		{ value: 42 },
	]
	for (const safe of [false, true]) {
		const serializer = stringify.configure({ safe })
		for (const { replacer, space } of getModes(['value'])) {
			for (const value of values) {
				for (const input of [value, [value, value], [value], { value }]) {
					assert.equal(serializer(input, replacer, space), JSON.stringify(input, JSON_NULL, space))
				}

				const wrapped = {
					toJSON() {
						return value
					},
				}
				assert.equal(
					serializer([wrapped, wrapped], replacer, space),
					JSON.stringify([wrapped, wrapped], JSON_NULL, space),
				)
			}

			assert.equal(
				serializer(Array.from({ length: 2 }), replacer, space),
				JSON.stringify([JSON_NULL, JSON_NULL], JSON_NULL, space),
			)
		}
	}

	assert.end()
})

test('primitive escaping failures preserve adjacent elements in every mode', (assert) => {
	const serializer = stringify.configure({ safe: true })
	const value = '\n'
	const native = JSON.stringify.bind(JSON)
	const message = 'Error: Stringification failed (Invalid string length)'
	const results: Array<[string | undefined, string]> = []
	const spy = vi.spyOn(JSON, 'stringify').mockImplementation((input, replacer, space) => {
		if (input === value) {
			throw new RangeError('Invalid string length')
		}

		return native(input, replacer, space)
	})
	try {
		for (const replacer of [undefined, identityReplacer, ['value']]) {
			for (const space of [undefined, 2]) {
				results.push(
					[serializer([value], replacer, space), native([message], JSON_NULL, space)],
					[
						serializer([value, 0, '\t'], replacer, space),
						native([message, 0, '\t'], JSON_NULL, space),
					],
					[
						serializer(['\t', 0, value], replacer, space),
						native(['\t', 0, message], JSON_NULL, space),
					],
				)
			}
		}
	} finally {
		spy.mockRestore()
	}

	for (const [actual, expected] of results) {
		assert.equal(actual, expected)
	}

	assert.end()
})

test('primitive failures and bigint options retain their behavior in every mode', (assert) => {
	const unsupported: Array<[unknown, string]> = [
		[NaN, 'number (NaN)'],
		[Infinity, 'number (Infinity)'],
		[-Infinity, 'number (-Infinity)'],
		[Symbol('value'), 'symbol (Symbol(value))'],
		[() => 'value', 'function'],
	]
	const strict = stringify.configure({ strict: true })
	const safeStrict = stringify.configure({ safe: true, strict: true })
	const safeSerializer = stringify.configure({ safe: true })
	const failing = {
		get value(): unknown {
			throw new Error('Oops')
		},
	}
	const bigintOptions = ([true, false, 'string'] as const).flatMap((bigint) =>
		[false, true].flatMap((safe) =>
			[false, true].map((isStrict) => ({ bigint, safe, strict: isStrict })),
		),
	)
	for (const { replacer, space } of getModes(['value'])) {
		for (const [value, description] of unsupported) {
			assert.throws(() => strict([value, 0], replacer, space), STRICT_FAILURE_PATTERN)
			assert.throws(() => strict([0, value], replacer, space), STRICT_FAILURE_PATTERN)
			const message = `Error: Stringification failed (Object can not safely be stringified. Received type ${description})`
			assert.equal(
				safeStrict([value, 0], replacer, space),
				JSON.stringify([message, 0], JSON_NULL, space),
			)
			assert.equal(
				safeStrict([0, value], replacer, space),
				JSON.stringify([0, message], JSON_NULL, space),
			)
		}

		assert.equal(
			safeStrict([undefined, undefined], replacer, space),
			JSON.stringify([JSON_NULL, JSON_NULL], JSON_NULL, space),
		)
		for (const options of bigintOptions) {
			const serializer = stringify.configure(options)
			if (options.strict && options.bigint === false && !options.safe) {
				assert.throws(() => serializer([1n, 0], replacer, space), STRICT_BIGINT_PATTERN)
				assert.throws(() => serializer([0, 1n], replacer, space), STRICT_BIGINT_PATTERN)
				continue
			}

			const expected =
				options.bigint === 'string'
					? '1'
					: options.bigint
						? 1
						: options.strict
							? 'Error: Stringification failed (Object can not safely be stringified. Received type bigint (1))'
							: JSON_NULL
			assert.equal(
				serializer([1n, 0], replacer, space),
				JSON.stringify([expected, 0], JSON_NULL, space),
			)
			assert.equal(
				serializer([0, 1n], replacer, space),
				JSON.stringify([0, expected], JSON_NULL, space),
			)
		}

		const error = 'Error: Stringification failed (Oops)'
		const expected = typeof replacer === 'function' ? { value: error } : error
		assert.equal(
			safeSerializer([failing, 0], replacer, space),
			JSON.stringify([expected, 0], JSON_NULL, space),
		)
		assert.equal(
			safeSerializer([0, failing], replacer, space),
			JSON.stringify([0, expected], JSON_NULL, space),
		)
	}

	assert.end()
})

test('function replacers run after toJSON and can change each input type', (assert) => {
	for (const space of [undefined, 2]) {
		const calls: string[] = []
		const input = [
			{
				toJSON(key: string) {
					calls.push(`toJSON:${key}`)
					return 1
				},
			},
			{},
			undefined,
		]
		function replacer(this: unknown, key: string, value: unknown): unknown {
			calls.push(`replacer:${key}`)
			if (key === '0') {
				assert.equal(this, input)
				assert.equal(value, 1)
				return { value }
			}

			if (key === '1') {
				return false
			}

			if (key === '2') {
				return 'filled'
			}

			return value
		}

		assert.equal(
			stringify(input, replacer, space),
			JSON.stringify([{ value: 1 }, false, 'filled'], JSON_NULL, space),
		)
		assert.same(calls, [
			'replacer:',
			'toJSON:0',
			'replacer:0',
			'replacer:value',
			'replacer:1',
			'replacer:2',
		])
	}

	assert.end()
})

test('deterministic sorting preserves keys across insertion and native sort boundaries', (assert) => {
	for (const size of [0, 1, 2, 3, 8, 9, 31, 32, 33, 34, 199, 200, 201]) {
		const keys = Array.from(
			{ length: size },
			(_value, index) => `key${String(index).padStart(3, '0')}`,
		)
		const adjacent = [...keys]
		if (size > 1) {
			const first = adjacent[0]!
			adjacent[0] = adjacent[1]!
			adjacent[1] = first
		}

		const rotated = size > 0 ? [keys.at(-1)!, ...keys.slice(0, -1)] : []
		for (const order of [keys, keys.toReversed(), adjacent, rotated]) {
			const value: Record<string, string> = {}
			const expected: Record<string, string> = {}
			for (const key of order) {
				value[key] = key
			}

			for (const key of keys) {
				expected[key] = key
			}

			for (const replacer of [undefined, identityReplacer]) {
				for (const space of [undefined, 2]) {
					assert.equal(
						stringify({ nested: value }, replacer, space),
						JSON.stringify({ nested: expected }, JSON_NULL, space),
					)
				}
			}
		}
	}

	assert.end()
})

test('array replacers are only processed in the object branch', (assert) => {
	const optionSets: StringifyOptions[] = [
		{},
		{ safe: true },
		{ strict: true },
		{ safe: true, strict: true },
		{ bigint: false },
		{ bigint: 'string' },
	]
	for (const options of optionSets) {
		const serialize = stringify.configure(options)
		for (const property of ['0', Symbol.iterator]) {
			let reads = 0
			const replacer = ['value']
			Object.defineProperty(replacer, property, {
				get() {
					reads++
					throw new Error('replacer read')
				},
			})
			for (const value of [
				'value',
				0,
				NaN,
				Infinity,
				true,
				false,
				undefined,
				42n,
				Symbol('value'),
				identityReplacer,
			]) {
				let expected: string | undefined
				try {
					expected = serialize(value)
				} catch (error) {
					assert.throws(() => serialize(value, replacer), { message: (error as Error).message })
					continue
				}

				for (const space of [undefined, 2, '\t']) {
					assert.equal(serialize(value, replacer, space), expected)
				}
			}

			// Primitive roots do not read the array replacer.
			assert.equal(reads, 0)
			for (const value of [JSON_NULL, {}, { value: 1 }, []]) {
				assert.throws(() => serialize(value, replacer), { message: 'replacer read' })
			}

			// The object branch still processes the array replacer.
			assert.equal(reads, 4)
		}

		assert.equal(serialize({ other: 2, value: 1 }, ['value', 'value']), '{"value":1}')
	}

	assert.end()
})
