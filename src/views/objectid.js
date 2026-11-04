import { fromLocalParts, localParts, objectIdFromTime, objectIdTime, parseObjectId, PARTS } from '../tools/objectid.js'
import { localString, timeRows } from '../tools/time.js'
import { errorText, field, h, hint, input, rows, set } from '../ui.js'

export default {
  id: 'objectid',
  title: 'MongoDB ObjectId',
  group: 'Inspect',
  icon: 'leaf',
  color: '#13aa52',
  description: 'ObjectId ↔ creation time, to query by date',
  keywords: ['mongo', 'mongodb', 'objectid', 'object id', 'oid', '_id', 'bson', 'timestamp', 'date', 'created', 'convert'],
  create() {
    const source = input({ class: 'mono', placeholder: '24 hex digits or ObjectId("…")' })
    const parts = Object.fromEntries(PARTS.map(([key, label, min, max]) =>
      [key, input({ type: 'number', min, max, step: 1, 'aria-label': label })]))
    const zone = h('span', { class: 'field-label' }, 'Local time')
    const grid = h('div', { class: 'time-parts', role: 'group', 'aria-label': 'Local time' },
      PARTS.map(([key, label]) => field(label, parts[key])))
    const result = h('div', { class: 'result' })
    let shown = null // the Date on display: a local time that happens twice is read with its offset
    const now = h('button', { type: 'button', class: 'secondary small', onclick: () => showTime(new Date()) }, 'Now')

    function show(hex, date) {
      const shell = `ObjectId("${hex}")`
      shown = date
      const offset = localString(date).replace(/^.* /, '')
      zone.textContent = `Local time (${offset})`
      grid.setAttribute('aria-label', `Local time (${offset})`)
      set(result,
        rows([['Shell', shell], ['Query', `db.collection.find({ _id: { $gt: ${shell} } })`], ...timeRows(date)]),
        hint(hex.endsWith('0'.repeat(16))
          ? 'Built from a time, so it ends in zeros and is not unique: use it to compare, e.g. to find documents created after this time, never as a new _id.'
          : 'The first 8 hex digits are the creation time in seconds; the rest are random bytes and a counter.'))
    }
    // The time is known exactly here, so a local time that happens twice is not read back from the fields.
    function showTime(now) {
      const date = new Date(Math.floor(now.getTime() / 1000) * 1000)
      for (const [key, value] of Object.entries(localParts(date))) parts[key].value = value
      const hex = objectIdFromTime(date)
      source.value = hex
      show(hex, date)
    }
    function fromId() {
      try {
        const hex = parseObjectId(source.value)
        if (!hex) return set(result, hint('Paste an ObjectId to see when it was created, or set a time to get an ObjectId for range queries.'))
        const date = objectIdTime(hex)
        for (const [key, value] of Object.entries(localParts(date))) parts[key].value = value
        show(hex, date)
      } catch (error) {
        set(result, errorText(error.message))
      }
    }
    function fromParts() {
      try {
        for (const [key, label] of PARTS) {
          if (parts[key].validity.badInput) throw new Error(`${label} is not a whole number.`)
        }
        const date = fromLocalParts(Object.fromEntries(PARTS.map(([key]) => [key, parts[key].value])), shown)
        const hex = objectIdFromTime(date)
        source.value = hex
        show(hex, date)
      } catch (error) {
        set(result, errorText(error.message))
      }
    }
    source.addEventListener('input', fromId)
    for (const control of Object.values(parts)) control.addEventListener('input', fromParts)
    showTime(new Date())
    return {
      node: h('div', {}, field('ObjectId', source), h('div', { class: 'bar' }, zone, now), grid, result),
      focus: source,
      fill(value) {
        source.value = value
        fromId()
      }
    }
  }
}
