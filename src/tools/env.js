// Environment variables between .env, JSON, Kubernetes Secret/ConfigMap, docker -e flags and
// shell exports.
import { dump, load } from 'js-yaml'
import { base64Decode, base64Encode } from './codec.js'

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/

/** .env text as [[name, value]], following the dotenv rules most tools share. */
export function parseDotenv(text) {
  const pairs = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (let n = 0; n < lines.length; n++) {
    let line = lines[n].trim()
    if (!line || line.startsWith('#')) continue
    line = line.replace(/^export\s+/, '')
    const eq = line.indexOf('=')
    if (eq <= 0) throw new Error(`Line ${n + 1}: expected NAME=value.`)
    const name = line.slice(0, eq).trim()
    if (!NAME.test(name)) throw new Error(`Line ${n + 1}: "${name}" is not a valid variable name.`)
    let rest = line.slice(eq + 1).trim()
    let value
    const q = rest[0]
    if (q === '"' || q === "'" || q === '`') {
      // A quoted value may span lines until its closing quote.
      let body = rest.slice(1)
      while (!closes(body, q) && n + 1 < lines.length) body += `\n${lines[++n]}`
      const end = closingIndex(body, q)
      if (end === -1) throw new Error(`The value of ${name} never closes its ${q} quote.`)
      value = body.slice(0, end)
      if (q === '"') value = value.replace(/\\([nrt"\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c)
    } else {
      value = rest.replace(/\s+#.*$/, '')
    }
    pairs.push([name, value])
  }
  return pairs
}

function closingIndex(body, q) {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && q === '"') i++
    else if (body[i] === q) return i
  }
  return -1
}
const closes = (body, q) => closingIndex(body, q) !== -1

/** Reads .env, a JSON object, a Kubernetes Secret or ConfigMap, or docker -e flags. */
export function readEnv(text) {
  const trimmed = text.trim()
  if (!trimmed) return { pairs: [], from: null }
  if (trimmed.startsWith('{')) {
    let obj
    try {
      obj = JSON.parse(trimmed)
    } catch (error) {
      throw new Error(`Not valid JSON: ${error.message}`)
    }
    return { pairs: Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]), from: 'JSON' }
  }
  if (/^(apiVersion|kind):/m.test(trimmed)) {
    const doc = load(trimmed)
    if (doc?.kind === 'Secret') {
      const pairs = [
        ...Object.entries(doc.data ?? {}).map(([k, v]) => [k, base64Decode(String(v)).text ?? '']),
        ...Object.entries(doc.stringData ?? {}).map(([k, v]) => [k, String(v)])
      ]
      return { pairs, from: 'Secret', name: doc.metadata?.name }
    }
    if (doc?.kind === 'ConfigMap') return { pairs: Object.entries(doc.data ?? {}).map(([k, v]) => [k, String(v)]), from: 'ConfigMap', name: doc.metadata?.name }
    throw new Error(`A ${doc?.kind ?? 'manifest'} holds no variables; paste a Secret or ConfigMap.`)
  }
  if (/(^|\s)(-e|--env)[\s=]/.test(trimmed)) {
    const pairs = []
    for (const match of trimmed.matchAll(/(?:-e|--env)[\s=]+("([^"]*)"|'([^']*)'|(\S+))/g)) {
      const item = match[2] ?? match[3] ?? match[4]
      const eq = item.indexOf('=')
      if (eq > 0) pairs.push([item.slice(0, eq), item.slice(eq + 1)])
    }
    return { pairs, from: 'docker' }
  }
  return { pairs: parseDotenv(trimmed), from: '.env' }
}

const needsQuotes = (value) => value === '' || /[\s#"'`$\\]/.test(value)
const dq = (value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
const sq = (value) => (/^[\w@%+=:,./-]*$/.test(value) && value !== '' ? value : `'${value.replace(/'/g, `'\\''`)}'`)
// Newlines need ANSI-C quoting to survive on one shell line.
const shellQuote = (value) => (/[\n\r\t]/.test(value) ? `$'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}'` : sq(value))

// Kubernetes keys allow letters, digits, -, _ and . only.
const k8sKey = (name) => name.replace(/[^\w.-]/g, '_')

export const ENV_TARGETS = [
  ['dotenv', '.env'],
  ['json', 'JSON'],
  ['secret', 'K8s Secret'],
  ['configmap', 'ConfigMap'],
  ['docker', 'docker -e'],
  ['compose', 'Compose'],
  ['shell', 'export']
]

export function writeEnv(pairs, target, { name = 'app-env' } = {}) {
  switch (target) {
    case 'dotenv':
      return pairs.map(([k, v]) => `${k}=${needsQuotes(v) ? dq(v) : v}`).join('\n')
    case 'json':
      return JSON.stringify(Object.fromEntries(pairs), null, 2)
    case 'secret':
      return dump({ apiVersion: 'v1', kind: 'Secret', metadata: { name }, type: 'Opaque', data: Object.fromEntries(pairs.map(([k, v]) => [k8sKey(k), base64Encode(v)])) }, { lineWidth: -1 })
    case 'configmap':
      return dump({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name }, data: Object.fromEntries(pairs.map(([k, v]) => [k8sKey(k), v])) }, { lineWidth: -1 })
    case 'docker':
      return pairs.map(([k, v]) => `-e ${shellQuote(`${k}=${v}`)}`).join(' \\\n')
    case 'compose':
      return dump({ environment: Object.fromEntries(pairs) }, { lineWidth: -1, quotingType: '"' })
    case 'shell':
      return pairs.map(([k, v]) => `export ${k}=${shellQuote(v)}`).join('\n')
    default:
      throw new Error(`Unknown target ${target}`)
  }
}

/** Names that look like secrets, for a warning before sharing. */
export const looksSecret = (name) => /(secret|token|password|passwd|pwd|api[_-]?key|private|credential|auth)/i.test(name)
