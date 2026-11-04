import { compareVersions, describeRange, increment, parseVersion, satisfies, sortVersions } from '../tools/semver.js'
import { errorText, field, h, hint, input, output, rows, segmented, set, textarea } from '../ui.js'

export default {
  id: 'semver',
  title: 'Semver',
  group: 'Inspect',
  icon: 'tag',
  color: '#10b981',
  description: 'Check a version against a range like ^1.2.0, compare and sort versions',
  keywords: ['semver', 'version', 'range', 'caret', 'tilde', 'npm', 'package.json', 'compare', 'sort', 'bump', 'release'],
  create() {
    const version = input({ placeholder: '1.4.2', class: 'mono', 'aria-label': 'Version' })
    const range = input({ placeholder: '^1.2.0 || >=2.1.0 <3', class: 'mono', 'aria-label': 'Range' })
    const list = textarea({ rows: 6, placeholder: '1.10.0\n1.2.0\n1.2.0-beta.2\n2.0.0' })
    const result = h('div', { class: 'result' })
    const sorted = output('Sorted')
    const mode = segmented([['check', 'Check'], ['sort', 'Sort']], 'check', () => layout(), 'Mode')
    const checkFields = h('div', { class: 'stack' }, field('Version', version), field('Range or second version', range))
    const sortFields = field('Versions, one per line', list)
    function layout() {
      checkFields.hidden = mode.get() !== 'check'
      sortFields.hidden = mode.get() !== 'sort'
      update()
    }
    function update() {
      try {
        if (mode.get() === 'sort') {
          if (!list.value.trim()) return set(result, hint('Prereleases sort before their release: 1.0.0-rc.1 < 1.0.0.'))
          const { sorted: ordered, invalid } = sortVersions(list.value.split('\n'))
          sorted.set(ordered.join('\n'))
          return set(result, sorted.node, invalid.length ? errorText(`Not versions: ${invalid.join(', ')}`) : null)
        }
        const v = version.value.trim()
        const r = range.value.trim()
        if (!v) return set(result, hint('npm ranges: ^ allows changes that keep the leftmost non-zero part, ~ allows patch changes, 1.x any 1.y.z.'))
        const parsed = parseVersion(v)
        const out = []
        if (r) {
          let isVersion = true
          try {
            parseVersion(r)
          } catch {
            isVersion = false
          }
          if (isVersion) {
            const c = compareVersions(parsed, r)
            out.push(rows([['Compare', `${v} ${c < 0 ? '<' : c > 0 ? '>' : '='} ${r}`]]))
          } else {
            const ok = satisfies(parsed, r)
            out.push(rows([
              ['Satisfies', ok ? 'yes' : 'no', ok ? { text: 'in range', kind: 'ok' } : { text: 'out of range', kind: 'bad' }],
              ['Range means', describeRange(r)]
            ]))
            if (!ok && parsed.prerelease.length) out.push(hint('A prerelease only matches a range that names a prerelease of the same x.y.z.'))
          }
        }
        out.push(h('p', { class: 'subhead' }, 'Next versions'), rows([
          ['Patch', increment(v, 'patch')],
          ['Minor', increment(v, 'minor')],
          ['Major', increment(v, 'major')],
          ['Prerelease', increment(v, 'prerelease')]
        ]))
        set(result, ...out)
      } catch (error) {
        set(result, errorText(error.message))
      }
    }
    for (const node of [version, range, list]) node.addEventListener('input', update)
    layout()
    return {
      node: h('div', {}, h('div', { class: 'bar' }, mode.node), checkFields, sortFields, result),
      focus: version,
      fill(value) {
        const text = value.trim()
        if (text.includes('\n')) {
          list.value = text
          mode.set('sort')
        } else if (/^[v=]?\d+\.\d+\.\d+\S*$/.test(text)) {
          version.value = text
          mode.set('check')
        } else {
          range.value = text
          mode.set('check')
        }
      }
    }
  }
}
