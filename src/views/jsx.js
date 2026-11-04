import { htmlToJsx } from '../tools/jsx.js'
import { checkbox, errorText, field, h, hint, input, output, set, textarea } from '../ui.js'

export default {
  id: 'jsx',
  title: 'HTML to JSX',
  group: 'Convert',
  icon: 'atom',
  color: '#06b6d4',
  description: 'HTML or SVG as React JSX: className, style objects, closed tags',
  keywords: ['jsx', 'react', 'html', 'svg', 'tsx', 'component', 'classname', 'icon', 'convert', 'next'],
  create() {
    const source = textarea({ rows: 8, placeholder: '<div class="card" style="padding: 8px">\n  <img src="a.png">\n</div>' })
    const wrap = checkbox('Wrap in a component', () => update())
    const name = input({ value: 'Component', 'aria-label': 'Component name' })
    const nameField = h('div', { class: 'inline', hidden: true }, field('Component name', name))
    const result = h('div', { class: 'result' })
    const out = output('JSX')
    const note = hint('Converts attribute names (class, for, tabindex, stroke-width…), inline styles, void tags, comments, event handlers and braces in text. Unsafe event handlers (braces, backticks, slashes, line breaks or an unclosed quote), odd attribute names and tags with a dot are dropped, not converted.')
    function update() {
      nameField.hidden = !wrap.get()
      if (!source.value.trim()) return set(result)
      const component = wrap.get() ? (name.value.trim() || 'Component').replace(/^[a-z]/, (c) => c.toUpperCase()).replace(/[^\w$]/g, '') : null
      try {
        out.set(htmlToJsx(source.value, { component }))
        set(result, out.node)
      } catch (error) {
        set(result, errorText(error.message))
      }
    }
    source.addEventListener('input', update)
    name.addEventListener('input', update)
    update()
    return {
      node: h('div', {}, field('HTML or SVG', source), wrap.node, nameField, note, result),
      focus: source,
      fill(value) {
        source.value = value
        update()
      }
    }
  }
}
