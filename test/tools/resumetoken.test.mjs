import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { decodeResumeToken, toExtendedJson } from '../../src/tools/resumetoken.js'
import { Fields, encodeToken, rng, randomToken, randomValue } from '../helpers/keystring.mjs'

// The sample token in the README of the reference decoder, an npm package whose licence we do not take on.
const README = '82612E8513000000012B022C0100296E5A1004A5093ABB38FE4B9EA67F01BB1A96D812463C5F6964003C5F5F5F78000004'
const README_RESULT = {
  timestamp: { t: 1630438675, i: 1 }, version: 1, tokenType: 128, txnOpIndex: 0, fromInvalidate: false,
  uuid: 'a5093abb-38fe-4b9e-a67f-01bb1a96d812', documentKey: { _id: '___x' }
}
const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/resumetoken-oracle.json', import.meta.url), 'utf8'))
const SRC = new URL('../../src/tools/resumetoken.js', import.meta.url).href

// A document key holding `value` as its _id, in a version 1 token.
const keyed = (value, options) => encodeToken({ uuid: 'a5093abb-38fe-4b9e-a67f-01bb1a96d812', key: { _id: value } }, options)
const idOf = (value, options) => decodeResumeToken(keyed(value, options)).documentKey._id

test('the README token gives its fields (REQ-040)', () => {
  assert.deepStrictEqual(decodeResumeToken(README), README_RESULT)
})

test('the same token as lower case, padded, {"_data"} or an event gives the same result (REQ-040)', () => {
  for (const text of [
    README.toLowerCase(), `  ${README}\n`, `\t${README.toLowerCase()} `, `{"_data": "${README}"}`, `{ "_data" : "${README.toLowerCase()}" }`,
    ` {"_data":" ${README} "} `, `{"_id": {"_data": "${README}"}, "operationType": "insert"}`,
    `{"operationType": "insert", "_id": {"_data": "${README.toLowerCase()}"}, "fullDocument": {"_data": "zz", "n": [1, {"_id": 2}]}}`
  ]) assert.deepStrictEqual(decodeResumeToken(text), README_RESULT, text)
})

test('a version 2 token has an eventIdentifier and no documentKey; version 0 has no tokenType or fromInvalidate (REQ-040)', () => {
  const event = { operationType: 'insert', documentKey: { _id: { $oid: '507f191e810c19729de860ea' } } }
  const v2 = decodeResumeToken(encodeToken({ version: 2, uuid: 'a5093abb-38fe-4b9e-a67f-01bb1a96d812', key: event }))
  const { documentKey, ...fields } = README_RESULT
  assert.deepStrictEqual(v2, { ...fields, version: 2, eventIdentifier: event })
  assert.equal('documentKey' in v2, false)
  const v0 = decodeResumeToken(encodeToken({ version: 0, txnOpIndex: 3, uuid: null, key: { _id: 1 } }))
  assert.deepStrictEqual(v0, { timestamp: { t: 1630438675, i: 1 }, version: 0, txnOpIndex: 3, documentKey: { _id: 1 } })
  // A token that stops after the version-1 header (a high water mark) has neither uuid nor key.
  const hwm = decodeResumeToken(encodeToken({ tokenType: 0 }))
  assert.deepStrictEqual(hwm, { timestamp: { t: 1630438675, i: 1 }, version: 1, tokenType: 0, txnOpIndex: 0, fromInvalidate: false })
  // Type bits after the end byte are ignored.
  assert.deepStrictEqual(decodeResumeToken(`${README}0102030405`), README_RESULT)
})

test('toExtendedJson indents the Extended JSON (REQ-043)', () => {
  assert.equal(toExtendedJson({ _id: '___x' }), '{\n  "_id": "___x"\n}')
})

test('every token of the oracle fixture decodes to the value the npm package gave (REQ-041)', () => {
  assert.ok(FIXTURE.length >= 260, `${FIXTURE.length} tokens`) // the README, mongod, hand-made and 200 seeded ones
  assert.equal(FIXTURE[0].hex, README)
  for (const [index, { hex, expected }] of FIXTURE.entries()) {
    assert.deepStrictEqual(decodeResumeToken(hex), expected, `fixture entry ${index}: ${hex.slice(0, 120)}`)
  }
})

// Canonical Extended JSON, as mongosh printed the _id that was inserted, in the relaxed shape the decoder gives.
function relax(value) {
  if (Array.isArray(value)) return value.map(relax)
  if (value === null || typeof value !== 'object') return value
  if ('$numberInt' in value || '$numberDecimal' in value) return Number(value.$numberInt ?? value.$numberDecimal)
  if ('$numberDouble' in value) return Number.isFinite(Number(value.$numberDouble)) ? Number(value.$numberDouble) : value
  if ('$numberLong' in value) return BigInt(value.$numberLong) >= -9007199254740991n && BigInt(value.$numberLong) <= 9007199254740991n ? Number(value.$numberLong) : value
  if ('$date' in value) return { $date: new Date(Number(value.$date.$numberLong)).toISOString() }
  if ('$binary' in value && value.$binary.subType === '04') {
    const hex = Buffer.from(value.$binary.base64, 'base64').toString('hex')
    return { $uuid: [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-') }
  }
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, relax(item)]))
}

test('real tokens from a mongod 7.0 change stream give back the _id that was inserted (REQ-041)', () => {
  const real = FIXTURE.filter((entry) => entry.source?.startsWith('mongod 7.0 change stream, _id '))
  assert.ok(real.length >= 40, `${real.length} real tokens`)
  const kinds = new Set()
  for (const { hex, source } of real) {
    const inserted = JSON.parse(source.slice('mongod 7.0 change stream, _id '.length))
    const token = decodeResumeToken(hex)
    assert.equal(token.version, 2)
    assert.equal(token.eventIdentifier.operationType, 'insert')
    const want = relax(inserted)
    assert.deepStrictEqual(token.eventIdentifier.documentKey._id, want, source)
    const first = want !== null && typeof want === 'object' ? Object.keys(want)[0] : undefined
    kinds.add(first?.startsWith('$') ? first : typeof want)
  }
  for (const kind of ['$oid', 'string', 'number', 'object']) assert.ok(kinds.has(kind), kind)
})

test('the fixture covers every value type, number branch and token version (REQ-041)', () => {
  const text = JSON.stringify(FIXTURE.map((entry) => entry.expected))
  for (const tag of ['$minKey', '$maxKey', '$undefined', '$oid', '$date', '$timestamp', '$binary', '$uuid', '$regularExpression', '$code', '$scope', '$ref', '$numberLong', '$numberDouble']) {
    assert.ok(text.includes(`"${tag}"`), tag)
  }
  assert.deepEqual([...new Set(FIXTURE.map((entry) => entry.expected.version))].sort(), [0, 1, 2])
  const hex = FIXTURE.map((entry) => entry.hex).join(' ')
  assert.ok(FIXTURE.some((entry) => /\\u0000/.test(JSON.stringify(entry.expected))), 'a string with NUL')
  assert.ok(FIXTURE.some((entry) => /"base64":"[A-Za-z0-9+/=]{400,}"/.test(JSON.stringify(entry.expected))), 'BinData over 255 bytes')
  assert.ok(hex.length > 30000)
  const numbers = (value, out = []) => {
    if (typeof value === 'number') out.push(value)
    else if (value && typeof value === 'object') for (const item of Object.values(value)) numbers(item, out)
    return out
  }
  const all = FIXTURE.flatMap((entry) => numbers(entry.expected.documentKey ?? entry.expected.eventIdentifier))
  assert.ok(all.some((n) => n < 0 && Number.isInteger(n)) && all.some((n) => n > 0 && Number.isInteger(n)))
  assert.ok(all.some((n) => n < 0 && !Number.isInteger(n)) && all.some((n) => n > 0 && !Number.isInteger(n)))
  assert.ok(all.some((n) => Math.abs(n) > 1e18) && all.some((n) => n !== 0 && Math.abs(n) < 1e-18))
})

test('decode(encode(x)) = x on 6000 random values and tokens (REQ-041)', () => {
  const rand = rng(20261104)
  for (let n = 0; n < 6000; n++) {
    const value = randomValue(rand)
    assert.deepStrictEqual(idOf(value), value, `value ${n}: ${JSON.stringify(value).slice(0, 200)}`)
  }
  for (let n = 0; n < 1500; n++) {
    const { fields, options } = randomToken(rand, true) // also order bytes inside objects and Decimal128 tails
    const token = decodeResumeToken(encodeToken(fields, options))
    assert.deepStrictEqual(token.timestamp, { t: fields.t, i: fields.i })
    assert.equal(token.version, fields.version)
    assert.equal(token.txnOpIndex, fields.txnOpIndex)
    assert.equal(token.uuid, fields.uuid ?? undefined)
    assert.deepStrictEqual(token[fields.version === 2 ? 'eventIdentifier' : 'documentKey'], fields.key)
  }
})

test('numbers: every length of whole number, both signs, fractions and magnitudes (REQ-041)', () => {
  for (let bytes = 1; bytes <= 8; bytes++) {
    const top = (1n << BigInt(8 * bytes - 1)) - 1n // the largest value of that length
    for (const magnitude of [top, top >> 1n || 1n]) {
      for (const value of [magnitude, -magnitude]) {
        const expected = value >= -9007199254740991n && value <= 9007199254740991n ? Number(value) : { $numberLong: String(value) }
        assert.deepStrictEqual(idOf(expected), expected, String(value))
      }
    }
  }
  for (const value of [0.5, -0.5, 1.5, -1.5, 198.5, -198.5, -1000.125, 0.1, -0.1, 123456.789, -123456.789, 1e15 + 0.5, 3e-300, -3e-300, 5e-324, -5e-324, 1e300, -1e300, 1.7976931348623157e308, -1.7976931348623157e308, 2 ** -255, -(2 ** -255), 1.9999999999999998, 2 ** 63, 1e20, -1e20]) {
    assert.deepStrictEqual(idOf(value), value, String(value))
  }
  for (const text of ['NaN', 'Infinity', '-Infinity']) assert.deepStrictEqual(idOf({ $numberDouble: text }), { $numberDouble: text })
  assert.equal(idOf(0), 0)
  assert.equal(Object.is(idOf(-0), 0), true)
  assert.deepStrictEqual(idOf({ $numberLong: '9223372036854775807' }), { $numberLong: '9223372036854775807' })
  assert.deepStrictEqual(idOf({ $numberLong: '-9223372036854775807' }), { $numberLong: '-9223372036854775807' })
  assert.equal(idOf(9007199254740991), 9007199254740991)
  assert.deepStrictEqual(idOf({ $numberLong: '9007199254740993' }), { $numberLong: '9007199254740993' })
})

test('numbers: Decimal128 tails are skipped and odd magnitudes read as the format says (REQ-041)', () => {
  const tail = [1, 2, 3, 4, 5, 6, 7, 8]
  for (const value of [198.5, -198.5, 0.1, -0.1, 3e-300, -3e-300, 1e300, -1e300, 2 ** 70]) assert.equal(idOf(value, { tail }), value, String(value))
  const raw = (hex) => idOf({ $raw: hex })
  assert.deepStrictEqual(raw('338000000000000001' + '0102030405060708'), { $numberDouble: 'Infinity' }) // beyond a double: Infinity, 8 bytes skipped
  assert.deepStrictEqual(raw('1F' + '7FFFFFFFFFFFFFFE' + '0102030405060708'), { $numberDouble: '-Infinity' })
  assert.deepStrictEqual(raw('33' + '8000000000000000' + '0102030405060708'), { $numberDouble: 'Infinity' }) // top bit set, not all ones
  assert.equal(raw('2B' + '03' + '00000000000002'), 1) // a fraction whose marker bits are 2: a double, nothing to skip
  assert.equal(raw('2B' + '03' + '00000000000001' + '0102030405060708'), 1) // marker 1: a Decimal128 follows, 8 bytes skipped
  assert.deepStrictEqual(idOf({ $raw: '46' + '04' }), {}) // the end byte also ends an object
  assert.equal(raw('2A' + '0000000000000000' + '0102030405060708'), 0) // small magnitude: 0, 8 bytes skipped
  assert.equal(raw('28' + 'FFFFFFFFFFFFFFFF' + '0102030405060708'), 0)
})

test('a field named __proto__ or $oid stays a plain key (REQ-041)', () => {
  const hex = encodeToken({ uuid: null, key: JSON.parse('{"__proto__": {"polluted": true}, "constructor": 1, "toString": "x"}') })
  const decoded = decodeResumeToken(hex).documentKey
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype)
  assert.deepStrictEqual(Object.keys(decoded), ['__proto__', 'constructor', 'toString'])
  assert.equal(({}).polluted, undefined)
  assert.equal(JSON.parse(toExtendedJson(decoded)).constructor, 1)
})

test('DBRef decodes its namespace as UTF-8 (REQ-041)', () => {
  const ref = { $ref: 'db.é日', $id: { $oid: '507f191e810c19729de860ea' } }
  assert.deepStrictEqual(idOf(ref), ref)
})

const wrong = (text, pattern) => assert.throws(() => decodeResumeToken(text), (error) => {
  assert.equal(error.constructor, Error, `${error.constructor.name}: ${error.message}`) // not a RangeError or TypeError
  assert.ok(error.message.length <= 200, error.message)
  assert.match(error.message, pattern ?? /^[A-Z][\x20-\x7e…]+\.$/s)
  return true
})

test('wrong input throws an Error with a plain English message (REQ-042)', () => {
  wrong('', /Paste a resume token/)
  wrong('   ', /Paste a resume token/)
  wrong('826', /even number of digits/)
  wrong('zz', /Only hex digits/)
  wrong('82612E85g3', /Only hex digits.*position 8/)
  wrong('8261\u00e9\u00e9', /Only hex digits/)
  wrong('{"a": 1}', /no "_data"/)
  wrong('{"_data": 5}', /no "_data"/)
  wrong('{"_id": {"_data": null}}', /no "_data"/)
  wrong('{"_id": 5}', /no "_data"/)
  wrong('{"_data"', /does not parse/)
  wrong('{"_data": "82"}', /./)
  wrong('{"_data": "zz"}', /Only hex digits/)
  wrong('07', /starts with a Timestamp/)
  wrong(README.replace('003C5F5F5F78', '00075F5F5F78'), /Unknown value type byte 7/)
  wrong(README.replace('6E5A10', '075A10'), /must be true or false/)
  wrong(README.replace('2B022C0100', '6E022C0100'), /version must be a number/)
  wrong(README.replace('5A1004', '5A1005'), /UUID/)
  wrong(README.replace('6E5A10', '6E0710'), /UUID/)
  wrong(README.replace('463C5F6964003C5F5F5F78000004', '07'), /Unknown value type byte 7/)
  for (const bad of [undefined, null, 5, {}, []]) wrong(bad, /is text/)
})

test('a message copies at most 120 characters of the input (REQ-042)', () => {
  const long = 'x'.repeat(5000)
  for (const text of [long, `{"_data": "${long}"}`, `{"a": "${long}`, '12'.repeat(2500) + 'z']) {
    try {
      decodeResumeToken(text)
      assert.fail('should throw')
    } catch (error) {
      assert.ok(error.message.length <= 200, error.message.length)
      assert.ok(!error.message.includes('x'.repeat(121)))
    }
  }
})

test('a token cut at any position throws (REQ-042)', () => {
  for (let length = 0; length < README.length; length++) wrong(README.slice(0, length))
  assert.deepStrictEqual(decodeResumeToken(README), README_RESULT)
  // The same for a token with every kind of value, cut at every even position.
  const rand = rng(5)
  for (let n = 0; n < 40; n++) {
    const hex = encodeToken(randomToken(rand).fields)
    for (let length = 0; length < Math.min(hex.length, 600); length += 2) wrong(hex.slice(0, length))
  }
})

test('10000 random byte strings throw an Error, never a RangeError or TypeError (REQ-042)', () => {
  const rand = rng(42)
  for (let n = 0; n < 10000; n++) {
    wrong(Buffer.from(rand.bytes(rand.int(80))).toString('hex'))
  }
  // Random bytes behind a valid header: an Error, or a result when the bytes happen to make a token.
  for (let n = 0; n < 10000; n++) {
    const text = README.slice(0, 2 * (9 + rand.int(40))) + Buffer.from(rand.bytes(rand.int(60))).toString('hex')
    try {
      decodeResumeToken(text)
    } catch (error) {
      assert.equal(error.constructor, Error, `${error.constructor.name} for ${text}`)
      assert.ok(error.message.length <= 200)
    }
  }
  // And mutated copies of valid tokens.
  for (let n = 0; n < 3000; n++) {
    const bytes = Buffer.from(encodeToken(randomToken(rand).fields), 'hex')
    for (let flips = 1 + rand.int(3); flips > 0; flips--) bytes[rand.int(bytes.length)] = rand.int(256)
    try {
      decodeResumeToken(bytes.toString('hex'))
    } catch (error) {
      assert.equal(error.constructor, Error, `${error.constructor.name} for ${bytes.toString('hex')}`)
    }
  }
})

test('nesting deeper than 200 levels is an error, 190 is fine (REQ-042)', () => {
  const arrays = (levels) => encodeToken({ uuid: null, key: { $raw: '50'.repeat(levels) + '00'.repeat(levels) } })
  assert.ok(decodeResumeToken(arrays(190)))
  wrong(arrays(300), /nest more than 200 levels/)
  const objects = (levels) => encodeToken({ uuid: null, key: { $raw: '46' + ('4661' + '00' + '46').repeat(levels - 1) + '00'.repeat(levels) } })
  assert.ok(decodeResumeToken(objects(190)))
  wrong(objects(300), /nest more than 200 levels/)
})

// Runs `build` in a child process, which times only the decoding; the child has a hard timeout.
function inChild(build) {
  const script = `import { decodeResumeToken, toExtendedJson } from ${JSON.stringify(SRC)}
const input = (${build})()
const start = performance.now()
let outcome
try { const result = decodeResumeToken(input); outcome = 'result ' + toExtendedJson(result).length } catch (error) { outcome = error.constructor.name + ': ' + error.message.slice(0, 100) }
console.log(JSON.stringify({ ms: performance.now() - start, outcome }))`
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 30000, encoding: 'utf8', maxBuffer: 1 << 20 }))
}

test('1 MB of hex, valid or not, and 100000 nested levels finish in under 1000 ms (REQ-042)', () => {
  const header = README.slice(0, README.indexOf('463C'))
  const cases = {
    'valid hex, a million digits': `() => ${JSON.stringify(header)} + '29'.repeat(450000) + '04'`,
    'one big array of numbers': `() => ${JSON.stringify(header)} + '50' + '2B022C0100'.repeat(95000) + '0004'`,
    'a 500 KB string': `() => ${JSON.stringify(header)} + '3C' + '61'.repeat(480000) + '0004'`,
    'a 500 KB string full of NUL escapes': `() => ${JSON.stringify(header)} + '3C' + '00FF'.repeat(240000) + '0004'`,
    'invalid hex, 1 MB': `() => 'zz'.repeat(500000)`,
    'odd hex, 1 MB': `() => '8'.repeat(1048575)`,
    'hex over the limit': `() => '82'.repeat(600000)`,
    'a token cut in a 1 MB BinData': `() => ${JSON.stringify(header)} + '5AFF7FFFFFFF04' + 'AB'.repeat(500000)`,
    'objects nested 100000 deep': `() => ${JSON.stringify(header)} + '46' + ('4661' + '00' + '46').repeat(99999) + '00'.repeat(100000) + '04'`,
    'arrays nested 100000 deep': `() => ${JSON.stringify(header)} + '50'.repeat(100000) + '00'.repeat(100000) + '04'`,
    'JSON nested 100000 deep': `() => '{"_id":'.repeat(100000) + '1' + '}'.repeat(100000)`,
    'JSON arrays nested 100000 deep': `() => '{"_id": ' + '['.repeat(100000) + ']'.repeat(100000) + '}'`,
    'a valid 1 MB token: 200 nested arrays and 523000 nulls': `() => ${JSON.stringify(header)} + '50'.repeat(200) + '14'.repeat(523000) + '00'.repeat(200) + '04'`,
    '190 nested arrays and 20000 nulls': `() => ${JSON.stringify(header)} + '50'.repeat(190) + '14'.repeat(20000) + '00'.repeat(190) + '04'`,
    'a flat array of 19000 nulls': `() => ${JSON.stringify(header)} + '50' + '14'.repeat(19000) + '0004'`,
    'a million characters of JSON': `() => '{"_data": ' + JSON.stringify('82'.repeat(100) + 'zz'.repeat(450000)) + '}'`
  }
  for (const [name, build] of Object.entries(cases)) {
    const { ms, outcome } = inChild(build)
    assert.ok(ms < 1000, `${name}: ${ms.toFixed(0)} ms`)
    assert.doesNotMatch(outcome, /RangeError|TypeError/, name)
    const size = /^result (\d+)$/.exec(outcome)
    if (size) assert.ok(Number(size[1]) < 2000000, `${name}: ${size[1]} characters of output`)
  }
  // The reviewer's case is refused for its value count, the flat array is shown.
  assert.match(inChild(cases['a valid 1 MB token: 200 nested arrays and 523000 nulls']).outcome, /too many values/)
  assert.match(inChild(cases['190 nested arrays and 20000 nulls']).outcome, /too many values/)
  assert.match(inChild(cases['a flat array of 19000 nulls']).outcome, /^result \d+$/)
})

test('input over the limits is refused with a clear message (REQ-042)', () => {
  wrong('82'.repeat((1 << 19) + 1), /too long: at most 1048576 hex digits/)
  wrong(`{"_data": "${'82'.repeat((1 << 19) + 1)}"}`, /too long: at most 1048576 hex digits/)
  wrong(`{"_data": "82", "x": "${'a'.repeat(4 << 20)}"}`, /text is too long/)
  // Exactly the limit is read (and fails later, as 0x82 repeated is no token).
  assert.throws(() => decodeResumeToken('82'.repeat(1 << 19)), (error) => !/too long/.test(error.message))
})

test('an unexpected JavaScript error inside the reader still comes out as a plain Error (REQ-042)', () => {
  const original = TextDecoder.prototype.decode
  TextDecoder.prototype.decode = () => {
    throw new RangeError('Invalid typed array length: 4294967296')
  }
  try {
    wrong(README, /^This is not a resume token that can be read\.$/)
  } finally {
    TextDecoder.prototype.decode = original
  }
  assert.deepStrictEqual(decodeResumeToken(README), README_RESULT)
})

test('a token with too many values, or many values nested deeply, is refused (REQ-042)', () => {
  const header = README.slice(0, README.indexOf('463C'))
  const nulls = (nest, count) => `${header}${'50'.repeat(nest)}${'14'.repeat(count)}${'00'.repeat(nest)}04`
  assert.ok(decodeResumeToken(nulls(1, 19900)))
  wrong(nulls(1, 20001), /too many values \(20,000 at most/)
  wrong(nulls(190, 20000), /too many values/)
  assert.ok(decodeResumeToken(nulls(190, 500)))
  // The weight counts a value once per level: 4200 values at depth 100 are too many, 3800 are not.
  assert.ok(decodeResumeToken(nulls(100, 3800)))
  wrong(nulls(100, 4200), /too many values/)
  // What is shown stays small: at the cap, under a million characters.
  assert.ok(toExtendedJson(decodeResumeToken(nulls(1, 19900))).length < 1000000)
})

test('object fields keep the token order, even for whole-number names and repeated names (REQ-041)', () => {
  const fields = new Fields([['b', 1], ['10', 2], ['2', 3], ['b', 4], ['__proto__', 5], ['a', { $oid: '507f191e810c19729de860ea' }]])
  const key = decodeResumeToken(encodeToken({ uuid: null, key: new Fields([['_id', fields], ['2024', 'x'], ['1', 'y']]) })).documentKey
  assert.equal(toExtendedJson(key), `{
  "_id": {
    "b": 1,
    "10": 2,
    "2": 3,
    "b": 4,
    "__proto__": 5,
    "a": {
      "$oid": "507f191e810c19729de860ea"
    }
  },
  "2024": "x",
  "1": "y"
}`)
  // The same through an array, a code scope and an event identifier.
  const scope = decodeResumeToken(encodeToken({ version: 2, uuid: null, key: [new Fields([['9', 1], ['a', 2], ['1', 3]]), { $code: 'f', $scope: [['5', 1], ['x', 2], ['3', 3]] }] })).eventIdentifier
  assert.equal(toExtendedJson(scope), `[
  {
    "9": 1,
    "a": 2,
    "1": 3
  },
  {
    "$code": "f",
    "$scope": {
      "5": 1,
      "x": 2,
      "3": 3
    }
  }
]`)
  assert.equal(toExtendedJson({}), '{}')
  assert.equal(toExtendedJson([]), '[]')
  assert.equal(toExtendedJson({ a: [], b: {} }), '{\n  "a": [],\n  "b": {}\n}')
})

test('toExtendedJson is JSON.stringify with two-space indent for values that have no reordered names (REQ-043)', () => {
  const rand = rng(77)
  for (let n = 0; n < 500; n++) {
    const value = randomValue(rand)
    const decoded = idOf(value)
    assert.deepStrictEqual(JSON.parse(toExtendedJson(decoded)), decoded)
    if (!/"\d+":/.test(JSON.stringify(decoded))) assert.equal(toExtendedJson(decoded), JSON.stringify(decoded, null, 2))
  }
})

test('a Date reads as ISO from 1970 to 9999 and as $numberLong outside (REQ-041)', () => {
  const date = (ms) => idOf({ $date: { $numberLong: String(ms) } })
  assert.deepStrictEqual(date(0), { $date: '1970-01-01T00:00:00.000Z' })
  assert.deepStrictEqual(date(-1), { $date: { $numberLong: '-1' } })
  assert.deepStrictEqual(date(253402300799999), { $date: '9999-12-31T23:59:59.999Z' })
  assert.deepStrictEqual(date(253402300800000), { $date: { $numberLong: '253402300800000' } })
  assert.deepStrictEqual(date(-315619200000), { $date: { $numberLong: '-315619200000' } })
  assert.deepStrictEqual(date('9223372036854775807'), { $date: { $numberLong: '9223372036854775807' } })
  assert.deepStrictEqual(date('-9223372036854775808'), { $date: { $numberLong: '-9223372036854775808' } })
})

test('a BinData of 200000 bytes is read and written as base64 (REQ-041)', () => {
  const bytes = Buffer.from(Uint8Array.from({ length: 200000 }, (_, i) => (i * 31 + (i >> 8)) & 0xff))
  const value = { $binary: { base64: bytes.toString('base64'), subType: '00' } }
  assert.deepStrictEqual(idOf(value), value)
  for (const length of [254, 255, 256, 65535, 65536]) {
    const sized = { $binary: { base64: Buffer.alloc(length, 7).toString('base64'), subType: '80' } }
    assert.deepStrictEqual(idOf(sized), sized, String(length))
  }
})

test('the shell form and quoted hex are read too (REQ-040)', () => {
  const lower = README.toLowerCase()
  for (const text of [
    `{ _data: '${README}' }`, `{ _data: '  ${README}\n' }`, `{_data:"${lower}"}`, `{ "_data": '${README}' }`, `{ _id: { _data: '${README}' }, operationType: 'insert', ns: { db: 'a', coll: 'b' } }`,
    `{ operationType: 'insert', fullDocument: { _id: 1 }, _id: { _data: '${README}' } }`, `{ '_id': { '_data': '${README}' } }`,
    `"${README}"`, `'${lower}'`, `  ' ${README} '  `, `{"_data": "${README}"}`
  ]) assert.deepStrictEqual(decodeResumeToken(text), README_RESULT, text)
  // Anything else stays an error with a clear message.
  wrong(`{ _data: 5 }`, /does not parse/)
  wrong(`{ _data: '${README}`, /does not parse/)
  wrong(`{ _data: ${README} }`, /does not parse/)
  wrong(`{ data: '${README}' }`, /does not parse/)
  wrong(`"${README}`, /Only hex digits|even number/)
  wrong(`'${README}"`, /Only hex digits|even number/)
  wrong('""', /cut off/)
  wrong(`{ _data: '8261', x: 1 }`, /./)
})
