// A KeyString encoder for the resume-token tests: the reverse of src/tools/resumetoken.js, written from the
// same format notes. It takes the Extended JSON shapes the decoder returns, so decode(encode(x)) can be checked.
const TWO_62 = 1n << 62n
const TWO_63 = 1n << 63n
const ENCODER = new TextEncoder()
const FLOAT = new DataView(new ArrayBuffer(8))

/** A small seeded random generator (mulberry32): the same seed always gives the same values. */
export function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next.int = (max) => Math.floor(next() * max) // 0 .. max - 1
  next.pick = (list) => list[next.int(list.length)]
  next.bytes = (count) => Uint8Array.from({ length: count }, () => next.int(256))
  next.bigint = (bits) => {
    let value = 0n
    for (let i = 0; i < bits; i += 8) value = (value << 8n) | BigInt(next.int(256))
    return value & ((1n << BigInt(bits)) - 1n)
  }
  return next
}

const bitsOf = (double) => {
  FLOAT.setFloat64(0, double)
  return FLOAT.getBigUint64(0)
}
const be = (value, count, mask = 0) => Array.from({ length: count }, (_, i) => Number((value >> BigInt(8 * (count - 1 - i))) & 0xffn) ^ mask)
const utf8 = (text) => [...ENCODER.encode(text)]
const cstring = (text) => [...utf8(text), 0]
const escaped = (text) => [...utf8(text).flatMap((b) => (b === 0 ? [0, 0xff] : [b])), 0]
const hexBytes = (hex) => hex.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? []

/**
 * A number. `tail` adds the 8 extra bytes a Decimal128 carries after the double (the decoder skips them).
 * Throws on a double the format cannot hold exactly (the tests only build ones it can).
 */
export function encodeNumber(n, tail = null) {
  const extra = (flag) => (flag && tail ? [...tail] : [])
  if (typeof n === 'number' && Number.isNaN(n)) return [30]
  if (n === 0 || n === 0n) return [41]
  const negative = n < 0
  const mask = negative ? 0xff : 0
  const whole = (magnitude) => {
    const e = magnitude << 1n
    let count = 1
    while (e >= 1n << BigInt(8 * count)) count++
    return [negative ? 40 - count : 42 + count, ...be(e, count, mask)]
  }
  if (typeof n === 'bigint') return whole(negative ? -n : n)
  if (n === Infinity || n === -Infinity) return [negative ? 31 : 51, ...be((1n << 64n) - 1n, 8, mask)]
  const a = Math.abs(n)
  if (Number.isInteger(a) && a < 2 ** 63) return whole(BigInt(a))
  if (a >= 2 ** 63) {
    const e = ((bitsOf(a) & ~TWO_62) << 1n) | (tail ? 1n : 0n)
    return [negative ? 31 : 51, ...be(e, 8, mask), ...extra(true)]
  }
  const ip = Math.floor(a)
  const frac = a - ip
  const ipBig = BigInt(ip)
  for (let count = 1; count < 8; count++) {
    if (((ipBig << 1n) | 1n) >= 1n << BigInt(8 * count)) continue
    const room = 8 * (8 - count) - 2
    const scaled = frac * 2 ** room
    if (!Number.isInteger(scaled)) continue
    const fraction = BigInt(scaled) << 2n
    const marker = tail ? (negative ? 3n : 1n) : 0n // 1 and 3 announce a Decimal128 tail
    const e = (ipBig << 1n) | 1n
    const head = [negative ? 40 - count : 42 + count, ...be(e, count, mask), ...be(fraction | marker, 8 - count, mask)]
    return marker ? [...head, ...tail] : head
  }
  if (a >= 2 ** -255) { // [2^-255, 2): the bits of the double, top two bits of the field set
    return [negative ? 40 : 42, ...be((bitsOf(a) << 2n) | 3n, 8, mask)]
  }
  const e = ((bitsOf(a * 2 ** 256) << 1n) | (tail ? 1n : 0n)) + TWO_62
  return [negative ? 40 : 42, ...be(e, 8, mask), ...extra(true)]
}

/** An object given as [name, value] pairs: the fields keep this order, and a name may repeat. */
export class Fields {
  constructor(pairs) {
    this.pairs = pairs
  }
}

/** A value as bytes: its type byte first, then its data. */
export function encodeValue(x, options = {}) {
  const { tail = null } = options
  if (x === null) return [20]
  if (x instanceof Fields) return [70, ...encodeFields(x.pairs, options)]
  if (x.$raw !== undefined) return hexBytes(x.$raw) // bytes as they are, for numbers the encoder does not produce
  if (x === true) return [111]
  if (x === false) return [110]
  if (typeof x === 'number' || typeof x === 'bigint') return encodeNumber(x, tail)
  if (typeof x === 'string') return [60, ...escaped(x)]
  if (Array.isArray(x)) return [80, ...x.flatMap((item) => encodeValue(item, options)), 0]
  if ('$minKey' in x) return [10]
  if ('$maxKey' in x) return [240]
  if ('$undefined' in x) return [15]
  if ('$numberDouble' in x) return encodeNumber({ NaN, Infinity, '-Infinity': -Infinity }[x.$numberDouble], tail)
  if ('$numberLong' in x) return encodeNumber(BigInt(x.$numberLong))
  if ('$oid' in x) return [100, ...hexBytes(x.$oid)]
  if ('$date' in x) {
    const ms = typeof x.$date === 'string' ? BigInt(Date.parse(x.$date)) : BigInt(x.$date.$numberLong)
    return [120, ...be(BigInt.asUintN(64, ms) ^ TWO_63, 8)]
  }
  if ('$timestamp' in x) return [130, ...be(BigInt(x.$timestamp.t), 4), ...be(BigInt(x.$timestamp.i), 4)]
  if ('$uuid' in x) return encodeBinary(4, hexBytes(x.$uuid.replaceAll('-', '')))
  if ('$binary' in x) return encodeBinary(parseInt(x.$binary.subType, 16), [...Buffer.from(x.$binary.base64, 'base64')])
  if ('$regularExpression' in x) return [140, ...cstring(x.$regularExpression.pattern), ...cstring(x.$regularExpression.options)]
  if ('$ref' in x) return [150, ...be(BigInt(utf8(x.$ref).length), 4), ...utf8(x.$ref), ...hexBytes(x.$id.$oid)]
  if ('$scope' in x) return [170, ...escaped(x.$code), ...encodeFields(x.$scope, options)]
  if ('$code' in x) return [160, ...escaped(x.$code)]
  return [70, ...encodeFields(x, options)]
}

function encodeBinary(subType, bytes) {
  const length = bytes.length < 255 ? [bytes.length] : [0xff, ...be(BigInt(bytes.length), 4)]
  return [90, ...length, subType].concat(bytes)
}

// The fields of an object: field type byte, name, value (type byte and data), then 0x00.
function encodeFields(object, options) {
  const out = []
  for (const [name, item] of Array.isArray(object) ? object : Object.entries(object)) {
    const bytes = encodeValue(item, options)
    const order = options.fieldOrderBytes?.()
    if (order) out.push(order)
    out.push(bytes[0], ...cstring(name))
    for (const b of bytes) out.push(b) // not `push(...bytes)`: a long BinData would overflow the stack
  }
  out.push(0)
  return out
}

/**
 * A resume token as upper-case hex. `fields`: t, i, version, tokenType, txnOpIndex, fromInvalidate,
 * uuid (a dashed string, null or undefined) and key (the documentKey, or the eventIdentifier for version 2).
 * `options.trailer`: bytes after the end byte (type bits); `options.orderBytes` and `options.fieldOrderBytes`:
 * functions giving 0x01/0xFE or 0, called before each top-level value and before each object field.
 */
export function encodeToken(fields, options = {}) {
  const { t = 1630438675, i = 1, version = 1, tokenType = 128, txnOpIndex = 0, fromInvalidate = false, uuid, key } = fields
  const order = () => options.orderBytes?.() || null
  const top = (bytes) => (order() ? [order(), ...bytes] : bytes)
  const out = [...top([130, ...be(BigInt(t), 4), ...be(BigInt(i), 4)]), ...top(encodeNumber(version))]
  if (version >= 1) out.push(...top(encodeNumber(tokenType)))
  out.push(...top(encodeNumber(txnOpIndex)))
  if (version >= 1) out.push(...top([fromInvalidate ? 111 : 110]))
  if (uuid !== undefined) out.push(...top(uuid === null ? [20] : encodeBinary(4, hexBytes(uuid.replaceAll('-', '')))))
  if (key !== undefined) for (const b of top(encodeValue(key, options))) out.push(b)
  out.push(4, ...(options.trailer ?? []))
  return Buffer.from(out).toString('hex').toUpperCase()
}

const WORDS = ['_id', 'a', 'name', 'x y', 'k', 'ключ', '日本語', '😀', '__proto__', 'constructor', '$set', 'é', '']
// A random string with NUL, multi-byte UTF-8 (2, 3 and 4 bytes) and plain ASCII.
function randomString(rand) {
  const pieces = ['a', 'Z', '_', ' ', '\u0000', 'é', 'ñ', '日', '€', '😀', '\u{10FFFF}', '\u0001', '\u00ff', '\u007f']
  if (!rand.noProto) pieces.push('\ufeff') // the reference decoder drops a byte order mark at the start of a piece
  let out = ''
  for (let n = rand.int(12); n > 0; n--) out += rand.pick(pieces)
  return out
}

function randomNumber(rand) {
  const n = randomNumberRaw(rand)
  // A whole double beyond 2^53 and below 2^63 is stored as an integer, so it reads back as $numberLong.
  return typeof n === 'number' && Number.isInteger(n) && Math.abs(n) > Number.MAX_SAFE_INTEGER && Math.abs(n) < 2 ** 63 ? { $numberLong: String(BigInt(n)) } : n
}

function randomNumberRaw(rand) {
  switch (rand.int(10)) {
    case 0: return rand.int(2001) - 1000 // small whole numbers
    case 1: { // whole numbers of every byte length, negative too
      const magnitude = rand.bigint(1 + rand.int(62))
      const value = rand.int(2) ? -magnitude : magnitude
      return value >= -9007199254740991n && value <= 9007199254740991n ? Number(value) : { $numberLong: String(value) }
    }
    case 2: return (rand.int(2) ? -1 : 1) * (rand.int(1 << 20) + rand.int(1 << 12) / 4096) // a short fraction
    case 3: return (rand.int(2) ? -1 : 1) * rand.int(100000) / 10 ** (1 + rand.int(4)) // 0.1-like: needs many bits
    case 4: return rand.pick([NaN, Infinity, -Infinity]) // placed as {$numberDouble} below
    case 5: { // a double from random bits, of any magnitude
      for (;;) {
        const bits = (rand.bigint(64) & ~(0x7ffn << 52n)) | (BigInt(rand.int(0x7ff)) << 52n)
        const view = new DataView(new ArrayBuffer(8))
        view.setBigUint64(0, bits)
        const value = view.getFloat64(0)
        if (!Number.isFinite(value)) continue
        return value === 0 ? 0 : value
      }
    }
    case 6: return (rand.int(2) ? -1 : 1) * 2 ** (rand.int(2100) - 1074) // powers of two: tiny, huge, subnormal
    case 7: return (rand.int(2) ? -1 : 1) * rand() * 2 ** (rand.int(40) - 20) // a random fraction below or above 1
    case 8: return (rand.int(2) ? -1 : 1) * (rand.int(300) + 0.5)
    default: return rand.int(2) ? 0 : (rand.int(2) ? -1 : 1) * rand.int(256)
  }
}

/** A random Extended JSON value covering every type the decoder reads, with nested objects and arrays. */
export function randomValue(rand, depth = 0) {
  const leaf = depth >= 3
  switch (rand.int(leaf ? 18 : 22)) {
    case 0: return { $minKey: 1 }
    case 1: return { $maxKey: 1 }
    case 2: return { $undefined: true }
    case 3: return null
    case 4: return rand.int(2) === 0
    case 5: case 6: case 7: {
      const n = randomNumber(rand)
      return typeof n === 'number' && !Number.isFinite(n) ? { $numberDouble: String(n) } : n
    }
    case 8: case 9: return randomString(rand)
    case 10: return { $oid: Buffer.from(rand.bytes(12)).toString('hex') }
    case 11: {
      let ms = BigInt(rand.int(2) ? rand.int(2 ** 40) * 1000 : Math.floor((rand() - 0.5) * 2 ** 53)) * (rand.int(3) ? 1n : 1000n)
      if (rand.noProto) ms = (ms < 0n ? -ms : ms) % 8640000000000000n // the reference decoder reads a date before 1970, or beyond year 275760, as invalid
      const inRange = ms >= 0n && ms < 253402300800000n
      return { $date: inRange ? new Date(Number(ms)).toISOString() : { $numberLong: String(ms) } }
    }
    case 12: return { $timestamp: { t: rand.int(2 ** 32), i: rand.int(2 ** 32) } }
    case 13: { // BinData: short, long (more than 255 bytes), any subtype
      const length = rand.pick([0, 1, 16, 254, 255, 256, 300, 1000])
      const bytes = rand.bytes(length)
      const subType = rand.pick([0, 4, 5, 128])
      if (subType === 4 && length === 16) {
        const hex = Buffer.from(bytes).toString('hex')
        return { $uuid: [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-') }
      }
      return { $binary: { base64: Buffer.from(bytes).toString('base64'), subType: subType.toString(16).padStart(2, '0') } }
    }
    case 14: return { $regularExpression: { pattern: rand.pick(['^a.*$', '[a-z]+', 'é日', '']), options: rand.pick(['', 'i', 'im', 'imsx']) } }
    case 15: return { $code: randomString(rand) }
    case 16: return { $ref: rand.pick(['db.coll', 'a', 'é.日本', 'x'.repeat(40)]), $id: { $oid: Buffer.from(rand.bytes(12)).toString('hex') } }
    case 17: return { $code: randomString(rand), $scope: randomObject(rand, depth + 1) }
    case 18: case 19: return randomObject(rand, depth + 1)
    default: return Array.from({ length: rand.int(5) }, () => randomValue(rand, depth + 1))
  }
}

function randomObject(rand, depth) {
  const object = {}
  for (let n = rand.int(5); n > 0; n--) {
    const name = rand.pick(rand.noProto ? WORDS.filter((word) => word !== '__proto__') : WORDS) + (rand.int(2) ? rand.int(100) : '')
    Object.defineProperty(object, name, { value: randomValue(rand, depth), enumerable: true, writable: true, configurable: true })
  }
  return object
}

/** A random token (set `rand.noProto` to avoid what the reference decoder gets wrong): its fields, and the options for encodeToken (type bits, order bytes, Decimal128 tails). */
export function randomToken(rand, fieldOrder = false) {
  const version = rand.pick([0, 1, 1, 1, 2])
  let key = version === 2 || rand.int(4) === 0 ? randomValue(rand) : { _id: randomValue(rand), ...(rand.int(3) === 0 ? { shard: randomValue(rand) } : {}) }
  if (rand.noProto && key?.$undefined) key = null // the reference decoder drops an undefined key
  const uuidHex = Buffer.from(rand.bytes(16)).toString('hex')
  const fields = {
    t: rand.int(2 ** 32), i: rand.int(2 ** 32), version,
    tokenType: rand.pick([128, 128, 0, 1, 300]), txnOpIndex: rand.pick([0, 0, 1, 2, 1000, 70000]), fromInvalidate: rand.int(5) === 0,
    uuid: rand.int(8) === 0 ? null : [uuidHex.slice(0, 8), uuidHex.slice(8, 12), uuidHex.slice(12, 16), uuidHex.slice(16, 20), uuidHex.slice(20)].join('-'),
    key
  }
  const options = {
    tail: rand.int(6) === 0 ? rand.bytes(8) : null,
    trailer: rand.int(5) === 0 ? [...rand.bytes(1 + rand.int(6))] : null,
    orderBytes: rand.int(8) === 0 ? () => rand.pick([0x01, 0xfe]) : null,
    fieldOrderBytes: fieldOrder && rand.int(8) === 0 ? () => rand.pick([0x00, 0x01, 0xfe]) : null
  }
  return { fields, options }
}
