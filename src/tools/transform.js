// One-step text transforms, the kind people otherwise do with a regex in the editor.
import { guessDelimiter, parseCsv } from './csv.js'

/** Strips diacritics, Vietnamese đ included: "Tiếng Việt Đẹp" → "Tieng Viet Dep". */
export function removeAccents(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFC')
}

/** A URL slug: lowercase ASCII words joined by `separator`. */
export function slugify(text, separator = '-') {
  return removeAccents(text)
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(separator)
}

const lines = (text) => text.split(/\r\n|\r|\n/)
const items = (text) => lines(text).map((line) => line.trim()).filter(Boolean)
const isNumber = (value) => /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

function markdownTable(text) {
  const rows = parseCsv(text.trim(), guessDelimiter(text))
  if (!rows.length) return ''
  const width = Math.max(...rows.map((row) => row.length))
  const cells = rows.map((row) => Array.from({ length: width }, (_, i) => (row[i] ?? '').trim().replace(/\|/g, '\\|').replace(/\n/g, '<br>')))
  const sizes = Array.from({ length: width }, (_, i) => Math.max(3, ...cells.map((row) => [...row[i]].length)))
  const line = (row) => `| ${row.map((cell, i) => cell + ' '.repeat(sizes[i] - [...cell].length)).join(' | ')} |`
  return [line(cells[0]), `| ${sizes.map((n) => '-'.repeat(n)).join(' | ')} |`, ...cells.slice(1).map(line)].join('\n')
}

function fromJsonArray(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`Not valid JSON: ${error.message}`)
  }
  if (!Array.isArray(value)) throw new Error('Expected a JSON array, such as ["a", "b"].')
  return value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n')
}

/** [id, label, transform(text, options)]; options: { prefix, suffix, separator, mysql } */
export const TRANSFORMS = [
  ['accents', 'Remove accents', (t) => removeAccents(t)],
  ['slug', 'Slug', (t) => lines(t).map((line) => slugify(line)).join('\n')],
  ['trim', 'Trim lines', (t) => lines(t).map((line) => line.trim()).join('\n').trim()],
  ['squeeze', 'Collapse spaces', (t) => lines(t).map((line) => line.replace(/[ \t ]+/g, ' ').trim()).join('\n')],
  ['oneLine', 'Join into one line', (t) => items(t).join(' ')],
  ['toList', 'Lines → list', (t, o) => items(t).join(o.separator ?? ', ')],
  ['fromList', 'List → lines', (t) => t.split(/[,;\t\n]+/).map((s) => s.trim()).filter(Boolean).join('\n')],
  ['sqlIn', 'Lines → SQL IN', (t, o) => {
    const values = items(t)
    const numeric = values.every(isNumber)
    // MySQL and MariaDB read \ as an escape, so a value ending in a backslash would eat its closing quote.
    const quote = (v) => `'${(o.mysql ? v.replace(/\\/g, '\\\\') : v).replace(/'/g, "''")}'`
    return `(${values.map((v) => (numeric ? v : quote(v))).join(', ')})`
  }],
  ['jsonArray', 'Lines → JSON array', (t) => {
    const values = items(t)
    return JSON.stringify(values.every(isNumber) ? values.map(Number) : values)
  }],
  ['fromJson', 'JSON array → lines', (t) => fromJsonArray(t)],
  ['wrap', 'Wrap each line', (t, o) => items(t).map((line) => `${o.prefix ?? ''}${line}${o.suffix ?? ''}`).join('\n')],
  ['number', 'Number lines', (t) => {
    const all = lines(t)
    const width = String(all.length).length
    return all.map((line, i) => `${String(i + 1).padStart(width)}. ${line}`).join('\n')
  }],
  ['table', 'Table → Markdown', (t) => markdownTable(t)],
  ['straight', 'Straight quotes', (t) => t.replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, "'").replace(/…/g, '...').replace(/ /g, ' ')],
  ['tabs', 'Tabs → spaces', (t, o) => t.replace(/\t/g, ' '.repeat(Number(o.tabWidth) || 2))],
  ['reverse', 'Reverse', (t) => (graphemes ? [...graphemes.segment(t)].map((s) => s.segment) : [...t]).reverse().join('')]
]

export function transform(text, id, options = {}) {
  return TRANSFORMS.find(([key]) => key === id)[2](text, options)
}
