/* eslint-disable complexity, perfectionist/sort-switch-case */

type NullValue = Exclude<ReturnType<RegExp['exec']>, RegExpExecArray>
type UnknownFunction = (...args: unknown[]) => unknown
type Comparator = (left: string, right: string) => number
type ReplacerFunction = (this: unknown, key: string, value: unknown) => unknown
type Serializer = (
	value: unknown,
	replacer?: Replacer,
	space?: number | string,
) => string | undefined
type RecursiveSerializer = (key: string, value: unknown, stack: unknown[]) => string | undefined
type IndentedSerializer = (
	key: string,
	value: unknown,
	stack: unknown[],
	spacer: string,
	indentation: string,
) => string | undefined
type ArrayReplacerSerializer = (
	key: string,
	value: unknown,
	stack: unknown[],
	replacer: Set<string>,
	spacer: string,
	indentation: string,
) => string | undefined
type FunctionReplacerSerializer = (
	key: string,
	parent: unknown,
	stack: unknown[],
	replacer: ReplacerFunction,
	spacer: string,
	indentation: string,
) => string | undefined
type FailFunction = (value: unknown) => never
type CircularValueFunction = () => string | undefined

/** A property-list or transformation function compatible with `JSON.stringify`. */
export type Replacer = NullValue | ReadonlyArray<number | string> | ReplacerFunction | undefined

/** Configuration for a safe, stable stringify function. */
export type StringifyOptions = {
	/** Serialize bigint values as numbers or strings. Defaults to `true`. */
	bigint?: 'string' | boolean
	/**
	 * Replacement for circular references. Use `Error` to throw or `undefined` to
	 * omit them.
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
	stringify: Stringify
}

// Escape C0 control characters, double quotes, the backslash, and every code unit in the
// inclusive range 0xD800 to 0xDFFF.
// eslint-disable-next-line no-control-regex
const STRING_ESCAPE_SEQUENCES = /[\u{0}-\u{1F}\u{22}\u{5C}\u{D800}-\u{DFFF}]/v
const JSON_NULL = /a/v.exec('b')

function getProperty(value: unknown, key: PropertyKey): unknown {
	// The serializer intentionally reads arbitrary user-provided values.
	return (value as Record<PropertyKey, unknown>)[key]
}

function hasOwn(value: StringifyOptions, key: PropertyKey): boolean {
	return Object.hasOwn(value, key)
}

function getLength(value: unknown): number | undefined {
	const length = getProperty(value, 'length')
	return typeof length === 'number' ? length : undefined
}

function stringifyString(value: string): string {
	// These thresholds performed well in benchmarks against V8 8.0 and remain cheaper than
	// calling the native serializer for the common case.
	return value.length < 5000 && !STRING_ESCAPE_SEQUENCES.test(value)
		? `"${value}"`
		: JSON.stringify(value)
}

function sortStrings(values: string[], comparator?: Comparator): string[] {
	// Insertion sort is efficient for small inputs but has poor worst-case complexity.
	if (comparator !== undefined || values.length > 200) {
		// The caller always supplies a fresh key array, so in-place sorting avoids an extra allocation.
		// eslint-disable-next-line unicorn/no-array-sort
		return values.sort(comparator)
	}

	for (let index = 1; index < values.length; index++) {
		const currentValue = values[index]!
		let position = index
		while (position !== 0 && values[position - 1]! > currentValue) {
			values[position] = values[position - 1]!
			position--
		}

		values[position] = currentValue
	}

	return values
}

function isTypedArrayWithEntries(value: unknown): boolean {
	return ArrayBuffer.isView(value) && !(value instanceof DataView) && (getLength(value) ?? 0) > 0
}

function wrapInQuotes(value: unknown): string {
	return `"${String(value)}"`
}

function stringifyTypedArray(
	array: unknown,
	separator: string,
	maximumBreadth: number,
	bigint: 'string' | boolean,
): string {
	const length = getLength(array) ?? 0
	const breadth = Math.min(length, maximumBreadth)
	const firstValue = getProperty(array, 0)
	const method =
		bigint === 'string' && typeof firstValue === 'bigint' && length > 0 ? wrapInQuotes : String
	const whitespace = separator === ',' ? '' : ' '
	let result = `"0":${whitespace}${method(firstValue)}`

	for (let index = 1; index < breadth; index++) {
		result += `${separator}"${index}":${whitespace}${method(getProperty(array, index))}`
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
			return () => {
				throw new TypeError('Converting circular structure to JSON')
			}
		}

		throw new TypeError(
			'The "circularValue" argument must be of type string or the value null or undefined',
		)
	}

	return getDefaultCircularValue
}

function getDefaultCircularValue(): string {
	return '"[Circular]"'
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
	let rawMessage: unknown
	try {
		rawMessage = typeof error === 'object' && error ? getProperty(error, 'message') : undefined
	} catch {
		rawMessage = undefined
	}

	const message = typeof rawMessage === 'string' ? rawMessage : safeErrorMessage(error)

	return name !== undefined && name !== ''
		? `Error: Stringification failed with ${name} (${message})`
		: `Error: Stringification failed (${message})`
}

function callSafe(method: UnknownFunction, thisArgument: unknown, input: unknown): unknown {
	try {
		return method.call(thisArgument, input)
	} catch (error) {
		return getErrorMessage(error, method.name)
	}
}

function makeSafeReplacer(method: ReplacerFunction): ReplacerFunction {
	return function (key, value): unknown {
		try {
			// The replacer must receive the same parent object as the native JSON API.
			// eslint-disable-next-line unicorn/no-this-outside-of-class
			return method.call(this, key, value)
		} catch (error) {
			return getErrorMessage(error, method.name)
		}
	}
}

function makeSafeSerializer<T extends (...args: never[]) => string | undefined>(method: T): T {
	const safeMethod = (...input: Parameters<T>): string | undefined => {
		try {
			return method(...input)
		} catch (error) {
			return `"${getErrorMessage(error)}"`
		}
	}

	Object.defineProperty(safeMethod, 'name', { value: `safe_${method.name}` })

	// The wrapper retains the exact parameter and return types of the serializer it protects.
	return safeMethod as T
}

/**
 * Create a safe, stable stringify function with the supplied options.
 */
export function configure(options: StringifyOptions = {}): Stringify {
	const normalizedOptions = { ...options }
	const fail = getStrictOption(normalizedOptions)
	if (fail) {
		normalizedOptions.bigint ??= false

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

	let stringifyFunctionReplacer: FunctionReplacerSerializer = (
		key,
		parent,
		stack,
		replacer,
		spacer,
		indentation,
	) => {
		let value = (parent as Record<string, unknown>)[key]

		if (typeof value === 'object' && value) {
			const toJson = (value as { toJSON?: unknown }).toJSON
			if (typeof toJson === 'function') {
				value = isSafe
					? callSafe(toJson as UnknownFunction, value, key)
					: (toJson as UnknownFunction).call(value, key)
			}
		}

		value = replacer.call(parent, key, value)

		switch (typeof value) {
			case 'bigint': {
				if (bigint !== false) {
					return bigint === 'string' ? `"${String(value)}"` : String(value)
				}

				return fail ? fail(value) : undefined
			}

			case 'boolean': {
				return value ? 'true' : 'false'
			}

			case 'function': {
				return fail ? fail(value) : undefined
			}

			case 'number': {
				return Number.isFinite(value) ? String(value) : fail ? fail(value) : 'null'
			}

			case 'object': {
				if (!value) {
					return 'null'
				}

				if (stack.includes(value)) {
					return getCircularValue()
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
						result += temporary ?? 'null'
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
					result += temporary ?? 'null'
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
				if (deterministic !== false && !isTypedArrayWithEntries(value)) {
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

					result += `${separator}${stringifyString(objectKey)}:${whitespace}${temporary}`
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

			case 'string': {
				return stringifyString(value)
			}

			case 'symbol': {
				return fail ? fail(value) : undefined
			}

			case 'undefined': {
				return OMITTED_VALUE
			}
		}
	}

	let stringifyArrayReplacer: ArrayReplacerSerializer = (
		key,
		value,
		stack,
		replacer,
		spacer,
		indentation,
	) => {
		if (typeof value === 'object' && value) {
			const toJson = (value as { toJSON?: unknown }).toJSON
			if (typeof toJson === 'function') {
				value = isSafe
					? callSafe(toJson as UnknownFunction, value, key)
					: (toJson as UnknownFunction).call(value, key)
			}
		}

		switch (typeof value) {
			case 'bigint': {
				if (bigint !== false) {
					return bigint === 'string' ? `"${String(value)}"` : String(value)
				}

				return fail ? fail(value) : undefined
			}

			case 'boolean': {
				return value ? 'true' : 'false'
			}

			case 'function': {
				return fail ? fail(value) : undefined
			}

			case 'number': {
				return Number.isFinite(value) ? String(value) : fail ? fail(value) : 'null'
			}

			case 'object': {
				if (!value) {
					return 'null'
				}

				if (stack.includes(value)) {
					return getCircularValue()
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
						const temporary = stringifyArrayReplacer(
							String(index),
							value[index],
							stack,
							replacer,
							spacer,
							indentation,
						)
						result += temporary ?? 'null'
						result += join
					}

					const temporary = stringifyArrayReplacer(
						String(index),
						value[index],
						stack,
						replacer,
						spacer,
						indentation,
					)
					result += temporary ?? 'null'
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

				stack.push(value)
				let whitespace = ''
				if (spacer !== '') {
					indentation += spacer
					join = `,\n${indentation}`
					whitespace = ' '
				}

				let separator = ''
				for (const objectKey of replacer) {
					const temporary = stringifyArrayReplacer(
						objectKey,
						(value as Record<string, unknown>)[objectKey],
						stack,
						replacer,
						spacer,
						indentation,
					)
					if (temporary === undefined) {
						continue
					}

					result += `${separator}${stringifyString(objectKey)}:${whitespace}${temporary}`
					separator = join
				}

				if (spacer !== '' && separator.length > 1) {
					result = `\n${indentation}${result}\n${originalIndentation}`
				}

				stack.pop()
				return `{${result}}`
			}

			case 'string': {
				return stringifyString(value)
			}

			case 'symbol': {
				return fail ? fail(value) : undefined
			}

			case 'undefined': {
				return OMITTED_VALUE
			}
		}
	}

	let stringifyIndent: IndentedSerializer = (key, value, stack, spacer, indentation) => {
		switch (typeof value) {
			case 'bigint': {
				if (bigint !== false) {
					return bigint === 'string' ? `"${String(value)}"` : String(value)
				}

				return fail ? fail(value) : undefined
			}

			case 'boolean': {
				return value ? 'true' : 'false'
			}

			case 'function': {
				return fail ? fail(value) : undefined
			}

			case 'number': {
				return Number.isFinite(value) ? String(value) : fail ? fail(value) : 'null'
			}

			case 'object': {
				if (!value) {
					return 'null'
				}

				const toJson = (value as { toJSON?: unknown }).toJSON
				if (typeof toJson === 'function') {
					value = isSafe
						? callSafe(toJson as UnknownFunction, value, key)
						: (toJson as UnknownFunction).call(value, key)
					// Prevent calling `toJSON` again.
					if (typeof value !== 'object') {
						return stringifyIndent(key, value, stack, spacer, indentation)
					}

					if (!value) {
						return 'null'
					}
				}

				if (stack.includes(value)) {
					return getCircularValue()
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
						const temporary = stringifyIndent(
							String(index),
							value[index],
							stack,
							spacer,
							indentation,
						)
						result += temporary ?? 'null'
						result += join
					}

					const temporary = stringifyIndent(String(index), value[index], stack, spacer, indentation)
					result += temporary ?? 'null'
					if (value.length > maximumBreadth) {
						const removedKeys = value.length - maximumBreadth
						result += `${join}"... ${getItemCount(removedKeys)} not stringified"`
					}

					result += `\n${originalIndentation}`
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

				indentation += spacer
				const join = `,\n${indentation}`
				let result = ''
				let separator = ''
				let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth)
				if (isTypedArrayWithEntries(value)) {
					const rawLength = (value as { length?: unknown }).length
					const length = typeof rawLength === 'number' ? rawLength : 0
					result += stringifyTypedArray(value, join, maximumBreadth, bigint)
					keys = keys.slice(length)
					maximumPropertiesToStringify -= length
					separator = join
				}

				if (deterministic !== false) {
					keys = sortStrings(keys, comparator)
				}

				stack.push(value)
				for (let index = 0; index < maximumPropertiesToStringify; index++) {
					const objectKey = keys[index]!
					const temporary = stringifyIndent(
						objectKey,
						(value as Record<string, unknown>)[objectKey],
						stack,
						spacer,
						indentation,
					)
					if (temporary === undefined) {
						continue
					}

					result += `${separator}${stringifyString(objectKey)}: ${temporary}`
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

			case 'string': {
				return stringifyString(value)
			}

			case 'symbol': {
				return fail ? fail(value) : undefined
			}

			case 'undefined': {
				return OMITTED_VALUE
			}
		}
	}

	let stringifySimple: RecursiveSerializer = (key, value, stack) => {
		switch (typeof value) {
			case 'string': {
				return stringifyString(value)
			}

			case 'object': {
				if (value === null) {
					return 'null'
				}

				const toJson = (value as { toJSON?: unknown }).toJSON
				if (typeof toJson === 'function') {
					value = isSafe
						? callSafe(toJson as UnknownFunction, value, key)
						: (toJson as UnknownFunction).call(value, key)
					// Prevent calling `toJSON` again.
					if (typeof value !== 'object') {
						return stringifySimple(key, value, stack)
					}

					if (value === null) {
						return 'null'
					}
				}

				if (stack.includes(value)) {
					return getCircularValue()
				}

				let result = ''
				const rawLength = (value as { length?: unknown }).length
				const length = typeof rawLength === 'number' ? rawLength : undefined
				const hasLength = length !== undefined
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
						const temporary = stringifySimple(String(index), value[index], stack)
						result += temporary ?? 'null'
						result += ','
					}

					const temporary = stringifySimple(String(index), value[index], stack)
					result += temporary ?? 'null'
					if (value.length > maximumBreadth) {
						const removedKeys = value.length - maximumBreadth
						result += `,"... ${getItemCount(removedKeys)} not stringified"`
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

				let separator = ''
				let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth)
				if (hasLength && isTypedArrayWithEntries(value)) {
					result += stringifyTypedArray(value, ',', maximumBreadth, bigint)
					keys = keys.slice(length)
					maximumPropertiesToStringify -= length
					separator = ','
				}

				if (deterministic !== false) {
					keys = sortStrings(keys, comparator)
				}

				stack.push(value)
				for (let index = 0; index < maximumPropertiesToStringify; index++) {
					const objectKey = keys[index]!
					const temporary = stringifySimple(
						objectKey,
						(value as Record<string, unknown>)[objectKey],
						stack,
					)
					if (temporary === undefined) {
						continue
					}

					result += `${separator}${stringifyString(objectKey)}:${temporary}`
					separator = ','
				}

				if (keyLength > maximumBreadth) {
					const removedKeys = keyLength - maximumBreadth
					result += `${separator}"...":"${getItemCount(removedKeys)} not stringified"`
				}

				stack.pop()
				return `{${result}}`
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

			case 'function':
			case 'symbol': {
				return fail ? fail(value) : undefined
			}
		}
	}

	if (isSafe) {
		stringifyFunctionReplacer = makeSafeSerializer(stringifyFunctionReplacer)
		stringifyArrayReplacer = makeSafeSerializer(stringifyArrayReplacer)
		stringifyIndent = makeSafeSerializer(stringifyIndent)
		stringifySimple = makeSafeSerializer(stringifySimple)
	}

	const serializer: Serializer = function (value, replacer, space) {
		if (arguments.length > 1) {
			let spacer = ''
			if (typeof space === 'number') {
				spacer = ' '.repeat(Math.min(space, 10))
			} else if (typeof space === 'string') {
				spacer = space.slice(0, 10)
			}

			if (typeof replacer === 'function') {
				const activeReplacer = isSafe ? makeSafeReplacer(replacer) : replacer
				return stringifyFunctionReplacer('', { '': value }, [], activeReplacer, spacer, '')
			}

			if (Array.isArray(replacer)) {
				return stringifyArrayReplacer('', value, [], getUniqueReplacerSet(replacer), spacer, '')
			}

			if (spacer.length > 0) {
				return stringifyIndent('', value, [], spacer, '')
			}
		}

		return stringifySimple('', value, [])
	}

	// The implementation fulfills the overloads exposed by `Stringify`.

	return serializer as Stringify
}

const stringify = configure() as DefaultStringify
stringify.configure = configure
stringify.stringify = stringify

export { stringify }
export default stringify
