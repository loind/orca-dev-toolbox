// One-time passwords (RFC 4226 HOTP, RFC 6238 TOTP) from a Base32 secret or an otpauth:// URI,
// for testing two-factor sign-in.
import { utf8 } from './codec.js'
import { hmac } from './hash.js'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(text) {
  const clean = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  if (!clean) throw new Error('Enter the secret.')
  const out = []
  let buffer = 0
  let bitsLeft = 0
  for (const c of clean) {
    const value = BASE32.indexOf(c)
    if (value === -1) throw new Error(`"${c}" is not a Base32 character (A–Z, 2–7).`)
    buffer = (buffer << 5) | value
    bitsLeft += 5
    if (bitsLeft >= 8) {
      out.push((buffer >>> (bitsLeft - 8)) & 0xff)
      bitsLeft -= 8
    }
  }
  return new Uint8Array(out)
}

export function base32Encode(bytes) {
  let out = ''
  let buffer = 0
  let bitsLeft = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bitsLeft += 8
    while (bitsLeft >= 5) {
      out += BASE32[(buffer >>> (bitsLeft - 5)) & 31]
      bitsLeft -= 5
    }
  }
  if (bitsLeft) out += BASE32[(buffer << (5 - bitsLeft)) & 31]
  return out
}

const ALGORITHMS = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }

export function hotp(key, counter, { digits = 6, algorithm = 'SHA1' } = {}) {
  const message = new Uint8Array(8)
  let c = BigInt(counter)
  for (let i = 7; i >= 0; i--) {
    message[i] = Number(c & 0xffn)
    c >>= 8n
  }
  const mac = hmac(ALGORITHMS[algorithm], key, message)
  const offset = mac[mac.length - 1] & 0x0f
  const code = (((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]) >>> 0
  return String(code % 10 ** digits).padStart(digits, '0')
}

/** The code at `time` (ms) and how long it stays valid. */
export function totp(key, { time = Date.now(), period = 30, digits = 6, algorithm = 'SHA1' } = {}) {
  const step = Math.floor(time / 1000 / period)
  return {
    code: hotp(key, step, { digits, algorithm }),
    next: hotp(key, step + 1, { digits, algorithm }),
    previous: hotp(key, step - 1, { digits, algorithm }),
    remaining: period - (Math.floor(time / 1000) % period)
  }
}

/** otpauth://totp/Issuer:account?secret=…&issuer=…&digits=…&period=…&algorithm=… */
export function parseOtpauth(uri) {
  let url
  try {
    url = new URL(uri.trim())
  } catch {
    throw new Error('Not a valid otpauth:// URI.')
  }
  if (url.protocol !== 'otpauth:') throw new Error('Not an otpauth:// URI.')
  const kind = url.hostname || url.pathname.split('/')[1]
  const label = decodeURIComponent(url.pathname.replace(/^\/+/, '').replace(/^(totp|hotp)\//, ''))
  const params = url.searchParams
  const secret = params.get('secret')
  if (!secret) throw new Error('The URI has no secret parameter.')
  return {
    kind,
    label,
    issuer: params.get('issuer') ?? (label.includes(':') ? label.split(':')[0] : ''),
    secret,
    digits: Number(params.get('digits') ?? 6),
    period: Number(params.get('period') ?? 30),
    algorithm: (params.get('algorithm') ?? 'SHA1').toUpperCase(),
    counter: Number(params.get('counter') ?? 0)
  }
}

export function otpauthUri({ issuer = '', account = 'user@example.com', secret, digits = 6, period = 30, algorithm = 'SHA1' }) {
  const label = encodeURIComponent(issuer ? `${issuer}:${account}` : account)
  const params = new URLSearchParams({ secret, ...(issuer ? { issuer } : {}), algorithm, digits: String(digits), period: String(period) })
  return `otpauth://totp/${label}?${params}`
}

export const asciiKey = (text) => utf8(text)
