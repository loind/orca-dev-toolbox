import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { detect } from '../../src/detect.js'
import { fromLocalParts, localParts, objectIdFromTime, objectIdTime, parseObjectId } from '../../src/tools/objectid.js'

const ID = '6ae8c1900000000000000000'
const PARTS = { year: 2026, month: 11, day: 2, hour: 17, minute: 0, second: 0 }

test('parseObjectId reads the shell, driver and Extended JSON forms (REQ-018)', () => {
  for (const text of [
    ID, ' 6AE8C1900000000000000000 ', `ObjectId("${ID}")`, `ObjectId('${ID}')`, `new ObjectId('${ID}')`,
    `ObjectID("${ID}")`, `{"$oid": "${ID}"}`, `{ "$oid" : "${ID.toUpperCase()}" }`, `objectid( "${ID}" )`, `NEW ObjectId("${ID}")`
  ]) assert.equal(parseObjectId(text), ID, text)
  assert.equal(parseObjectId('   '), null)
  assert.equal(parseObjectId(''), null)
})

test('parseObjectId rejects anything else with a message that says "24 hex" (REQ-018)', () => {
  for (const text of [
    '6ae8c19000000000000000', '6ae8c19000000000000000000', '6ae8c190000000000000000g', `ObjectId("${ID}')`, `ObjectId('${ID}")`,
    `ObjectId(${ID})`, `ObjectId("${ID}"`, `ObjectId("${ID}") x`, `{'$oid': '${ID}'}`, `{"$oid": "${ID}", "x": 1}`, `{"$date": "${ID}"}`,
    'ObjectId("6ae8")', '__proto__', '१२३४५६७८९०१२३४५६७८९०१२३४', '6ae8c190\u00000000000000000000', '0x' + ID.slice(2)
  ]) assert.throws(() => parseObjectId(text), /24 hex/, JSON.stringify(text))
})

test('objectIdTime is the first 8 hex digits as unsigned seconds (REQ-019)', () => {
  assert.equal(objectIdTime('507f191e810c19729de860ea').toISOString(), '2012-10-17T20:46:22.000Z')
  assert.equal(objectIdTime(ID).toISOString(), '2026-11-02T17:00:00.000Z')
  assert.equal(objectIdTime('ffffffff0000000000000000').toISOString(), '2106-02-07T06:28:15.000Z')
  assert.equal(objectIdTime('000000000000000000000000').getTime(), 0)
  assert.equal(objectIdTime(`ObjectId("${ID}")`).toISOString(), '2026-11-02T17:00:00.000Z')
  assert.throws(() => objectIdTime('nope'), /24 hex/)
  assert.throws(() => objectIdTime('  '), /24 hex/)
})

test('objectIdFromTime floors to the second and pads with 16 zeros (REQ-020)', () => {
  assert.equal(objectIdFromTime(new Date('2026-11-02T17:00:00.999Z')), ID)
  assert.equal(objectIdFromTime(objectIdTime('507f191e810c19729de860ea')), '507f191e0000000000000000')
  assert.equal(objectIdFromTime(new Date('2012-10-17T20:46:23.000Z')), '507f191f0000000000000000')
})

test('objectIdFromTime covers 1970 to 2106 only (REQ-021)', () => {
  assert.equal(objectIdFromTime(new Date(0)), '000000000000000000000000')
  assert.equal(objectIdFromTime(new Date('2106-02-07T06:28:15Z')), 'ffffffff0000000000000000')
  assert.equal(objectIdFromTime(new Date('2106-02-07T06:28:15.999Z')), 'ffffffff0000000000000000')
  for (const date of [new Date('2106-02-07T06:28:16Z'), new Date('1969-12-31T23:59:59Z'), new Date('1969-12-31T23:59:59.999Z'), new Date(NaN), new Date(8.64e15)]) {
    assert.throws(() => objectIdFromTime(date), (error) => /1970/.test(error.message) && /2106/.test(error.message), String(date))
  }
})

test('fromLocalParts builds the local time or names what is wrong (REQ-022)', () => {
  assert.equal(fromLocalParts(PARTS).getTime(), new Date(2026, 10, 2, 17, 0, 0).getTime())
  assert.equal(fromLocalParts({ year: '2026', month: ' 11 ', day: '02', hour: '17', minute: '00', second: '00' }).getTime(), new Date(2026, 10, 2, 17).getTime())
  assert.throws(() => fromLocalParts({ ...PARTS, year: 2026, month: 2, day: 30 }), /no day 30/)
  assert.throws(() => fromLocalParts({ ...PARTS, year: 2027, month: 2, day: 29 }), /no day 29/)
  assert.throws(() => fromLocalParts({ ...PARTS, year: 2100, month: 2, day: 29 }), /no day 29/)
  assert.throws(() => fromLocalParts({ ...PARTS, month: 4, day: 31 }), /no day 31/)
  assert.equal(fromLocalParts({ ...PARTS, year: 2028, month: 2, day: 29 }).getDate(), 29)
  const bad = [
    ['month', 13, /Month/], ['month', 0, /Month/], ['hour', 24, /Hour/], ['second', 1.5, /Second/], ['minute', 60, /Minute/],
    ['day', 0, /Day/], ['day', 32, /Day/], ['year', 99, /Year/], ['year', 1968, /Year/], ['year', 2107, /Year/],
    ['minute', '', /Minute is empty/], ['year', '  ', /Year is empty/], ['day', undefined, /Day is empty/], ['hour', null, /Hour is empty/],
    ['second', NaN, /Second/], ['second', Infinity, /Second/], ['hour', '1e1', /Hour/], ['hour', '-0', /Hour/], ['hour', '-1', /Hour/],
    ['hour', '+1', /Hour/], ['hour', '1.0', /Hour/], ['hour', '0x10', /Hour/], ['month', '__proto__', /Month/], ['month', '१२', /Month/],
    ['day', '9'.repeat(1e6), /Day/], ['year', '2026\u0000', /Year/], ['year', {}, /Year/], ['year', [2026], /Year/], ['second', 2 ** 53, /Second/]
  ]
  for (const [key, value, message] of bad) {
    assert.throws(() => fromLocalParts({ ...PARTS, [key]: value }), message, `${key}=${String(value).slice(0, 20)}`)
  }
  assert.throws(() => fromLocalParts({}), /Year is empty/)
  assert.throws(() => fromLocalParts(), /Year is empty/)
})

test('local parts round-trip in every time zone (REQ-019, REQ-020)', () => {
  for (const iso of ['2026-06-15T12:00:00Z', '2012-10-17T20:46:22Z', '2026-01-01T00:00:01Z', '2038-01-19T03:14:08Z']) {
    const date = new Date(iso)
    assert.equal(fromLocalParts(localParts(date)).getTime(), date.getTime(), iso)
  }
  assert.deepEqual(localParts(new Date(2026, 10, 2, 17, 5, 9)), { year: 2026, month: 11, day: 2, hour: 17, minute: 5, second: 9 })
})

test('hostile text never throws anything but a clear error and never takes long (REQ-018)', () => {
  const MB = 1 << 20
  const payloads = [
    'a'.repeat(MB), ' '.repeat(MB) + 'x', '{' + ' '.repeat(MB), 'new' + ' '.repeat(MB), 'ObjectId("' + '0'.repeat(MB), 'ObjectId(' + ' '.repeat(MB),
    '{"$oid"' + ' '.repeat(MB), '{' + ' '.repeat(MB) + '"$oid": "' + ID + '"}', '\u0000'.repeat(MB), '😀'.repeat(MB / 2), 'new '.repeat(MB / 4),
    'ObjectId('.repeat(MB / 9), ID.repeat(MB / 24)
  ]
  for (const text of payloads) {
    let start = performance.now()
    try {
      parseObjectId(text)
    } catch (error) {
      assert.match(error.message, /24 hex/)
    }
    assert.ok(performance.now() - start < 500, `parseObjectId took ${performance.now() - start} ms on ${JSON.stringify(text.slice(0, 20))}`)
    start = performance.now()
    detect(text)
    assert.ok(performance.now() - start < 2000, `detect took ${performance.now() - start} ms on ${JSON.stringify(text.slice(0, 20))}`)
  }
})

test('detect() recognises ObjectIds and leaves near misses alone (REQ-025)', () => {
  for (const text of [ID, 'ObjectId("672f7b4e9d1c2a0012345678")', "new ObjectId('672f7b4e9d1c2a0012345678')", '{ "$oid": "672f7b4e9d1c2a0012345678" }', ' 672F7B4E9D1C2A0012345678\n']) {
    assert.equal(detect(text), 'objectid', text)
  }
  for (const text of ['6ae8c19000000000000000', 'ObjectId("6ae8")', '6ae8c190000000000000000g', '6ae8c19000000000000000000']) {
    assert.equal(detect(text), null, text)
  }
})

// Date arithmetic depends on the machine's time zone, so each zone gets its own process with TZ set.
const ZONE_SCRIPT = `
import { fromLocalParts, localParts, objectIdFromTime } from ${JSON.stringify(new URL('../../src/tools/objectid.js', import.meta.url).href)}
import { localString } from ${JSON.stringify(new URL('../../src/tools/time.js', import.meta.url).href)}
const at = (y, mo, d, h, mi, s) => {
  try { return fromLocalParts({ year: y, month: mo, day: d, hour: h, minute: mi, second: s }).toISOString() } catch (error) { return error.message }
}
const id = (...fields) => {
  try { return objectIdFromTime(fromLocalParts(Object.fromEntries(['year', 'month', 'day', 'hour', 'minute', 'second'].map((key, i) => [key, fields[i]])))) } catch (error) { return error.message }
}
const label = (iso) => localString(new Date(iso)).replace(/^.* /, '')
console.log(JSON.stringify({
  now: at(2026, 6, 15, 12, 0, 0),
  noon: localParts(new Date('2026-06-15T12:00:00Z')),
  epoch: id(1970, 1, 1, 0, 0, 0),
  end: id(2106, 2, 7, 6, 28, 15),
  past: id(2106, 2, 7, 6, 28, 16),
  newYork: [at(2026, 3, 8, 1, 59, 59), at(2026, 3, 8, 2, 0, 0), at(2026, 3, 8, 2, 30, 0), at(2026, 3, 8, 3, 0, 0), at(2026, 11, 1, 1, 30, 0), at(2026, 11, 1, 2, 0, 0)],
  lordHowe: [at(2026, 10, 4, 1, 59, 59), at(2026, 10, 4, 2, 0, 0), at(2026, 10, 4, 2, 15, 0), at(2026, 10, 4, 2, 29, 59), at(2026, 10, 4, 2, 30, 0), at(2026, 4, 5, 1, 45, 0)],
  labels: [label('2026-01-01T00:00:00Z'), label('2026-07-01T00:00:00Z')],
  hex: objectIdFromTime(new Date('2026-01-01T00:00:00Z'))
}))`

function inZone(TZ, script = ZONE_SCRIPT) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8', timeout: 20000 }))
}

test('the six fields are local time; a time the clock skips is an error, a repeated time is the earlier one (REQ-019, REQ-022)', () => {
  const utc = inZone('UTC')
  assert.equal(utc.now, '2026-06-15T12:00:00.000Z')
  assert.deepEqual(utc.noon, { year: 2026, month: 6, day: 15, hour: 12, minute: 0, second: 0 })
  assert.equal(utc.epoch, '000000000000000000000000')
  assert.equal(utc.end, 'ffffffff0000000000000000')
  assert.match(utc.past, /2106/)
  assert.deepEqual(utc.labels, ['GMT+00:00', 'GMT+00:00'])

  const newYork = inZone('America/New_York')
  assert.equal(newYork.now, '2026-06-15T16:00:00.000Z')
  assert.deepEqual(newYork.noon, { year: 2026, month: 6, day: 15, hour: 8, minute: 0, second: 0 })
  assert.equal(newYork.newYork[0], '2026-03-08T06:59:59.000Z')
  for (const message of newYork.newYork.slice(1, 3)) assert.match(message, /does not exist/)
  assert.match(newYork.newYork[1], /2026-03-08 02:00:00/)
  assert.equal(newYork.newYork[3], '2026-03-08T07:00:00.000Z')
  assert.equal(newYork.newYork[4], '2026-11-01T05:30:00.000Z', 'a repeated time is read as the earlier one')
  assert.equal(newYork.newYork[5], '2026-11-01T07:00:00.000Z')
  assert.deepEqual(newYork.labels, ['GMT-05:00', 'GMT-04:00'])

  const kolkata = inZone('Asia/Kolkata')
  assert.equal(kolkata.now, '2026-06-15T06:30:00.000Z')
  assert.deepEqual(kolkata.noon, { year: 2026, month: 6, day: 15, hour: 17, minute: 30, second: 0 })
  assert.match(kolkata.epoch, /1970/)
  assert.match(kolkata.epoch, /2106/)
  assert.deepEqual(kolkata.labels, ['GMT+05:30', 'GMT+05:30'])
  assert.equal(kolkata.hex, '6955b9000000000000000000')

  const lordHowe = inZone('Australia/Lord_Howe')
  assert.deepEqual(lordHowe.noon, { year: 2026, month: 6, day: 15, hour: 22, minute: 30, second: 0 })
  assert.equal(lordHowe.lordHowe[0], '2026-10-03T15:29:59.000Z')
  for (const message of lordHowe.lordHowe.slice(1, 4)) assert.match(message, /does not exist/)
  assert.equal(lordHowe.lordHowe[4], '2026-10-03T15:30:00.000Z')
  assert.equal(lordHowe.lordHowe[5], '2026-04-04T14:45:00.000Z', 'a repeated time is read as the earlier one')
  assert.deepEqual(lordHowe.labels, ['GMT+11:00', 'GMT+10:30'])
})

const TOOL_URL = JSON.stringify(new URL('../../src/tools/objectid.js', import.meta.url).href)

// Local years run 1969 to 2106: the real bound is the UTC range, checked on the ObjectId time itself.
const EDGE_SCRIPT = `
import { fromLocalParts, localParts, objectIdFromTime, objectIdTime } from ${TOOL_URL}
const id = (y, mo, d, h, mi, s) => {
  try { return objectIdFromTime(fromLocalParts({ year: y, month: mo, day: d, hour: h, minute: mi, second: s })) } catch (error) { return error.message }
}
const epoch = localParts(objectIdTime('000000000000000000000000'))
console.log(JSON.stringify({
  epoch,
  editMinute: id(epoch.year, epoch.month, epoch.day, epoch.hour, 1, 0),
  at: id(epoch.year, epoch.month, epoch.day, epoch.hour, epoch.minute, epoch.second),
  before: id(epoch.year, epoch.month, epoch.day, epoch.hour - 1, 59, 59),
  y1968: id(1968, 6, 1, 0, 0, 0), y2107: id(2107, 1, 1, 0, 0, 0),
  last: localParts(objectIdTime('ffffffff0000000000000000')),
  lastId: id(...Object.values(localParts(objectIdTime('ffffffff0000000000000000')))),
  end: id(2106, 2, 7, 20, 28, 15), pastEnd: id(2106, 2, 7, 20, 28, 16)
}))`

test('the first hours of 1970 can be typed west of UTC, the last of 2106 east of it (REQ-021, REQ-022)', () => {
  const west = inZone('America/New_York', EDGE_SCRIPT)
  assert.deepEqual(west.epoch, { year: 1969, month: 12, day: 31, hour: 19, minute: 0, second: 0 })
  assert.equal(west.at, '000000000000000000000000')
  assert.equal(west.editMinute, '0000003c0000000000000000')
  assert.match(west.before, /1970/)
  assert.match(west.y1968, /Year/)
  assert.match(west.y2107, /Year/)

  // Auckland was UTC+12 in 1970; Kiritimati was UTC-10:40 then (so 1969 there) and is UTC+14 in 2106.
  const auckland = inZone('Pacific/Auckland', EDGE_SCRIPT)
  assert.deepEqual(auckland.epoch, { year: 1970, month: 1, day: 1, hour: 12, minute: 0, second: 0 })
  assert.equal(auckland.at, '000000000000000000000000')
  assert.match(auckland.before, /1970/)
  assert.match(auckland.y1968, /Year/)

  const east = inZone('Pacific/Kiritimati', EDGE_SCRIPT)
  assert.equal(east.epoch.year, 1969)
  assert.equal(east.at, '000000000000000000000000')
  assert.match(east.before, /1970/)
  assert.deepEqual(east.last, { year: 2106, month: 2, day: 7, hour: 20, minute: 28, second: 15 })
  assert.equal(east.end, 'ffffffff0000000000000000')
  assert.equal(east.lastId, 'ffffffff0000000000000000')
  assert.match(east.pastEnd, /2106/)
  assert.match(east.y1968, /Year/)
  assert.match(east.y2107, /Year/)
})

// For every minute around every clock change of 2024..2030: reading the fields back with the date that
// is shown gives that exact date, also in the hour that happens twice; a wall time the clock skips errors.
const ROUND_TRIP_SCRIPT = `
import { fromLocalParts, localParts } from ${TOOL_URL}
const DAY = 86400000
const offset = (t) => new Date(t).getTimezoneOffset()
const wrong = []
let checked = 0
let changes = 0
for (let year = 2024; year <= 2030; year++) {
  for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += DAY) {
    if (offset(t) === offset(t + DAY)) continue
    changes++
    const walls = new Set()
    for (let d = t - 6 * 3600000; d <= t + DAY + 6 * 3600000; d += 60000) {
      const date = new Date(d)
      const fields = localParts(date)
      walls.add(Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second))
      checked++
      let back
      try { back = fromLocalParts(fields, date).getTime() } catch (error) { back = error.message }
      if (back !== d) wrong.push(['round trip', date.toISOString(), back])
      const first = fromLocalParts(fields).getTime()
      if (first > d || offset(first) > offset(d)) wrong.push(['not the earlier one', date.toISOString(), first])
    }
    const low = Math.min(...walls)
    const high = Math.max(...walls)
    for (let w = low; w <= high; w += 60000) {
      const wall = new Date(w)
      const fields = { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate(), hour: wall.getUTCHours(), minute: wall.getUTCMinutes(), second: 0 }
      let error = null
      try { fromLocalParts(fields, new Date(t)) } catch (caught) { error = caught.message }
      if (walls.has(w) === (error !== null)) wrong.push(['skipped time', wall.toISOString(), error])
      if (error !== null && !/does not exist/.test(error)) wrong.push(['message', wall.toISOString(), error])
    }
  }
}
console.log(JSON.stringify({ wrong: wrong.slice(0, 5), count: wrong.length, checked, changes }))`

test('fromLocalParts with the shown date is exact around every clock change, in 7 zones (REQ-022)', () => {
  for (const zone of ['America/New_York', 'Australia/Lord_Howe', 'Australia/Sydney', 'Europe/London', 'America/St_Johns', 'Africa/Casablanca', 'Pacific/Chatham']) {
    const result = inZone(zone, ROUND_TRIP_SCRIPT)
    assert.ok(result.changes >= 10, `${zone}: ${result.changes} clock changes found`)
    assert.deepEqual(result.wrong, [], zone)
    assert.equal(result.count, 0, zone)
  }
})

test('a repeated hour keeps the offset of the date shown; with no date it is the earlier one (REQ-022)', () => {
  const script = `
import { fromLocalParts } from ${TOOL_URL}
const fields = { year: 2025, month: 11, day: 2, hour: 1, minute: 30, second: 0 }
const iso = (...args) => fromLocalParts(...args).toISOString()
console.log(JSON.stringify({
  none: iso(fields),
  first: iso(fields, new Date('2025-11-02T05:30:00Z')),
  second: iso(fields, new Date('2025-11-02T06:30:00Z')),
  summer: iso(fields, new Date('2025-07-01T00:00:00Z')),
  winter: iso(fields, new Date('2026-01-01T00:00:00Z')),
  junk: [iso(fields, new Date(NaN)), iso(fields, undefined), iso(fields, null), iso(fields, 'x'), iso(fields, {})]
}))`
  const result = inZone('America/New_York', script)
  assert.equal(result.none, '2025-11-02T05:30:00.000Z')
  assert.equal(result.first, '2025-11-02T05:30:00.000Z')
  assert.equal(result.second, '2025-11-02T06:30:00.000Z')
  assert.equal(result.summer, '2025-11-02T05:30:00.000Z')
  assert.equal(result.winter, '2025-11-02T06:30:00.000Z')
  assert.deepEqual(result.junk, Array(5).fill('2025-11-02T05:30:00.000Z'))
})
