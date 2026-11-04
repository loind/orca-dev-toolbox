import { transform, TRANSFORMS } from '../tools/transform.js'
import { checkbox, errorText, field, h, hint, input, output, segmented, set, textarea } from '../ui.js'

const NOTES = {
  accents: 'Strips diacritics, Vietnamese đ included: Tiếng Việt → Tieng Viet.',
  slug: 'Each line as a URL slug: lowercase ASCII words joined by hyphens.',
  sqlIn: 'Numbers stay bare; text is quoted, with single quotes doubled.',
  jsonArray: 'All-numeric lists become numbers.',
  table: 'Paste cells from a spreadsheet (tab-separated) or CSV; the first row is the header.',
  straight: 'Curly quotes, primes and … to plain ASCII, and no-break spaces to spaces.'
}

export default {
  id: 'transform',
  title: 'Text Transform',
  group: 'Text',
  icon: 'wand',
  color: '#10b981',
  description: 'Remove accents, slugify, lines to SQL IN or JSON, Markdown tables',
  keywords: ['accents', 'diacritics', 'vietnamese', 'bo dau', 'slug', 'slugify', 'sql', 'in', 'list', 'join', 'split', 'quote', 'wrap', 'markdown', 'table', 'trim', 'whitespace', 'reverse', 'tabs'],
  create() {
    const source = textarea({ rows: 6, placeholder: 'Text, or one item per line' })
    const result = h('div', { class: 'result' })
    const out = output('Result')
    const prefix = input({ value: "'", 'aria-label': 'Before each line', class: 'mono' })
    const suffix = input({ value: "',", 'aria-label': 'After each line', class: 'mono' })
    const separator = input({ value: ', ', 'aria-label': 'Separator', class: 'mono' })
    const wrapOptions = h('div', { class: 'inline', hidden: true }, field('Before', prefix), field('After', suffix))
    const listOptions = h('div', { class: 'inline', hidden: true }, field('Separator', separator))
    const mysql = checkbox('Escape backslashes (MySQL, MariaDB)', () => update())
    const mysqlOption = h('div', { hidden: true }, mysql.node)
    const note = hint('')
    const action = segmented(TRANSFORMS.map(([id, label]) => [id, label]), 'accents', () => update(), 'Transform')
    action.node.classList.add('chips-grid')
    function update() {
      const id = action.get()
      wrapOptions.hidden = id !== 'wrap'
      listOptions.hidden = id !== 'toList'
      mysqlOption.hidden = id !== 'sqlIn'
      note.textContent = NOTES[id] ?? ''
      if (id === 'sqlIn' && !mysql.get() && source.value.includes('\\')) note.textContent += ' A backslash is kept as written. MySQL and MariaDB read it as an escape, so tick the box if you use one of them.'
      if (!source.value) return set(result)
      try {
        out.set(transform(source.value, id, { prefix: prefix.value, suffix: suffix.value, separator: separator.value.replace(/\\t/g, '\t').replace(/\\n/g, '\n'), mysql: mysql.get() }))
        set(result, out.node)
      } catch (error) {
        set(result, errorText(error.message))
      }
    }
    for (const control of [source, prefix, suffix, separator]) control.addEventListener('input', update)
    update()
    return {
      node: h('div', {}, field('Input', source), action.node, wrapOptions, listOptions, mysqlOption, note, result),
      focus: source,
      fill(value) {
        source.value = value
        update()
      }
    }
  }
}
