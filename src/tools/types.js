// Type declarations inferred from a JSON sample: TypeScript, Go, Rust (serde) and Python.
//
// The sample is read into a small shape tree first: a field seen in only some objects of an array
// is optional, a field that is sometimes null is nullable, and objects reached by the same field
// name are merged into one type.

/** Shapes: { kind: 'string'|'number'|'integer'|'boolean'|'null'|'unknown' } | { kind: 'array', item } | { kind: 'object', fields } | { kind: 'union', options } */
function shapeOf(value) {
  if (value === null) return { kind: 'null' }
  if (Array.isArray(value)) return { kind: 'array', item: value.map(shapeOf).reduce(merge, null) ?? { kind: 'unknown' } }
  if (typeof value === 'object') {
    const fields = new Map()
    for (const [key, child] of Object.entries(value)) fields.set(key, { shape: shapeOf(child), optional: false })
    return { kind: 'object', fields }
  }
  if (typeof value === 'number') return { kind: Number.isInteger(value) ? 'integer' : 'number' }
  return { kind: typeof value }
}

function merge(a, b) {
  if (!a) return b
  if (!b) return a
  if (a.kind === 'unknown') return b
  if (b.kind === 'unknown') return a
  if (a.kind === b.kind) {
    if (a.kind === 'array') return { kind: 'array', item: merge(a.item, b.item) }
    if (a.kind === 'object') {
      const fields = new Map()
      for (const [key, field] of a.fields) {
        const other = b.fields.get(key)
        fields.set(key, other ? { shape: merge(field.shape, other.shape), optional: field.optional || other.optional } : { ...field, optional: true })
      }
      for (const [key, field] of b.fields) if (!a.fields.has(key)) fields.set(key, { ...field, optional: true })
      return { kind: 'object', fields }
    }
    if (a.kind === 'union') return b.options.reduce(addOption, a)
    return a
  }
  if ((a.kind === 'integer' && b.kind === 'number') || (a.kind === 'number' && b.kind === 'integer')) return { kind: 'number' }
  return addOption(a.kind === 'union' ? a : { kind: 'union', options: [a] }, b)
}

function addOption(union, shape) {
  if (shape.kind === 'union') return shape.options.reduce(addOption, union)
  const index = union.options.findIndex((option) => option.kind === shape.kind || (isNumeric(option) && isNumeric(shape)))
  const options = [...union.options]
  if (index === -1) options.push(shape)
  else options[index] = merge(options[index], shape)
  return options.length === 1 ? options[0] : { kind: 'union', options }
}

const isNumeric = (shape) => shape.kind === 'number' || shape.kind === 'integer'

/** Splits off null: { shape, nullable }. */
function unwrapNull(shape) {
  if (shape.kind !== 'union') return { shape, nullable: false }
  const rest = shape.options.filter((option) => option.kind !== 'null')
  if (rest.length === shape.options.length) return { shape, nullable: false }
  return { shape: rest.length === 1 ? rest[0] : rest.length ? { kind: 'union', options: rest } : { kind: 'null' }, nullable: true }
}

const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean)
const pascal = (name) => words(name).map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Item'
const snake = (name) => words(name).map((w) => w.toLowerCase()).join('_') || 'field'
const singular = (name) => name.replace(/ies$/, 'y').replace(/([^s])s$/, '$1')

/** Walks the tree and names every object type, parents first. */
function collect(root, rootName) {
  const types = []
  const used = new Set()
  function name(base) {
    let candidate = pascal(base)
    if (/^\d/.test(candidate)) candidate = `T${candidate}`
    let unique = candidate
    for (let i = 2; used.has(unique); i++) unique = `${candidate}${i}`
    used.add(unique)
    return unique
  }
  function visit(shape, hint) {
    if (shape.kind === 'array') return visit(shape.item, singular(hint))
    if (shape.kind === 'union') return shape.options.forEach((option) => visit(option, hint))
    if (shape.kind !== 'object' || shape.name) return
    shape.name = name(hint)
    types.push(shape)
    for (const [key, field] of shape.fields) visit(field.shape, key)
  }
  if (root.kind === 'object') visit(root, rootName)
  else {
    // The root alias keeps its name; types inside it are named after it.
    used.add(pascal(rootName))
    visit(root, `${rootName}Item`)
  }
  return types
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

// Go spells initialisms in capitals: UserID, APIURL.
const INITIALISMS = new Set(['id', 'url', 'uri', 'api', 'http', 'https', 'json', 'xml', 'html', 'ip', 'uuid', 'sql', 'ssh', 'tls', 'ttl', 'cpu', 'db', 'os', 'ui', 'utc'])
const goName = (key) => {
  const name = words(key).map((w) => (INITIALISMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join('') || 'Field'
  return /^\d/.test(name) ? `F${name}` : name
}

// A raw string cannot hold a backtick, and a quote, backslash or control character would end or
// bend the tag value; such a key gets an interpreted string, which escapes all of them.
const goTag = (key, options) => (/[`"\\\u0000-\u001f\u007f]/.test(key) ? JSON.stringify(`json:${JSON.stringify(key + options)}`) : `\`json:"${key}${options}"\``)

// Rust string literal escapes: \ and " get a backslash, control characters become \u{..}.
const rustString = (text) => text.replace(/[\\"\u0000-\u001f\u007f]/g, (c) => (c === '\\' || c === '"' ? `\\${c}` : `\\u{${c.charCodeAt(0).toString(16)}}`))

const LANGUAGES = {
  typescript(types, root) {
    const ref = (shape) => {
      switch (shape.kind) {
        case 'object': return shape.name
        case 'array': {
          const item = ref(shape.item)
          return /[ |]/.test(item) ? `Array<${item}>` : `${item}[]`
        }
        case 'union': return shape.options.map(ref).join(' | ')
        case 'integer': return 'number'
        case 'unknown': return 'unknown'
        default: return shape.kind
      }
    }
    const blocks = types.map((type) => [
      `export interface ${type.name} {`,
      ...[...type.fields].map(([key, field]) => `  ${IDENTIFIER.test(key) ? key : JSON.stringify(key)}${field.optional ? '?' : ''}: ${ref(field.shape)}`),
      '}'
    ].join('\n'))
    if (root.kind !== 'object') blocks.unshift(`export type Root = ${ref(root)}`)
    return blocks.join('\n\n')
  },

  go(types, root) {
    const ref = (shape, pointer = false) => {
      const { shape: inner, nullable } = unwrapNull(shape)
      const star = (nullable || pointer) && inner.kind !== 'array' && inner.kind !== 'union' && inner.kind !== 'unknown' && inner.kind !== 'null' ? '*' : ''
      switch (inner.kind) {
        case 'object': return star + inner.name
        case 'array': return `[]${ref(inner.item)}`
        case 'integer': return `${star}int64`
        case 'number': return `${star}float64`
        case 'boolean': return `${star}bool`
        case 'string': return `${star}string`
        default: return 'any'
      }
    }
    const blocks = types.map((type) => {
      const fields = [...type.fields].map(([key, field]) => [goName(key), ref(field.shape, field.optional), goTag(key, field.optional ? ',omitempty' : '')])
      const width = (i) => Math.max(...fields.map((f) => f[i].length))
      return [`type ${type.name} struct {`, ...fields.map((f) => `\t${f[0].padEnd(width(0))} ${f[1].padEnd(width(1))} ${f[2]}`), '}'].join('\n')
    })
    if (root.kind !== 'object') blocks.unshift(`type Root ${ref(root)}`)
    return blocks.join('\n\n')
  },

  rust(types, root) {
    const ref = (shape) => {
      const { shape: inner, nullable } = unwrapNull(shape)
      let type
      switch (inner.kind) {
        case 'object': type = inner.name; break
        case 'array': type = `Vec<${ref(inner.item)}>`; break
        case 'integer': type = 'i64'; break
        case 'number': type = 'f64'; break
        case 'boolean': type = 'bool'; break
        case 'string': type = 'String'; break
        default: type = 'serde_json::Value'
      }
      return nullable && type !== 'serde_json::Value' ? `Option<${type}>` : type
    }
    const blocks = types.map((type) => [
      '#[derive(Debug, Clone, Serialize, Deserialize)]',
      `pub struct ${type.name} {`,
      ...[...type.fields].flatMap(([key, field]) => {
        let name = snake(key)
        if (['type', 'match', 'ref', 'self', 'struct', 'fn', 'mod', 'use', 'impl', 'move', 'loop', 'box'].includes(name)) name = `r#${name}`
        let typeName = ref(field.shape)
        const attrs = []
        if (name !== key) attrs.push(`rename = "${rustString(key)}"`)
        if (field.optional) {
          if (!typeName.startsWith('Option<')) typeName = `Option<${typeName}>`
          attrs.push('default', 'skip_serializing_if = "Option::is_none"')
        }
        return [...(attrs.length ? [`    #[serde(${attrs.join(', ')})]`] : []), `    pub ${name}: ${typeName},`]
      }),
      '}'
    ].join('\n'))
    blocks.unshift('use serde::{Deserialize, Serialize};')
    if (root.kind !== 'object') blocks.splice(1, 0, `pub type Root = ${ref(root)};`)
    return blocks.join('\n\n')
  },

  python(types, root) {
    const ref = (shape) => {
      const { shape: inner, nullable } = unwrapNull(shape)
      let type
      switch (inner.kind) {
        case 'object': type = inner.name; break
        case 'array': type = `list[${ref(inner.item)}]`; break
        case 'union': type = inner.options.map(ref).join(' | '); break
        case 'integer': type = 'int'; break
        case 'number': type = 'float'; break
        case 'boolean': type = 'bool'; break
        case 'string': type = 'str'; break
        case 'null': type = 'None'; break
        default: type = 'Any'
      }
      return nullable ? `${type} | None` : type
    }
    // Children first, so each class is defined before use; required fields before defaults.
    const blocks = [...types].reverse().map((type) => {
      const fields = [...type.fields].sort((a, b) => a[1].optional - b[1].optional)
      return [
        '@dataclass',
        `class ${type.name}:`,
        ...(fields.length
          ? fields.map(([key, field]) => {
            const type = ref(field.shape)
            return field.optional ? `    ${snake(key)}: ${/\bNone$/.test(type) ? type : `${type} | None`} = None` : `    ${snake(key)}: ${type}`
          })
          : ['    pass'])
      ].join('\n')
    })
    const header = ['from __future__ import annotations', '', 'from dataclasses import dataclass']
    if (/\bAny\b/.test(blocks.join())) header.push('from typing import Any')
    if (root.kind !== 'object') blocks.push(`Root = ${ref(root)}`)
    return [header.join('\n'), ...blocks].join('\n\n\n')
  }
}

export const TYPE_LANGUAGES = [['typescript', 'TypeScript'], ['go', 'Go'], ['rust', 'Rust'], ['python', 'Python']]

/** Declarations for the JSON sample in `language`, the root type named `rootName`. */
export function jsonToTypes(text, language = 'typescript', rootName = 'Root') {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`Not valid JSON: ${error.message}`)
  }
  const root = shapeOf(value)
  const types = collect(root, rootName || 'Root')
  return LANGUAGES[language](types, root)
}
