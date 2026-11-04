// A MongoDB ObjectId is 12 bytes: its creation time as 4 bytes of unsigned big-endian seconds since
// 1970 (so 1970 to 2106), then 5 random bytes and a 3-byte counter.
const MAX_SECONDS = 0xffffffff
// Bare, as the mongo shell prints it, or as Extended JSON. Every part is a fixed token, so matching is linear.
const FORMS = /^(?:([0-9a-f]{24})|(?:new\s+)?ObjectId\(\s*(["'])([0-9a-f]{24})\2\s*\)|\{\s*"\$oid"\s*:\s*"([0-9a-f]{24})"\s*\})$/i

/** The lowercase hex of `6ae8…`, `ObjectId("6ae8…")` or `{"$oid": "6ae8…"}`; null when empty. */
export function parseObjectId(text) {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const match = FORMS.exec(trimmed)
  if (!match) throw new Error('An ObjectId is 24 hex digits, e.g. 6ae8c1900000000000000000 or ObjectId("6ae8c1900000000000000000").')
  return (match[1] ?? match[3] ?? match[4]).toLowerCase()
}

/** The creation time held in the first 8 hex digits. */
export function objectIdTime(text) {
  const hex = parseObjectId(text)
  if (!hex) throw new Error('An ObjectId is 24 hex digits, e.g. 6ae8c1900000000000000000.')
  return new Date(parseInt(hex.slice(0, 8), 16) * 1000)
}

/** The smallest ObjectId created in the same second as `date`: its time, then zeros. */
export function objectIdFromTime(date) {
  const seconds = Math.floor(date.getTime() / 1000)
  if (!(seconds >= 0 && seconds <= MAX_SECONDS)) throw new Error('An ObjectId holds a time from 1970-01-01 00:00:00 to 2106-02-07 06:28:15 UTC.')
  return seconds.toString(16).padStart(8, '0') + '0'.repeat(16)
}

/**
 * The six local-time fields: key, label, lowest and highest value. Local years start at 1969 because
 * 1970-01-01T00:00:00Z is still 1969 west of UTC; objectIdFromTime checks the real (UTC) range.
 */
export const PARTS = [
  ['year', 'Year', 1969, 2106], ['month', 'Month', 1, 12], ['day', 'Day', 1, 31],
  ['hour', 'Hour', 0, 23], ['minute', 'Minute', 0, 59], ['second', 'Second', 0, 59]
]

/** The local wall-clock fields of `date`, keyed as in PARTS. */
export function localParts(date) {
  return {
    year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
    hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds()
  }
}

// A whole number as a number or as plain digits: no sign, exponent, decimals or hex.
function wholeNumber(value, label, min, max) {
  const text = typeof value === 'string' ? value.trim() : value
  if (text === '' || text === undefined || text === null || (typeof text === 'number' && Number.isNaN(text))) throw new Error(`${label} is empty.`)
  const number = typeof text === 'string' ? (/^\d{1,10}$/.test(text) ? Number(text) : NaN) : text
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`)
  return number
}

const pad = (n) => String(n).padStart(2, '0')

/**
 * The local time the fields name. Throws, rather than change the date, on a field that is empty or out
 * of range, a day the month lacks, or a time the clock skips (daylight saving). A time that happens
 * twice (the clock goes back) is read with the UTC offset of `previous`, the date now shown, so that
 * editing a field does not jump an hour; without a valid `previous` it is the earlier one.
 */
export function fromLocalParts(parts = {}, previous) {
  const [year, month, day, hour, minute, second] = PARTS.map(([key, label, min, max]) => wholeNumber(parts[key], label, min, max))
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new Error(`${year}-${pad(month)} has no day ${day}.`)
  const named = (date) => {
    const back = localParts(date)
    return back.year === year && back.month === month && back.day === day && back.hour === hour && back.minute === minute && back.second === second
  }
  if (previous instanceof Date && !Number.isNaN(previous.getTime())) {
    const same = new Date(Date.UTC(year, month - 1, day, hour, minute, second) + previous.getTimezoneOffset() * 60000)
    if (named(same)) return same
  }
  const date = new Date(year, month - 1, day, hour, minute, second)
  if (!named(date)) {
    throw new Error(`${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)} does not exist in your time zone: the clock skips it.`)
  }
  return date
}
