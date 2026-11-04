// OpenSSH public keys and authorized_keys lines: type, size, comment, options and the SHA256 and
// MD5 fingerprints that ssh-keygen -l and GitHub show.
import { base64ToBytes, bytesToBase64, toHex } from './codec.js'
import { md5, sha256 } from './hash.js'

const TYPES = {
  'ssh-ed25519': 'Ed25519',
  'ssh-rsa': 'RSA',
  'ssh-dss': 'DSA',
  'ecdsa-sha2-nistp256': 'ECDSA P-256',
  'ecdsa-sha2-nistp384': 'ECDSA P-384',
  'ecdsa-sha2-nistp521': 'ECDSA P-521',
  'sk-ssh-ed25519@openssh.com': 'Ed25519 security key (FIDO)',
  'sk-ecdsa-sha2-nistp256@openssh.com': 'ECDSA P-256 security key (FIDO)',
  'ssh-ed448': 'Ed448'
}
const KEY_TYPE = new RegExp(`(^|\\s)(${Object.keys(TYPES).map((t) => t.replace(/[.@]/g, '\\$&')).join('|')}|[a-z0-9-]+-cert-v01@openssh\\.com)\\s+(AAAA[A-Za-z0-9+/]+=*)(\\s+(.*))?$`)

// SSH wire format: uint32 length-prefixed fields.
function fields(bytes) {
  const out = []
  let i = 0
  while (i + 4 <= bytes.length) {
    const length = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
    i += 4
    if (i + length > bytes.length) throw new Error('The key data is truncated.')
    out.push(bytes.subarray(i, i + length))
    i += length
  }
  return out
}

function bits(mpint) {
  let i = 0
  while (i < mpint.length - 1 && mpint[i] === 0) i++
  return (mpint.length - i - 1) * 8 + (mpint[i] ? Math.floor(Math.log2(mpint[i])) + 1 : 0)
}

const text = (bytes) => new TextDecoder().decode(bytes)

/** One key line as { type, label, bits, comment, options, sha256, md5 }. */
export function parseSshKey(line) {
  const trimmed = line.trim()
  const m = KEY_TYPE.exec(trimmed)
  if (!m) throw new Error('Not an OpenSSH public key: expected a line like "ssh-ed25519 AAAA… comment".')
  const type = m[2]
  const options = trimmed.slice(0, m.index + m[1].length).trim()
  const blob = base64ToBytes(m[3])
  const parts = fields(blob)
  if (text(parts[0]) !== type) throw new Error(`The key data says ${text(parts[0])}, but the line says ${type}.`)
  let size = null
  if (type === 'ssh-rsa') size = bits(parts[2])
  else if (type === 'ssh-dss') size = bits(parts[1])
  else if (type.includes('ed25519')) size = 256
  else if (type === 'ssh-ed448') size = 456
  else if (/nistp(\d+)/.test(type)) size = Number(/nistp(\d+)/.exec(type)[1])
  const label = TYPES[type] ?? type.replace(/-cert-v01@openssh\.com$/, ' certificate')
  return {
    type,
    label,
    bits: size,
    comment: m[5]?.trim() ?? '',
    options,
    sha256: `SHA256:${bytesToBase64(sha256(blob)).replace(/=+$/, '')}`,
    md5: `MD5:${toHex(md5(blob), ':')}`,
    weak: (type === 'ssh-rsa' && size < 2048) || type === 'ssh-dss'
  }
}

/** Every key in an authorized_keys or .pub text, skipping comments and blank lines. */
export function parseSshKeys(input) {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(input)) {
    throw new Error('That is a private key. Never paste it anywhere; use the .pub file next to it.')
  }
  const keys = []
  const errors = []
  input.split(/\r?\n/).forEach((line, n) => {
    if (!line.trim() || line.trim().startsWith('#')) return
    try {
      keys.push(parseSshKey(line))
    } catch (error) {
      errors.push(`Line ${n + 1}: ${error.message}`)
    }
  })
  if (!keys.length && errors.length) throw new Error(errors[0].replace(/^Line 1: /, ''))
  return { keys, errors }
}
