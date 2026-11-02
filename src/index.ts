/* eslint-disable complexity, perfectionist/sort-switch-case */

type NullValue = Exclude<ReturnType<RegExp['exec']>, RegExpExecArray>
type UnknownFunction = (...args: unknown[]) => unknown
type Comparator = (left: string, right: string) => number
type ReplacerFunction = (this: unknown, key: string, value: unknown) => unknown
type FailFunction = (value: unknown) => never
type CircularError = { toString: () => never }
type SerializedValue = CircularError | string | undefined
type CircularValueFunction = (depth: number) => SerializedValue

/** A property-list or transformation function compatible with `JSON.stringify`. */
export type Replacer = NullValue | ReadonlyArray<number | string> | ReplacerFunction | undefined

/** Configuration for a safe, stable stringify function. */
export type StringifyOptions = {
	/** Serialize bigint values as numbers or strings. Defaults to `true`. */
	bigint?: 'string' | boolean
	/**
	 * Replacement for circular references. Defaults to `[Circular: N]`, where `N`
	 * is the referenced ancestor's depth, starting at 0 for the root. Use `Error`
	 * to throw or `undefined` to omit them. String values must be JSON-escaped.
	 */
	circularValue?: ErrorConstructor | NullValue | string | undefined
	/** Sort object keys, optionally with a custom comparator. Defaults to `true`. */
	deterministic?: boolean | Comparator
	/** Maximum number of entries serialized per array or object. */
	maximumBreadth?: number
	/** Maximum number of nested object and array levels to serialize. */
	maximumDepth?: number
	/** Replace failures from getters, `toJSON`, and replacers with error messages. */
	safe?: boolean
	/** Throw when values cannot be represented safely as JSON. */
	strict?: boolean
}

/** A configured safe, stable stringify function. */
export type Stringify = {
	(
		value: symbol | undefined | UnknownFunction,
		replacer?: Replacer,
		space?: number | string,
	): undefined
	(value: unknown, replacer?: Replacer, space?: number | string): string | undefined
}

type DefaultStringify = Stringify & {
	configure: typeof configure
	default: DefaultStringify
	stringify: DefaultStringify
}

type NumericArray = ArrayLike<bigint | number>

// Escape C0 control characters, double quotes, the backslash, and every code unit in the
// inclusive range 0xD800 to 0xDFFF.
// eslint-disable-next-line no-control-regex
const STRING_ESCAPE_SEQUENCES = /[\u{0}-\u{1F}\u{22}\u{5C}\u{D800}-\u{DFFF}]/v
const JSON_NULL = /a/v.exec('b')
const NATIVE_ESCAPE_LENGTH = getNativeEscapeLength()
// eslint-disable-next-line ts/unbound-method -- Capture the intrinsic getter; its receiver is supplied explicitly below.
const TYPED_ARRAY_TYPE_GETTER = Object.getOwnPropertyDescriptor(
	Object.getPrototypeOf(Int8Array.prototype),
	Symbol.toStringTag,
)!.get as (this: unknown) => string | undefined

function getNativeEscapeLength(): number {
	type RuntimeProcess = NullValue | undefined | { versions?: NullValue | { node?: unknown } }
	// Native escaping is faster for longer strings on Node.js 22 and later. Browsers and other
	// runtimes without a Node.js version keep the previous threshold.
	const runtime = typeof process === 'object' ? (process as RuntimeProcess) : undefined
	const nodeVersion = runtime ? runtime.versions?.node : undefined
	return typeof nodeVersion === 'string' && Number(nodeVersion.split('.', 1)[0]) >= 22 ? 128 : 5000
}

function hasOwn(value: StringifyOptions, key: PropertyKey): boolean {
	return Object.hasOwn(value, key)
}

function stringifyString(value: string): string {
	return value.length < NATIVE_ESCAPE_LENGTH && !STRING_ESCAPE_SEQUENCES.test(value)
		? `"${value}"`
		: JSON.stringify(value)
}

function sortStrings(values: string[], comparator?: Comparator): string[] {
	// Insertion sort is efficient for small inputs but has poor worst-case complexity.
	// The caller always supplies a fresh key array, so in-place sorting avoids an extra allocation.
	if (comparator !== undefined || values.length > 200) {
		// eslint-disable-next-line unicorn/no-array-sort
		return values.sort(comparator)
	}

	let moves = 0
	if (values.length > 1 && values[0]! > values[1]!) {
		const currentValue = values[1]!
		// A descending start that also sorts after the last key indicates unordered input.
		if (values.length > 32 && currentValue > values.at(-1)!) {
			// eslint-disable-next-line unicorn/no-array-sort
			return values.sort()
		}

		values[1] = values[0]!
		values[0] = currentValue
		moves = 1
	}

	for (let index = 2; index < values.length; index++) {
		const currentValue = values[index]!
		if (values[index - 1]! <= currentValue) {
			continue
		}

		let position = index
		do {
			values[position] = values[position - 1]!
			position--
		} while (position !== 0 && values[position - 1]! > currentValue)

		values[position] = currentValue
		moves += index - position
		// Bound the insertion sort work and fall back to the native sort for unordered input.
		if (moves > values.length && moves > 32) {
			// eslint-disable-next-line unicorn/no-array-sort
			return values.sort()
		}
	}

	return values
}

function getTypedArrayType(value: unknown): string | undefined {
	// Read the intrinsic typed array type, ignoring subclasses, own `Symbol.toStringTag`
	// overrides, and realm boundaries. The getter returns `undefined` for a `DataView`.
	const type = TYPED_ARRAY_TYPE_GETTER.call(value)
	// Empty typed arrays are serialized like ordinary empty objects.
	return type === undefined || (value as { length?: number }).length === 0 ? undefined : type
}

function wrapInQuotes(value: unknown): string {
	return `"${String(value)}"`
}

function stringifyFloat(value: number, fail: FailFunction | undefined): string {
	return Number.isFinite(value) ? String(value) : fail ? fail(value) : 'null'
}

function stringifyTypedArray(
	array: NumericArray,
	separator: string,
	maximumBreadth: number,
	bigint: 'string' | boolean,
	fail: FailFunction | undefined,
	type: string,
): string {
	const breadth = Math.min(array.length, maximumBreadth)
	const whitespace = separator === ',' ? '' : ' '

	// Floating-point arrays can contain non-finite values, which JSON represents as `null`.
	if (type.startsWith('Float')) {
		let result = `"0":${whitespace}${stringifyFloat(array[0] as number, fail)}`
		for (let index = 1; index < breadth; index++) {
			result += `${separator}"${index}":${whitespace}${stringifyFloat(array[index] as number, fail)}`
		}

		return result
	}

	const firstValue = array[0]
	const method = bigint === 'string' && typeof firstValue === 'bigint' ? wrapInQuotes : String
	let result = `"0":${whitespace}${method(firstValue)}`

	for (let index = 1; index < breadth; index++) {
		result += `${separator}"${index}":${whitespace}${method(array[index])}`
	}

	return result
}

function getCircularValueOption(options: StringifyOptions): CircularValueFunction {
	if (hasOwn(options, 'circularValue')) {
		const { circularValue } = options
		if (typeof circularValue === 'string') {
			return () => `"${circularValue}"`
		}

		if (circularValue === undefined) {
			return getUndefined
		}

		if (circularValue === JSON_NULL) {
			return () => 'null'
		}

		if (circularValue === Error || circularValue === TypeError) {
			// Upstream throws when the parent serializes this marker. Deferring coercion
			// preserves which containing object or array is replaced in safe mode.
			const circularError: CircularError = {
				toString() {
					throw new TypeError('Converting circular structure to JSON')
				},
			}
			return () => circularError
		}

		throw new TypeError(
			'The "circularValue" argument must be of type string or the value null or undefined',
		)
	}

	return getDefaultCircularValue
}

function getDefaultCircularValue(depth: number): string {
	return `"[Circular: ${depth}]"`
}

function getDeterministicOption(options: StringifyOptions): boolean | Comparator {
	let value: unknown
	if (hasOwn(options, 'deterministic')) {
		value = options.deterministic
		if (typeof value !== 'boolean' && typeof value !== 'function') {
			throw new TypeError(
				'The "deterministic" argument must be of type boolean or comparator function',
			)
		}
	}

	return value === undefined ? true : (value as boolean | Comparator)
}

function getBigIntOption(options: StringifyOptions): 'string' | boolean {
	let value: unknown
	if (hasOwn(options, 'bigint')) {
		value = options.bigint
		if (typeof value === 'string') {
			if (value !== 'string') {
				throw new TypeError('The "bigint" argument must be of type boolean or the string "string"')
			}
		} else if (typeof value !== 'boolean') {
			throw new TypeError('The "bigint" argument must be of type boolean or the string "string"')
		}
	}

	if (value === undefined) {
		return true
	}

	if (typeof value === 'boolean') {
		return value
	}

	if (value === 'string') {
		return value
	}

	throw new TypeError('The "bigint" argument must be of type boolean or the string "string"')
}

function getBooleanOption(options: StringifyOptions, key: 'safe', defaultValue: boolean): boolean {
	let value: unknown
	if (hasOwn(options, key)) {
		value = options[key]
		if (typeof value !== 'boolean') {
			throw new TypeError(`The "${key}" argument must be of type boolean`)
		}
	}

	if (value === undefined) {
		return defaultValue
	}

	if (typeof value === 'boolean') {
		return value
	}

	throw new TypeError(`The "${key}" argument must be of type boolean`)
}

function getPositiveIntegerOption(
	options: StringifyOptions,
	key: 'maximumBreadth' | 'maximumDepth',
): number {
	let value: unknown
	if (hasOwn(options, key)) {
		value = options[key]
		if (typeof value !== 'number') {
			throw new TypeError(`The "${key}" argument must be of type number`)
		}

		if (!Number.isInteger(value)) {
			throw new TypeError(`The "${key}" argument must be an integer`)
		}

		if (value < 1) {
			throw new RangeError(`The "${key}" argument must be >= 1`)
		}
	}

	if (value === undefined) {
		return Infinity
	}

	if (typeof value === 'number') {
		return value
	}

	throw new TypeError(`The "${key}" argument must be of type number`)
}

function getItemCount(count: number): string {
	return count === 1 ? '1 item' : `${count} items`
}

function getUniqueReplacerSet(replacerArray: readonly unknown[]): Set<string> {
	const replacerSet = new Set<string>()
	for (const value of replacerArray) {
		if (typeof value === 'string' || typeof value === 'number') {
			replacerSet.add(String(value))
		}
	}

	return replacerSet
}

function getStrictOption(options: StringifyOptions): FailFunction | undefined {
	if (hasOwn(options, 'strict')) {
		const value: unknown = options.strict
		if (typeof value !== 'boolean') {
			throw new TypeError('The "strict" argument must be of type boolean')
		}

		if (value) {
			return (input: unknown): never => {
				let message = `Object can not safely be stringified. Received type ${typeof input}`
				if (typeof input !== 'function') {
					message += ` (${safeErrorMessage(input)})`
				}

				throw new Error(message)
			}
		}
	}

	return undefined
}

function safeErrorMessage(error: unknown): string {
	try {
		return String(error)
	} catch {
		return 'Failed'
	}
}

function getUndefined(): undefined {
	// Intentionally return undefined.
}

// eslint-disable-next-line unicorn/no-unsafe-json-serialization -- Intentionally borrows the native omitted-value result.
const OMITTED_VALUE = JSON.stringify(undefined)

function getErrorMessage(error: unknown, name?: string): string {
	const errorWithMessage = error as NullValue | undefined | { message?: unknown }
	const message =
		typeof errorWithMessage?.message === 'string'
			? errorWithMessage.message
			: safeErrorMessage(error)

	return name === undefined || name === ''
		? `Error: Stringification failed (${message})`
		: `Error: Stringification failed with ${name} (${message})`
}

function callSafe(method: UnknownFunction, thisArgument: unknown, input: unknown): unknown {
	try {
		return method.call(thisArgument, input)
	} catch (error) {
		return getErrorMessage(error, method.name)
	}
}

function makeSafe<T extends (...args: never[]) => unknown>(method: T, name?: string): T {
	const safeMethod = (...input: Parameters<T>): unknown => {
		try {
			// Upstream invokes safe replacers without a receiver.
			return method(...input)
		} catch (error) {
			return name === undefined ? `"${getErrorMessage(error, name)}"` : getErrorMessage(error, name)
		}
	}

	Object.defineProperty(safeMethod, 'name', { value: `safe_${method.name}` })

	// The wrapper retains the exact parameter and return types of the serializer it protects.
	return safeMethod as T
}

/**
 * Create a safe, stable stringify function with the supplied options.
 */
export function configure(options?: StringifyOptions): Stringify {
	type ToJson = { toJSON: (key: string) => unknown }
	type FunctionReplacerSerializer = (
		key: string,
		parent: unknown,
		stack: unknown[],
		replacer: ReplacerFunction,
		spacer: string,
		indentation: string,
	) => SerializedValue
	// Object serializers receive values whose type is `object`, including `null`.
	type ArrayReplacerSerializer = (
		key: number | string,
		value: unknown,
		stack: unknown[],
		replacer: Set<string>,
		spacer: string,
		indentation: string,
	) => SerializedValue
	type IndentedSerializer = (
		key: number | string,
		value: unknown,
		stack: unknown[],
		spacer: string,
		indentation: string,
	) => SerializedValue
	type ObjectSerializer = (
		key: number | string,
		value: unknown,
		stack: unknown[],
	) => SerializedValue
	type PrimitiveSerializer = (value: unknown) => string | undefined
	const normalizedOptions = { ...options }
	const fail = getStrictOption(normalizedOptions)
	if (fail) {
		// eslint-disable-next-line ts/prefer-nullish-coalescing -- Upstream rejects null rather than applying the strict-mode default.
		if (normalizedOptions.bigint === undefined) {
			normalizedOptions.bigint = false
		}

		if (!('circularValue' in normalizedOptions)) {
			normalizedOptions.circularValue = Error
		}
	}

	const getCircularValue = getCircularValueOption(normalizedOptions)
	const bigint = getBigIntOption(normalizedOptions)
	const deterministic = getDeterministicOption(normalizedOptions)
	const comparator = typeof deterministic === 'function' ? deterministic : undefined
	const maximumDepth = getPositiveIntegerOption(normalizedOptions, 'maximumDepth')
	const maximumBreadth = getPositiveIntegerOption(normalizedOptions, 'maximumBreadth')
	const isSafe = getBooleanOption(normalizedOptions, 'safe', false)

	// Calls `toJSON` with the string key required by the native JSON API. Array indexes are
	// passed as numbers and only converted to strings when a `toJSON` method needs them.
	const callToJson = (value: ToJson, key: number | string): unknown => {
		const jsonKey = typeof key === 'number' ? String(key) : key
		return isSafe
			? callSafe(value.toJSON as UnknownFunction, value, jsonKey)
			: value.toJSON(jsonKey)
	}

	let stringifyPrimitive: PrimitiveSerializer = (value) => {
		switch (typeof value) {
			case 'string': {
				return stringifyString(value)
			}

			case 'number': {
				return Number.isFinite(value) ? String(value) : fail ? fail(value) : 'null'
			}

			case 'boolean': {
				return value ? 'true' : 'false'
			}

			case 'undefined': {
				return OMITTED_VALUE
			}

			case 'bigint': {
				if (bigint !== false) {
					return bigint === 'string' ? `"${String(value)}"` : String(value)
				}

				return fail ? fail(value) : undefined
			}

			case 'object': {
				// Objects are dispatched to the object serializers before reaching this point.
				return value === null ? 'null' : OMITTED_VALUE
			}

			case 'function':
			case 'symbol': {
				return fail ? fail(value) : undefined
			}
		}
	}

	// The function replacer serializer is protected as a whole, so its primitives skip the
	// additional safe wrapper.
	const stringifyFunctionReplacerPrimitive = stringifyPrimitive

	let stringifyFunctionReplacer: FunctionReplacerSerializer = (
		key,
		parent,
		stack,
		replacer,
		spacer,
		indentation,
	) => {
		let value = (parent as Record<string, unknown>)[key]

		if (
			typeof value === 'object' &&
			value &&
			typeof (value as { toJSON?: unknown }).toJSON === 'function'
		) {
			value = callToJson(value as ToJson, key)
		}

		value = replacer.call(parent, key, value)

		if (typeof value !== 'object') {
			return stringifyFunctionReplacerPrimitive(value)
		}

		if (value === null) {
			return 'null'
		}

		const circularIndex = stack.indexOf(value)
		if (circularIndex !== -1) {
			return getCircularValue(circularIndex)
		}

		let result = ''
		let join = ','
		const originalIndentation = indentation

		if (Array.isArray(value)) {
			if (value.length === 0) {
				return '[]'
			}

			if (maximumDepth < stack.length + 1) {
				return '"[Array]"'
			}

			stack.push(value)
			if (spacer !== '') {
				indentation += spacer
				result += `\n${indentation}`
				join = `,\n${indentation}`
			}

			const maximumValuesToStringify = Math.min(value.length, maximumBreadth)
			let index = 0
			for (; index < maximumValuesToStringify - 1; index++) {
				const temporary = stringifyFunctionReplacer(
					String(index),
					value,
					stack,
					replacer,
					spacer,
					indentation,
				)
				result += String(temporary ?? 'null')
				result += join
			}

			const temporary = stringifyFunctionReplacer(
				String(index),
				value,
				stack,
				replacer,
				spacer,
				indentation,
			)
			result += String(temporary ?? 'null')
			if (value.length > maximumBreadth) {
				const removedKeys = value.length - maximumBreadth
				result += `${join}"... ${getItemCount(removedKeys)} not stringified"`
			}

			if (spacer !== '') {
				result += `\n${originalIndentation}`
			}

			stack.pop()
			return `[${result}]`
		}

		let keys = Object.keys(value)
		const keyLength = keys.length
		if (keyLength === 0) {
			return '{}'
		}

		if (maximumDepth < stack.length + 1) {
			return '"[Object]"'
		}

		let whitespace = ''
		let separator = ''
		if (spacer !== '') {
			indentation += spacer
			join = `,\n${indentation}`
			whitespace = ' '
		}

		const maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth)
		if (deterministic !== false && getTypedArrayType(value) === undefined) {
			keys = sortStrings(keys, comparator)
		}

		stack.push(value)
		for (let index = 0; index < maximumPropertiesToStringify; index++) {
			const objectKey = keys[index]!
			const temporary = stringifyFunctionReplacer(
				objectKey,
				value,
				stack,
				replacer,
				spacer,
				indentation,
			)
			if (temporary === undefined) {
				continue
			}

			result += `${separator}${stringifyString(objectKey)}:${whitespace}${String(temporary)}`
			separator = join
		}

		if (keyLength > maximumBreadth) {
			const removedKeys = keyLength - maximumBreadth
			result += `${separator}"...":${whitespace}"${getItemCount(removedKeys)} not stringified"`
			separator = join
		}

		if (spacer !== '' && separator.length > 1) {
			result = `\n${indentation}${result}\n${originalIndentation}`
		}

		stack.pop()
		return `{${result}}`
	}

	let stringifyArrayReplacer: ArrayReplacerSerializer = (
		key,
		value,
		stack,
		replacer,
		spacer,
		indentation,
	) => {
		if (value === null) {
			return 'null'
		}

		if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
			const jsonValue = callToJson(value as ToJson, key)
			if (typeof jsonValue !== 'object') {
				return stringifyPrimitive(jsonValue)
			}

			if (jsonValue === null) {
				return 'null'
			}

			value = jsonValue
		}

		const circularIndex = stack.indexOf(value)
		if (circularIndex !== -1) {
			return getCircularValue(circularIndex)
		}

		const originalIndentation = indentation
		let result = ''
		let join = ','

		if (Array.isArray(value)) {
			if (value.length === 0) {
				return '[]'
			}

			if (maximumDepth < stack.length + 1) {
				return '"[Array]"'
			}

			stack.push(value)
			if (spacer !== '') {
				indentation += spacer
				result += `\n${indentation}`
				join = `,\n${indentation}`
			}

			const maximumValuesToStringify = Math.min(value.length, maximumBreadth)
			let index = 0
			for (; index < maximumValuesToStringify - 1; index++) {
				const item: unknown = value[index]
				const temporary =
					typeof item === 'object'
						? stringifyArrayReplacer(index, item, stack, replacer, spacer, indentation)
						: stringifyPrimitive(item)
				result += String(temporary ?? 'null')
				result += join
			}

			const item: unknown = value[index]
			const temporary =
				typeof item === 'object'
					? stringifyArrayReplacer(index, item, stack, replacer, spacer, indentation)
					: stringifyPrimitive(item)
			result += String(temporary ?? 'null')
			if (value.length > maximumBreadth) {
				const removedKeys = value.length - maximumBreadth
				result += `${join}"... ${getItemCount(removedKeys)} not stringified"`
			}

			if (spacer !== '') {
				result += `\n${originalIndentation}`
			}

			stack.pop()
			return `[${result}]`
		}

		if (maximumDepth < stack.length + 1) {
			return '"[Object]"'
		}

		stack.push(value)
		let whitespace = ''
		if (spacer !== '') {
			indentation += spacer
			join = `,\n${indentation}`
			whitespace = ' '
		}

		let separator = ''
		for (const objectKey of replacer) {
			const item = (value as Record<string, unknown>)[objectKey]
			const temporary =
				typeof item === 'object'
					? stringifyArrayReplacer(objectKey, item, stack, replacer, spacer, indentation)
					: stringifyPrimitive(item)
			if (temporary === undefined) {
				continue
			}

			result += `${separator}${stringifyString(objectKey)}:${whitespace}${String(temporary)}`
			separator = join
		}

		if (spacer !== '' && separator.length > 1) {
			result = `\n${indentation}${result}\n${originalIndentation}`
		}

		stack.pop()
		return `{${result}}`
	}

	let stringifyIndent: IndentedSerializer = (key, value, stack, spacer, indentation) => {
		if (value === null) {
			return 'null'
		}

		if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
			const jsonValue = callToJson(value as ToJson, key)
			// Prevent calling `toJSON` again.
			if (typeof jsonValue !== 'object') {
				return stringifyPrimitive(jsonValue)
			}

			if (jsonValue === null) {
				return 'null'
			}

			value = jsonValue
		}

		const circularIndex = stack.indexOf(value)
		if (circularIndex !== -1) {
			return getCircularValue(circularIndex)
		}

		const originalIndentation = indentation

		if (Array.isArray(value)) {
			if (value.length === 0) {
				return '[]'
			}

			if (maximumDepth < stack.length + 1) {
				return '"[Array]"'
			}

			stack.push(value)
			indentation += spacer
			let result = `\n${indentation}`
			const join = `,\n${indentation}`
			const maximumValuesToStringify = Math.min(value.length, maximumBreadth)
			let index = 0
			for (; index < maximumValuesToStringify - 1; index++) {
				const item: unknown = value[index]
				const temporary =
					typeof item === 'object'
						? stringifyIndent(index, item, stack, spacer, indentation)
						: stringifyPrimitive(item)
				result += String(temporary ?? 'null')
				result += join
			}

			const item: unknown = value[index]
			const temporary =
				typeof item === 'object'
					? stringifyIndent(index, item, stack, spacer, indentation)
					: stringifyPrimitive(item)
			result += String(temporary ?? 'null')
			if (value.length > maximumBreadth) {
				const removedKeys = value.length - maximumBreadth
				result += `${join}"... ${getItemCount(removedKeys)} not stringified"`
			}

			result += `\n${originalIndentation}`
			stack.pop()
			return `[${result}]`
		}

		let keys = Object.keys(value as Record<string, unknown>)
		const keyLength = keys.length
		if (keyLength === 0) {
			return '{}'
		}

		if (maximumDepth < stack.length + 1) {
			return '"[Object]"'
		}

		indentation += spacer
		const join = `,\n${indentation}`
		let result = ''
		let separator = ''
		let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth)
		const typedArrayType = getTypedArrayType(value)
		if (typedArrayType !== undefined) {
			const typedArray = value as NumericArray
			result += stringifyTypedArray(typedArray, join, maximumBreadth, bigint, fail, typedArrayType)
			keys = keys.slice(typedArray.length)
			maximumPropertiesToStringify -= typedArray.length
			separator = join
		}

		if (deterministic !== false) {
			keys = sortStrings(keys, comparator)
		}

		stack.push(value)
		for (let index = 0; index < maximumPropertiesToStringify; index++) {
			const objectKey = keys[index]!
			const item = (value as Record<string, unknown>)[objectKey]
			const temporary =
				typeof item === 'object'
					? stringifyIndent(objectKey, item, stack, spacer, indentation)
					: stringifyPrimitive(item)
			if (temporary === undefined) {
				continue
			}

			result += `${separator}${stringifyString(objectKey)}: ${String(temporary)}`
			separator = join
		}

		if (keyLength > maximumBreadth) {
			const removedKeys = keyLength - maximumBreadth
			result += `${separator}"...": "${getItemCount(removedKeys)} not stringified"`
			separator = join
		}

		if (separator !== '') {
			result = `\n${indentation}${result}\n${originalIndentation}`
		}

		stack.pop()
		return `{${result}}`
	}

	let stringifyObject: ObjectSerializer = (key, value, stack) => {
		if (value === null) {
			return 'null'
		}

		if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
			const jsonValue = callToJson(value as ToJson, key)
			// Prevent calling `toJSON` again.
			if (typeof jsonValue !== 'object') {
				return stringifyPrimitive(jsonValue)
			}

			if (jsonValue === null) {
				return 'null'
			}

			value = jsonValue
		}

		const circularIndex = stack.indexOf(value)
		if (circularIndex !== -1) {
			return getCircularValue(circularIndex)
		}

		let result = ''
		const hasLength = (value as { length?: unknown }).length !== undefined
		if (hasLength && Array.isArray(value)) {
			if (value.length === 0) {
				return '[]'
			}

			if (maximumDepth < stack.length + 1) {
				return '"[Array]"'
			}

			stack.push(value)
			const maximumValuesToStringify = Math.min(value.length, maximumBreadth)
			let index = 0
			for (; index < maximumValuesToStringify - 1; index++) {
				const item: unknown = value[index]
				const temporary =
					typeof item === 'object' ? stringifyObject(index, item, stack) : stringifyPrimitive(item)
				result += String(temporary ?? 'null')
				result += ','
			}

			const item: unknown = value[index]
			const temporary =
				typeof item === 'object' ? stringifyObject(index, item, stack) : stringifyPrimitive(item)
			result += String(temporary ?? 'null')
			if (value.length > maximumBreadth) {
				const removedKeys = value.length - maximumBreadth
				result += `,"... ${getItemCount(removedKeys)} not stringified"`
			}

			stack.pop()
			return `[${result}]`
		}

		let keys = Object.keys(value as Record<string, unknown>)
		const keyLength = keys.length
		if (keyLength === 0) {
			return '{}'
		}

		if (maximumDepth < stack.length + 1) {
			return '"[Object]"'
		}

		let separator = ''
		let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth)
		const typedArrayType = hasLength ? getTypedArrayType(value) : undefined
		if (typedArrayType !== undefined) {
			const typedArray = value as NumericArray
			result += stringifyTypedArray(typedArray, ',', maximumBreadth, bigint, fail, typedArrayType)
			keys = keys.slice(typedArray.length)
			maximumPropertiesToStringify -= typedArray.length
			separator = ','
		}

		if (deterministic !== false) {
			keys = sortStrings(keys, comparator)
		}

		stack.push(value)
		for (let index = 0; index < maximumPropertiesToStringify; index++) {
			const objectKey = keys[index]!
			const item = (value as Record<string, unknown>)[objectKey]
			const temporary =
				typeof item === 'object'
					? stringifyObject(objectKey, item, stack)
					: stringifyPrimitive(item)
			if (temporary === undefined) {
				continue
			}

			result += `${separator}${stringifyString(objectKey)}:${String(temporary)}`
			separator = ','
		}

		if (keyLength > maximumBreadth) {
			const removedKeys = keyLength - maximumBreadth
			result += `${separator}"...":"${getItemCount(removedKeys)} not stringified"`
		}

		stack.pop()
		return `{${result}}`
	}

	if (isSafe) {
		stringifyFunctionReplacer = makeSafe(stringifyFunctionReplacer)
		stringifyArrayReplacer = makeSafe(stringifyArrayReplacer)
		stringifyIndent = makeSafe(stringifyIndent)
		stringifyObject = makeSafe(stringifyObject)
		stringifyPrimitive = makeSafe(stringifyPrimitive)
	}

	function stringify(
		value: unknown,
		replacer?: Replacer,
		space?: number | string,
	): SerializedValue {
		if (arguments.length > 1) {
			let spacer = ''
			if (typeof space === 'number') {
				// Negative widths produce no indentation, matching `JSON.stringify`.
				spacer = ' '.repeat(Math.max(0, Math.min(space, 10)))
			} else if (typeof space === 'string') {
				spacer = space.slice(0, 10)
			}

			if (typeof replacer === 'function') {
				const activeReplacer = isSafe ? makeSafe(replacer, replacer.name) : replacer
				return stringifyFunctionReplacer('', { '': value }, [], activeReplacer, spacer, '')
			}

			if (Array.isArray(replacer)) {
				// Primitive roots never read the array replacer.
				return typeof value === 'object'
					? stringifyArrayReplacer('', value, [], getUniqueReplacerSet(replacer), spacer, '')
					: stringifyPrimitive(value)
			}

			if (spacer.length > 0) {
				return typeof value === 'object'
					? stringifyIndent('', value, [], spacer, '')
					: stringifyPrimitive(value)
			}
		}

		return typeof value === 'object' ? stringifyObject('', value, []) : stringifyPrimitive(value)
	}

	// The implementation fulfills the overloads exposed by `Stringify`.

	return stringify as Stringify
}

const stringify = configure() as DefaultStringify
stringify.configure = configure
stringify.stringify = stringify
stringify.default = stringify

export { stringify }
export default stringify
