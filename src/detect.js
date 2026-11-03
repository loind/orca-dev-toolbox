// Recognises what a pasted value is, so the home screen can open the right tool with it filled
// in. Returns a tool id or null; checks run from the most specific shape to the loosest.
import { base64ToBytes, bytesToText } from './tools/codec.js'
import { parseCron } from './tools/cron.js'
import { guessDelimiter, parseCsv } from './tools/csv.js'
import { tokenizeXml } from './tools/xml.js'
import { parseYaml } from './tools/yaml.js'

const JWT = /^(Bearer\s+)?eyJ[\w-]*\.eyJ[\w-]*\.[\w-]*$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TIMESTAMP = /^\d{9,10}(\d{3})?(\d{3})?$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i
const PERCENT = /%[0-9a-f]{2}/i
const BASE64 = /^[A-Za-z0-9+/_-]{8,}={0,2}$/
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/
const CURL = /^curl\s/
const IPV4_CIDR = /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2}|\s+\d{1,3}(\.\d{1,3}){3})?$/
const IPV6_CIDR = /^(?=[^/]*:)[0-9a-f:]+\/\d{1,3}$/i
const SQL = /^(select|insert\s+into|update|delete\s+from|with|create\s+(table|view|index)|alter\s+table)\s/i
const XML = /^<(\?xml|[A-Za-z_])[\s\S]*>$/
const SIZE = /^\d+(\.\d+)?\s*([kmgtp]i?b|bytes?)$/i
const DURATION = /^(\d+(\.\d+)?(ms|s|m|h|d))+$|^p(\d+[wd])*(t(\d+(\.\d+)?[hms])+)?$/i
const HIDDEN = /[\u200b-\u200f\u2060-\u2064\ufeff\u00ad\u202a-\u202e\u2066-\u2069]/
const PEM = /^-----BEGIN [A-Z0-9 ]+-----/
const BCRYPT = /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/
const DATA_URI = /^data:[\w.+-]+\/[\w.+-]+[;,]/i
const CSS_LENGTH = /^-?(\d+(\.\d+)?|\.\d+)(px|rem|em|pt|vw|vh)$/i
const YAML_KEY = /^(---\s*\n)?[\w.-]+:(\s|$)/
const HEX_COLOR = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const COLOR_FN = /^(rgba?|hsla?|oklch)\([^()]*\)$/i
const PREFIXED_NUMBER = /^-?0(x[0-9a-f_]+|b[01_]+|o[0-7_]+)$/i
const SYMBOLIC_MODE = /^[-dl]?[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/
const ESCAPED = /&(#\d+|#x[0-9a-f]+|[a-z]+\d*);|\\u(\{[0-9a-f]+\}|[0-9a-f]{4})/i

function isJson(text) {
  if (!/^[[{]/.test(text)) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function isCron(text) {
  if (!/^(@\w+|(\S+\s+){4}\S+)$/.test(text)) return false
  try {
    parseCron(text)
    return true
  } catch {
    return false
  }
}

function isXml(text) {
  try {
    tokenizeXml(text)
    return true
  } catch {
    return false
  }
}

function isYaml(text) {
  try {
    const { value } = parseYaml(text)
    return value !== null && typeof value === 'object'
  } catch {
    return false
  }
}

// Two or more lines that a delimiter splits into the same number (two or more) of fields.
function isCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return false
  const sep = guessDelimiter(text)
  try {
    const rows = parseCsv(lines.slice(0, 20).join('\n'), sep)
    return rows[0].length >= 2 && rows.every((row) => row.length === rows[0].length)
  } catch {
    return false
  }
}

// Base64 of readable text only: plain words such as "password" also fit the alphabet.
function isBase64Text(text) {
  if (!BASE64.test(text) || /^[a-z]+$/i.test(text)) return false
  try {
    const decoded = bytesToText(base64ToBytes(text))
    return decoded !== null && /^[\p{L}\p{N}\p{P}\p{S}\s]+$/u.test(decoded) && !/[\u0000-\u0008\u000e-\u001f]/.test(decoded)
  } catch {
    return false
  }
}

export function detect(value) {
  const text = value.trim()
  if (!text) return null
  if (HIDDEN.test(value)) return 'chars'
  if (CURL.test(text)) return 'curl'
  if (PEM.test(text) && !/PRIVATE KEY/.test(text)) return 'cert'
  if (BCRYPT.test(text)) return 'bcrypt'
  if (DATA_URI.test(text)) return 'image'
  if (CSS_LENGTH.test(text)) return 'cssunits'
  if (SQL.test(text)) return 'sql'
  if (JWT.test(text)) return 'jwt'
  if (UUID.test(text) || ULID.test(text)) return 'ids'
  if (IPV4_CIDR.test(text) || IPV6_CIDR.test(text)) return 'cidr'
  if (TIMESTAMP.test(text) || ISO_DATE.test(text)) return 'time'
  if (HEX_COLOR.test(text) || COLOR_FN.test(text)) return 'color'
  if (PREFIXED_NUMBER.test(text)) return 'number'
  if (SYMBOLIC_MODE.test(text)) return 'chmod'
  if (isJson(text)) return 'json'
  if (XML.test(text) && isXml(text)) return 'xml'
  if (SIZE.test(text)) return 'units'
  if (DURATION.test(text) && /\d/.test(text)) return 'units'
  if (text.includes('\n') && YAML_KEY.test(text) && isYaml(text)) return 'yaml'
  if (isCsv(text)) return 'csv'
  if (URL_LIKE.test(text)) return 'url'
  if (isCron(text)) return 'cron'
  if (!/\s/.test(text) && PERCENT.test(text)) return 'url'
  if (isBase64Text(text)) return 'base64'
  if (ESCAPED.test(text)) return 'escape'
  return null
}
