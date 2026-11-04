// Semantic Versioning 2.0.0, with npm's range syntax: ^ ~ x-ranges, hyphen ranges, || and
// comparator sets.

const VERSION = /^\s*[v=]?\s*(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?\s*$/

export function parseVersion(text) {
  const m = VERSION.exec(text)
  if (!m) throw new Error(`"${text.trim()}" is not a semantic version (MAJOR.MINOR.PATCH).`)
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [],
    build: m[5] ? m[5].split('.') : []
  }
}

export function formatVersion(v) {
  return `${v.major}.${v.minor}.${v.patch}${v.prerelease.length ? `-${v.prerelease.join('.')}` : ''}`
}

/** -1, 0 or 1 by SemVer precedence; build metadata is ignored. */
export function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a
  const y = typeof b === 'string' ? parseVersion(b) : b
  for (const key of ['major', 'minor', 'patch']) if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1
  if (!x.prerelease.length || !y.prerelease.length) return x.prerelease.length ? -1 : y.prerelease.length ? 1 : 0
  for (let i = 0; i < Math.max(x.prerelease.length, y.prerelease.length); i++) {
    const p = x.prerelease[i]
    const q = y.prerelease[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    if (typeof p === 'number' && typeof q === 'number') return p < q ? -1 : 1
    if (typeof p === 'number') return -1
    if (typeof q === 'number') return 1
    return p < q ? -1 : 1
  }
  return 0
}

const PARTIAL = /^[v=]?\s*(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

function partial(text) {
  const m = PARTIAL.exec(text.trim())
  if (!m) throw new Error(`"${text}" is not a version or range.`)
  const wild = (part) => part === undefined || /^[xX*]$/.test(part)
  return {
    major: wild(m[1]) ? null : Number(m[1]),
    minor: wild(m[2]) ? null : Number(m[2]),
    patch: wild(m[3]) ? null : Number(m[3]),
    prerelease: m[4] ? m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : []
  }
}

const v = (major, minor, patch, prerelease = []) => ({ major, minor, patch, prerelease, build: [], floor: prerelease === ZERO })
// The lowest possible prerelease: <2.0.0-0 excludes 2.0.0-alpha as well as 2.0.0.
const ZERO = [0]
const cmp = (op, version) => ({ op, version })

// One comparator token (^1.2, ~1, >=1.2.3, 1.x…) as a list of plain comparators.
function expand(token) {
  const m = /^(\^|~>?|>=|<=|>|<|=)?\s*(.+)$/.exec(token)
  const op = m[1] ?? ''
  const p = partial(m[2])
  const { major: M, minor: m2, patch: P, prerelease: pre } = p
  if (M === null) return op === '<' || op === '>' ? [cmp('<', v(0, 0, 0, ZERO))] : []
  switch (op) {
    case '^':
      if (M > 0 || m2 === null) return [cmp('>=', v(M, m2 ?? 0, P ?? 0, pre)), cmp('<', v(M + 1, 0, 0, ZERO))]
      if (m2 > 0 || P === null) return [cmp('>=', v(0, m2, P ?? 0, pre)), cmp('<', v(0, m2 + 1, 0, ZERO))]
      return [cmp('>=', v(0, 0, P, pre)), cmp('<', v(0, 0, P + 1, ZERO))]
    case '~':
    case '~>':
      if (m2 === null) return [cmp('>=', v(M, 0, 0)), cmp('<', v(M + 1, 0, 0, ZERO))]
      return [cmp('>=', v(M, m2, P ?? 0, pre)), cmp('<', v(M, m2 + 1, 0, ZERO))]
    case '>':
      if (m2 === null) return [cmp('>=', v(M + 1, 0, 0))]
      if (P === null) return [cmp('>=', v(M, m2 + 1, 0))]
      return [cmp('>', v(M, m2, P, pre))]
    case '>=':
      return [cmp('>=', v(M, m2 ?? 0, P ?? 0, pre))]
    case '<':
      return [cmp('<', v(M, m2 ?? 0, P ?? 0, m2 === null || P === null ? ZERO : pre))]
    case '<=':
      if (m2 === null) return [cmp('<', v(M + 1, 0, 0, ZERO))]
      if (P === null) return [cmp('<', v(M, m2 + 1, 0, ZERO))]
      return [cmp('<=', v(M, m2, P, pre))]
    default:
      if (m2 === null) return [cmp('>=', v(M, 0, 0)), cmp('<', v(M + 1, 0, 0, ZERO))]
      if (P === null) return [cmp('>=', v(M, m2, 0)), cmp('<', v(M, m2 + 1, 0, ZERO))]
      return [cmp('=', v(M, m2, P, pre))]
  }
}

/** A range as sets of comparators: [[{ op, version }]], any set matching satisfies it. */
export function parseRange(text) {
  const sets = text.split('||').map((part) => part.trim())
  return sets.map((set) => {
    if (!set || set === '*' || set.toLowerCase() === 'x' || set === 'latest') return []
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set)
    if (hyphen) {
      const low = partial(hyphen[1])
      const high = partial(hyphen[2])
      const out = [cmp('>=', v(low.major ?? 0, low.minor ?? 0, low.patch ?? 0, low.prerelease))]
      if (high.major !== null) {
        if (high.minor === null) out.push(cmp('<', v(high.major + 1, 0, 0, ZERO)))
        else if (high.patch === null) out.push(cmp('<', v(high.major, high.minor + 1, 0, ZERO)))
        else out.push(cmp('<=', v(high.major, high.minor, high.patch, high.prerelease)))
      }
      return out
    }
    return set.replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, '$1').split(/\s+/).flatMap(expand)
  })
}

function test(op, version, target) {
  const c = compareVersions(version, target)
  return { '=': c === 0, '>': c > 0, '>=': c >= 0, '<': c < 0, '<=': c <= 0 }[op]
}

/** Whether `version` satisfies `range`; prereleases only match a comparator on the same x.y.z. */
export function satisfies(version, range) {
  const ver = typeof version === 'string' ? parseVersion(version) : version
  return parseRange(range).some((set) => {
    if (!set.every(({ op, version: target }) => test(op, ver, target))) return false
    if (!ver.prerelease.length) return true
    return set.some(({ version: t }) => t.prerelease.length && !t.floor && t.major === ver.major && t.minor === ver.minor && t.patch === ver.patch)
  })
}

/** The range as plain comparators, e.g. ^1.2.3 → >=1.2.3 <2.0.0-0. */
export function describeRange(range) {
  return parseRange(range)
    .map((set) => (set.length ? set.map(({ op, version }) => `${op === '=' ? '' : op}${formatVersion(version)}`).join(' ') : '*'))
    .join(' || ')
}

export function increment(text, kind, preid = 'rc') {
  const x = parseVersion(text)
  switch (kind) {
    case 'major':
      return formatVersion(x.prerelease.length && !x.minor && !x.patch ? v(x.major, 0, 0) : v(x.major + 1, 0, 0))
    case 'minor':
      return formatVersion(x.prerelease.length && !x.patch ? v(x.major, x.minor, 0) : v(x.major, x.minor + 1, 0))
    case 'patch':
      return formatVersion(x.prerelease.length ? v(x.major, x.minor, x.patch) : v(x.major, x.minor, x.patch + 1))
    case 'prerelease': {
      if (!x.prerelease.length) return formatVersion(v(x.major, x.minor, x.patch + 1, [preid, 0]))
      const pre = [...x.prerelease]
      const last = pre.findLastIndex((id) => typeof id === 'number')
      if (last === -1) pre.push(0)
      else pre[last]++
      return formatVersion(v(x.major, x.minor, x.patch, pre))
    }
  }
  throw new Error(`Unknown increment ${kind}`)
}

/** Versions sorted by precedence, oldest first; invalid lines are returned separately. */
export function sortVersions(lines) {
  const valid = []
  const invalid = []
  for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
    try {
      valid.push([line, parseVersion(line)])
    } catch {
      invalid.push(line)
    }
  }
  valid.sort((a, b) => compareVersions(a[1], b[1]))
  return { sorted: valid.map(([line]) => line), invalid }
}
