import { DEFAULT_FIELDS, FIELDS, formatRows, mockRows } from '../tools/mock.js'
import { errorText, field, h, hint, input, output, segmented, set } from '../ui.js'

export default {
  id: 'mock',
  title: 'Mock Data',
  group: 'Generate',
  icon: 'users',
  color: '#d946ef',
  description: 'Fake users and records as JSON, CSV or SQL inserts, in English or Vietnamese',
  keywords: ['mock', 'fake', 'faker', 'seed', 'fixture', 'test data', 'dummy', 'sample', 'users', 'sql', 'insert', 'csv', 'vietnamese', 'tiếng việt'],
  create() {
    const chosen = new Set(DEFAULT_FIELDS)
    const count = input({ type: 'number', min: 1, max: 1000, value: 10, 'aria-label': 'Rows' })
    const table = input({ value: 'users', class: 'mono', 'aria-label': 'Table name' })
    let seed = 1
    const locale = segmented([['en', 'English'], ['vi', 'Tiếng Việt']], 'en', () => update(), 'Language')
    const format = segmented([['json', 'JSON'], ['csv', 'CSV'], ['sql', 'SQL'], ['ndjson', 'NDJSON']], 'json', () => update(), 'Format')
    const tableField = field('Table', table)
    const out = output('Rows')
    const result = h('div', { class: 'result' })
    const chips = h('div', { class: 'chips' }, Object.entries(FIELDS).map(([key, { label }]) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(chosen.has(key)), onclick: (event) => {
        if (chosen.has(key)) chosen.delete(key)
        else chosen.add(key)
        event.currentTarget.setAttribute('aria-pressed', String(chosen.has(key)))
        update()
      } }, label)))
    const again = h('button', { type: 'button', class: 'secondary', onclick: () => { seed = (seed * 48271 + 1) % 2147483647; update() } }, 'Regenerate')
    function update() {
      tableField.hidden = format.get() !== 'sql'
      const n = Math.min(1000, Math.max(1, Number(count.value) || 1))
      const fields = Object.keys(FIELDS).filter((key) => chosen.has(key))
      if (!fields.length) return set(result, hint('Pick at least one field.'))
      try {
        out.set(formatRows(mockRows({ count: n, fields, locale: locale.get(), seed }), format.get(), { table: table.value.trim() || 'users' }))
        set(result, out.node, hint('Names, emails and phone numbers are made up; domains are reserved example domains.'))
      } catch (error) {
        set(result, errorText(error.message))
      }
    }
    count.addEventListener('input', update)
    table.addEventListener('input', update)
    update()
    return {
      node: h('div', {},
        h('div', { class: 'bar' }, locale.node, again),
        field('Fields', chips),
        h('div', { class: 'inline' }, field('Rows', count), field('Format', format.node), tableField),
        result),
      focus: count,
      fill() {}
    }
  }
}
