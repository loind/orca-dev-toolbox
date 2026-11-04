import assert from 'node:assert/strict'
import { test } from 'node:test'

import { utf8 } from '../../src/tools/codec.js'
import { base32Decode, base32Encode, hotp, otpauthUri, parseOtpauth, totp } from '../../src/tools/totp.js'

test('RFC 4226 HOTP and RFC 6238 TOTP test vectors', () => {
  const sha1 = utf8('12345678901234567890')
  assert.deepEqual([0, 1, 2, 9].map((c) => hotp(sha1, c)), ['755224', '287082', '359152', '520489'])
  const keys = { SHA1: sha1, SHA256: utf8('12345678901234567890123456789012'), SHA512: utf8('1234567890123456789012345678901234567890123456789012345678901234') }
  const vectors = [[59, 'SHA1', '94287082'], [59, 'SHA256', '46119246'], [59, 'SHA512', '90693936'], [1111111109, 'SHA1', '07081804'], [2000000000, 'SHA512', '38618901'], [20000000000, 'SHA256', '77737706']]
  for (const [time, algorithm, code] of vectors) assert.equal(totp(keys[algorithm], { time: time * 1000, digits: 8, algorithm }).code, code)
  assert.equal(totp(sha1, { time: 59_000 }).remaining, 1)
})

test('Base32 and otpauth URIs', () => {
  assert.equal(base32Encode(base32Decode('jbsw y3dp-ehpk3pxp')), 'JBSWY3DPEHPK3PXP')
  assert.throws(() => base32Decode('ABC1'), /Base32/)
  const uri = parseOtpauth('otpauth://totp/ACME%20Co:john@example.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=ACME%20Co&digits=8&period=60&algorithm=sha256')
  assert.deepEqual([uri.issuer, uri.label, uri.digits, uri.period, uri.algorithm], ['ACME Co', 'ACME Co:john@example.com', 8, 60, 'SHA256'])
  assert.equal(parseOtpauth(otpauthUri({ issuer: 'X', account: 'me', secret: 'JBSWY3DPEHPK3PXP' })).secret, 'JBSWY3DPEHPK3PXP')
})
