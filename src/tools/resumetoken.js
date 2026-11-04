// Decodes a MongoDB change stream resume token. The token's `_data` is a hex-encoded KeyString (the
// byte format MongoDB uses for index keys): a few values in a fixed order, then the document key.
// The reader is written from the format itself. Values come back as Extended JSON (relaxed), so the
// result can be printed as it is: {"$oid": …}, {"$date": …}, {"$numberLong": "…"} and so on.
const MAX_HEX = 1 << 20 // hex digits (1 MiB), i.e. 512 KiB of bytes
const MAX_TEXT = 4 << 20 // characters of pasted text, which may be a whole change event
const MAX_DEPTH = 200 // nested objects and arrays
const MAX_VALUES = 20000 // values in one token: the Extended JSON stays under about a million characters
const MAX_WEIGHT = 400000 // the same, counting each value once per level it is nested
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const TWO_63 = 1n << 63n
const TWO_62 = 1n << 62n
const ALL_ONES = (1n << 64n) - 1n
const DECODER = new TextDecoder('utf-8', { ignoreBOM: true })
const FLOAT = new DataView(new ArrayBuffer(8))
const HEX = new Int8Array(128).fill(-1)
for (let i = 0; i < 10; i++) HEX[48 + i] = i
for (let i = 0; i < 6; i++) HEX[65 + i] = HEX[97 + i] = 10 + i

function fail(message) {
  throw new Error(message)
}

// The input, cut to 120 characters, as JSON text for an error message.
function shown(text) {
  return JSON.stringify(text.length > 120 ? `${text.slice(0, 120)}…` : text)
}

function bytesFromHex(hex) {
  if (hex.length > MAX_HEX) fail(`The token is too long: at most ${MAX_HEX} hex digits are read.`)
  if (hex.length % 2) fail(`A hex token has an even number of digits, but this one has ${hex.length}.`)
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    const high = HEX[hex.charCodeAt(2 * i)] ?? -1
    const low = HEX[hex.charCodeAt(2 * i + 1)] ?? -1
    if (high < 0 || low < 0) {
      const at = high < 0 ? 2 * i : 2 * i + 1
      fail(`Only hex digits (0-9, a-f) are allowed, but position ${at} holds ${shown(String.fromCodePoint(hex.codePointAt(at)))}.`)
    }
    bytes[i] = (high << 4) | low
  }
  return bytes
}

// ---- the reader: `s` is { b: bytes, p: next position }; every read checks what is left ----

function need(s, count) {
  if (s.b.length - s.p < count) fail(`The token is cut off: ${count} more byte${count === 1 ? ' is' : 's are'} needed at offset ${s.p}.`)
}

function byte(s) {
  need(s, 1)
  return s.b[s.p++]
}

// `count` (up to 8) big-endian bytes as a BigInt, each XOR `mask` (0xff for a negative number).
function uint(s, count, mask = 0) {
  need(s, count)
  let value = 0n
  for (let i = 0; i < count; i++) value = (value << 8n) | BigInt(s.b[s.p++] ^ mask)
  return value
}

function skip(s, count) {
  need(s, count)
  s.p += count
}

function bytesOf(s, count) {
  need(s, count)
  const bytes = s.b.subarray(s.p, s.p + count)
  s.p += count
  return bytes
}

// UTF-8 up to a 0x00 byte. In a string, 0x00 followed by 0xFF stands for a NUL character.
function text(s, escapes) {
  const parts = []
  let start = s.p
  for (;;) {
    const end = s.b.indexOf(0, s.p)
    if (end < 0) fail(`The token is cut off: a text value starting at offset ${start} has no end.`)
    parts.push(DECODER.decode(s.b.subarray(start, end)))
    if (escapes && s.b[end + 1] === 0xff) {
      parts.push('\0')
      s.p = start = end + 2
    } else {
      s.p = end + 1
      return parts.join('')
    }
  }
}

function hexOf(bytes) {
  let out = ''
  for (const b of bytes) out += (b < 16 ? '0' : '') + b.toString(16)
  return out
}

function doubleFromBits(bits) {
  FLOAT.setBigUint64(0, bits)
  return FLOAT.getFloat64(0)
}

function double(value) {
  if (Number.isNaN(value)) return { $numberDouble: 'NaN' }
  if (value === Infinity) return { $numberDouble: 'Infinity' }
  if (value === -Infinity) return { $numberDouble: '-Infinity' }
  return value === 0 ? 0 : value // -0 is shown as 0
}

function integer(magnitude, negative) {
  if (magnitude <= MAX_SAFE) return negative && magnitude ? -Number(magnitude) : Number(magnitude)
  return { $numberLong: String(negative ? -magnitude : magnitude) }
}

// Numbers: types 43..50 (positive) and 39..32 (negative) hold 1..8 bytes of whole number, with an optional fraction.
function wholeNumber(s, count, negative) {
  const mask = negative ? 0xff : 0
  const e = uint(s, count, mask)
  const magnitude = e >> 1n
  if (!(e & 1n)) return integer(magnitude, negative)
  const extra = 8 - count
  let f = magnitude
  let marker = 3n
  if (extra) {
    f = (magnitude << BigInt(8 * extra)) | uint(s, extra, mask)
    marker = f & 3n
  }
  if (marker !== 0n && marker !== 2n) skip(s, 8) // a Decimal128 carries 8 more bytes
  const value = Number(f & -4n) * 2 ** (-8 * extra)
  return double(negative ? -value : value)
}

function largeNumber(s, negative) {
  const e = uint(s, 8, negative ? 0xff : 0)
  let value = Infinity
  if (e < TWO_63) {
    value = doubleFromBits((e >> 1n) | TWO_62)
    if (e & 1n) skip(s, 8)
  } else if (e !== ALL_ONES) {
    skip(s, 8)
  }
  return double(negative ? -value : value)
}

function smallNumber(s, negative) {
  const e = uint(s, 8, negative ? 0xff : 0)
  const kind = e >> 62n
  let value = 0
  if (kind === 0n) {
    skip(s, 8)
  } else if (kind === 3n) {
    value = doubleFromBits(e >> 2n)
  } else {
    value = doubleFromBits((e - TWO_62) >> 1n) * 2 ** -256
    if (e & 1n) skip(s, 8)
  }
  return double(negative ? -value : value)
}

function binary(s) {
  let length = byte(s)
  if (length === 0xff) length = Number(uint(s, 4))
  const subType = byte(s)
  return { subType, bytes: bytesOf(s, length) }
}

function binaryValue({ subType, bytes }) {
  if (subType === 4 && bytes.length === 16) {
    const hex = hexOf(bytes)
    return { $uuid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` }
  }
  return { $binary: { base64: base64(bytes), subType: hexOf([subType]) } }
}

function base64(bytes) {
  let binaryText = ''
  for (let i = 0; i < bytes.length; i += 8192) binaryText += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binaryText)
}

function timestamp(s) {
  return { t: Number(uint(s, 4)), i: Number(uint(s, 4)) }
}

function date(s) {
  const ms = BigInt.asIntN(64, uint(s, 8) ^ TWO_63)
  const year = ms >= 0n && ms < 253402300800000n // 1970 to 9999: relaxed Extended JSON uses ISO text
  return { $date: year ? new Date(Number(ms)).toISOString() : { $numberLong: String(ms) } }
}

function setField(object, name, value) {
  Object.defineProperty(object, name, { value, enumerable: true, writable: true, configurable: true }) // `__proto__` stays a plain key
}

// Each decoded object's [name, value] pairs in token order. A JavaScript object moves whole-number names
// to the front and merges duplicates, so toExtendedJson writes from these pairs.
const ORDER = new WeakMap()

function object(s, depth) {
  if (depth > MAX_DEPTH) fail(`Objects and arrays nest more than ${MAX_DEPTH} levels deep.`)
  const result = {}
  const pairs = []
  ORDER.set(result, pairs)
  for (;;) {
    let type = byte(s)
    if (type === 0x01 || type === 0xfe) type = byte(s)
    if (type === 0x00 || type === 0x04) return result
    const name = text(s, false)
    const item = value(s, byte(s), depth + 1)
    pairs.push([name, item])
    setField(result, name, item)
  }
}

function array(s, depth) {
  if (depth > MAX_DEPTH) fail(`Objects and arrays nest more than ${MAX_DEPTH} levels deep.`)
  const result = []
  for (;;) {
    const type = byte(s)
    if (type === 0x00) return result
    result.push(value(s, type, depth + 1))
  }
}

function value(s, type, depth) {
  s.count++
  s.weight += depth + 1
  if (s.count > MAX_VALUES || s.weight > MAX_WEIGHT) fail(`The token holds too many values (20,000 at most, fewer when deeply nested).`)
  switch (type) {
    case 10: return { $minKey: 1 }
    case 240: return { $maxKey: 1 }
    case 15: return { $undefined: true }
    case 20: return null
    case 110: return false
    case 111: return true
    case 120: return date(s)
    case 130: return { $timestamp: timestamp(s) }
    case 100: return { $oid: hexOf(bytesOf(s, 12)) }
    case 60: return text(s, true)
    case 160: return { $code: text(s, true) }
    case 170: {
      const code = text(s, true)
      return { $code: code, $scope: object(s, depth + 1) }
    }
    case 90: return binaryValue(binary(s))
    case 140: {
      const pattern = text(s, false)
      return { $regularExpression: { pattern, options: text(s, false) } }
    }
    case 150: {
      const ns = DECODER.decode(bytesOf(s, Number(uint(s, 4))))
      return { $ref: ns, $id: { $oid: hexOf(bytesOf(s, 12)) } }
    }
    case 70: return object(s, depth)
    case 80: return array(s, depth)
    case 30: return { $numberDouble: 'NaN' }
    case 41: return 0
    case 42: return smallNumber(s, false)
    case 40: return smallNumber(s, true)
    case 51: return largeNumber(s, false)
    case 31: return largeNumber(s, true)
    default:
      if (type >= 43 && type <= 50) return wholeNumber(s, type - 42, false)
      if (type >= 32 && type <= 39) return wholeNumber(s, 40 - type, true)
      return fail(`Unknown value type byte ${type} (0x${type.toString(16).padStart(2, '0')}) at offset ${s.p - 1}.`)
  }
}

// ---- the token: the fixed list of values of D2 ----

// The type byte of the next top-level value, or -1 at the end byte 0x04. 0x01 and 0xFE are order bytes.
function nextType(s) {
  let type = byte(s)
  if (type === 0x01 || type === 0xfe) type = byte(s)
  return type === 0x04 ? -1 : type
}

function numberField(s, name) {
  const type = nextType(s)
  if (type < 0) fail(`The token ends before the ${name}.`)
  const number = type >= 30 && type <= 51 ? value(s, type, 0) : undefined
  if (typeof number !== 'number') fail(`The ${name} must be a number that fits in 53 bits.`)
  return number
}

function decodeBytes(bytes) {
  const s = { b: bytes, p: 0, count: 0, weight: 0 }
  if (nextType(s) !== 130) fail('A resume token starts with a Timestamp (type byte 130): this does not look like one.')
  const result = { timestamp: timestamp(s) }
  const version = numberField(s, 'version')
  result.version = version
  if (version >= 1) result.tokenType = numberField(s, 'token type')
  result.txnOpIndex = numberField(s, 'txnOpIndex')
  if (version >= 1) {
    const type = nextType(s)
    if (type !== 110 && type !== 111) fail('The fromInvalidate field must be true or false.')
    result.fromInvalidate = type === 111
  }
  let type = nextType(s)
  if (type >= 0) {
    if (type === 90) {
      const { subType, bytes: data } = binary(s)
      if (subType !== 4 || data.length !== 16) fail('The collection UUID must be a 16-byte BinData of subtype 4.')
      result.uuid = binaryValue({ subType, bytes: data }).$uuid
    } else if (type !== 20) {
      fail('The collection UUID must be BinData or null.')
    }
    type = nextType(s)
    if (type >= 0) {
      result[version === 2 ? 'eventIdentifier' : 'documentKey'] = value(s, type, 0)
      if (s.p >= bytes.length) fail('The token is cut off: the end byte 0x04 is missing.')
    }
  }
  return result
}

// What mongosh prints is not JSON: `{ _id: { _data: '8261…' }, … }`. These find the quoted hex after `_data`.
const SHELL_TOP = /^\{\s*["']?_data["']?\s*:\s*(["'])([^"']*)\1/
const SHELL_ID = /["']?_id["']?\s*:\s*\{\s*["']?_data["']?\s*:\s*(["'])([^"']*)\1/

/**
 * The hex string inside `input`: bare hex (also in one pair of quotes), `{"_data": …}`, an event
 * `{"_id": {"_data": …}, …}`, or either as mongosh prints it, with bare keys and single quotes. Throws an Error.
 */
export function tokenHex(input) {
  const trimmed = input.trim()
  if (trimmed === '') fail('Paste a resume token: hex such as 8261…, or JSON such as {"_data": "8261…"}.')
  if (trimmed[0] !== '{') {
    const quote = trimmed[0]
    return (quote === '"' || quote === "'") && trimmed.length > 1 && trimmed.endsWith(quote) ? trimmed.slice(1, -1).trim() : trimmed
  }
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    const shell = SHELL_TOP.exec(trimmed) ?? SHELL_ID.exec(trimmed)
    if (shell) return shell[2].trim()
    return fail('This looks like JSON but does not parse. Expected {"_data": "8261…"}.')
  }
  const own = (target, key) => (target !== null && typeof target === 'object' && Object.hasOwn(target, key) ? target[key] : undefined)
  const data = own(parsed, '_data') ?? own(own(parsed, '_id'), '_data')
  if (typeof data !== 'string') fail('The JSON has no "_data" string, neither at the top nor inside "_id".')
  return data.trim()
}

/**
 * The fields of a resume token: { timestamp: {t, i}, version, tokenType, txnOpIndex, fromInvalidate,
 * uuid, documentKey | eventIdentifier } (the last three only when the token holds them), the document
 * key as Extended JSON. Throws an Error with an English message on anything else.
 */
export function decodeResumeToken(input) {
  if (typeof input !== 'string') fail('A resume token is text: hex, or JSON with "_data".')
  if (input.length > MAX_TEXT) fail(`The text is too long: at most ${MAX_TEXT} characters are read.`)
  try {
    return decodeBytes(bytesFromHex(tokenHex(input)))
  } catch (error) {
    // Anything but our own message (such as a JavaScript RangeError) becomes a plain one.
    if (error?.constructor === Error) throw error
    return fail('This is not a resume token that can be read.')
  }
}

/** The Extended JSON text of a decoded value, indented by 2, with object fields in token order. */
export function toExtendedJson(value) {
  const out = []
  write(out, value, '')
  return out.join('')
}

function write(out, value, indent) {
  if (value === null || typeof value !== 'object') {
    out.push(JSON.stringify(value))
    return
  }
  const list = Array.isArray(value)
  const entries = list ? value : ORDER.get(value) ?? Object.entries(value)
  if (!entries.length) {
    out.push(list ? '[]' : '{}')
    return
  }
  const inner = `${indent}  `
  out.push(list ? '[\n' : '{\n')
  entries.forEach((entry, at) => {
    out.push(inner)
    if (!list) out.push(`${JSON.stringify(entry[0])}: `)
    write(out, list ? entry : entry[1], inner)
    out.push(at < entries.length - 1 ? ',\n' : '\n')
  })
  out.push(indent + (list ? ']' : '}'))
}
