// YAML ↔ JSON with js-yaml (MIT), bundled.
import { dump, load, loadAll } from 'js-yaml'

const MAX_OUTPUT = 12_000_000

const isContainer = (value) => typeof value === 'object' && value !== null && !(value instanceof Date)

/** Printed length of a value that is not a container. */
function scalarLength(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value).length : 4
  if (typeof value === 'string' || value instanceof Date) return JSON.stringify(value)?.length ?? 4
  if (typeof value === 'boolean') return value ? 4 : 5
  return 4
}

/**
 * Length of JSON.stringify(value, null, 2), worked out without building it. Shared aliases count each
 * time they are used. Stops early and returns a number above the limit once the total passes it.
 */
export function jsonLength(root, limit = Infinity) {
  const stack = [root]
  const depths = [0]
  let size = 0
  while (stack.length && size <= limit) {
    const value = stack.pop()
    const depth = depths.pop()
    if (!isContainer(value)) {
      size += scalarLength(value)
      continue
    }
    const isArray = Array.isArray(value)
    const keys = isArray ? null : Object.keys(value)
    const count = isArray ? value.length : keys.length
    // Brackets; an empty container prints as [] or {}, else a newline follows the opening bracket and
    // the closing line is indented.
    size += count === 0 ? 2 : 3 + 2 * depth
    for (let i = 0; i < count && size <= limit; i++) {
      const child = isArray ? value[i] : value[keys[i]]
      // Indent, newline, comma, and for a map entry the key and ': '.
      size += 2 * (depth + 1) + 1 + (i < count - 1 ? 1 : 0) + (isArray ? 0 : JSON.stringify(keys[i]).length + 2)
      if (isContainer(child)) {
        stack.push(child)
        depths.push(depth + 1)
      } else {
        size += scalarLength(child)
      }
    }
  }
  return size
}

/** YAML text (one or more documents) as a value; several documents become an array. */
export function parseYaml(text) {
  try {
    const docs = loadAll(text).filter((doc) => doc !== undefined)
    const value = docs.length > 1 ? docs : docs[0] ?? null
    if (jsonLength(value, MAX_OUTPUT) > MAX_OUTPUT) {
      throw new Error(`The document would print as more than ${MAX_OUTPUT} characters of JSON (aliases count each time they are used).`)
    }
    return { value, documents: docs.length }
  } catch (error) {
    const mark = error.mark
    const where = mark ? ` (line ${mark.line + 1}, column ${mark.column + 1})` : ''
    throw new Error(`Not valid YAML${where}: ${error.reason ?? error.message.split('\n')[0]}`)
  }
}

export function yamlToJson(text, indent = 2) {
  return JSON.stringify(parseYaml(text).value, null, indent)
}

export function jsonToYaml(text, { indent = 2, sortKeys = false } = {}) {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`Not valid JSON: ${error.message}`)
  }
  return dump(value, { indent, sortKeys, lineWidth: -1, noRefs: true })
}

export { load as loadYaml }
