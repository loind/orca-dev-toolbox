// bcrypt with bcryptjs (BSD-3-Clause), bundled; Basic auth headers and htpasswd lines.
import bcrypt from 'bcryptjs'
import { base64Encode, utf8 } from './codec.js'

export const MAX_BYTES = 72
const MAX_COST = 15

/** Hashes asynchronously so the panel stays responsive at higher costs. */
export function hashPassword(password, rounds = 10) {
  return bcrypt.hash(password, rounds)
}

export function verifyPassword(password, hash) {
  if (!/^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash.trim())) {
    return Promise.reject(new Error('Not a bcrypt hash: it looks like $2b$10$ followed by 53 characters.'))
  }
  if (Number(hash.trim().slice(4, 6)) > MAX_COST) {
    return Promise.reject(new Error(`Hashes with a cost above ${MAX_COST} are not verified here: they would take too long.`))
  }
  return bcrypt.compare(password, hash.trim())
}

/** { version, cost, salt } of a bcrypt hash. */
export function describeHash(hash) {
  const match = /^\$(2[abxy])\$(\d{2})\$([./A-Za-z0-9]{22})/.exec(hash.trim())
  return match ? { version: match[1], cost: Number(match[2]), salt: match[3] } : null
}

/** Bytes past 72 are ignored by bcrypt, so two long passwords can share a hash. */
export const tooLong = (password) => utf8(password).length > MAX_BYTES

export function basicAuth(user, password) {
  return `Basic ${base64Encode(`${user}:${password}`)}`
}

/** An Apache/nginx htpasswd line; Apache writes bcrypt as $2y$. */
export function htpasswdLine(user, hash) {
  return `${user}:${hash.replace(/^\$2[ab]\$/, '$2y$')}`
}
