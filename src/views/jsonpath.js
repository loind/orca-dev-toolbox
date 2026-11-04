import { queryJson } from '../tools/jsonpath.js'
import { checkbox, errorText, field, h, hint, input, output, set, textarea } from '../ui.js'

const EXAMPLES = [
  ['$..id', 'every id'],
  ['$.items[*].name', 'names'],
  ['$.items[?(@.price < 10)]', 'filter'],
  ['$.items[-1]', 'last item'],
  ['$.items[0:3]', 'first three'],
  ['$.items[?(@.tags && length(@.tags) > 1)].name', 'function']
]

export default {
  id: 'jsonpath',
  title: 'JSON Query',
  group: 'Format',
  icon: 'filter',
  color: '#f97316',
  description: 'Pick values out of JSON with a JSONPath query',
  keywords: ['jsonpath', 'json', 'query', 'jq', 'path', 'filter', 'select', 'extract', 'api', 'response'],
  create() {
    const source = textarea({ rows: 8, placeholder: '{"items": [{"name": "Pen", "price": 3}, {"name": "Lamp", "price": 25}]}' })
    const path = input({ placeholder: '$.items[*].name', class: 'mono', 'aria-label': 'JSONPath' })
    const result = h('div', { class: 'result' })
    const out = output('Matches')
    const showPaths = checkbox('Show paths', () => update())
    function update() {
      if (!source.value.trim()) return set(result, hint('Paste JSON, such as an API response, then write a query.'))
      let data
      try {
        data = JSON.parse(source.value)
      } catch (error) {
        return set(result, errorText(`Not valid JSON: ${error.message}`))
      }
      if (!path.value.trim()) return set(result, hint('Write a query above, or pick an example.'))
      try {
        const matches = queryJson(data, path.value)
        out.set(showPaths.get()
          ? matches.map((m) => `${m.path}\n${JSON.stringify(m.value, null, 2)}`).join('\n\n')
          : JSON.stringify(matches.length === 1 ? matches[0].value : matches.map((m) => m.value), null, 2))
        set(result, out.node, hint(matches.length ? `${matches.length} match${matches.length === 1 ? '' : 'es'}.` : 'No matches.'))
      } catch (error) {
        set(result, errorText(error.message))
      }
    }
    const examples = h('div', { class: 'chips' }, EXAMPLES.map(([query, label]) =>
      h('button', { type: 'button', class: 'chip', title: query, onclick: () => { path.value = query; update() } }, label)))
    source.addEventListener('input', update)
    path.addEventListener('input', update)
    update()
    return {
      node: h('div', {}, field('JSON', source), field('Query', path), h('div', { class: 'bar' }, examples, showPaths.node), result),
      focus: source,
      fill(value) {
        source.value = value
        update()
      }
    }
  }
}
