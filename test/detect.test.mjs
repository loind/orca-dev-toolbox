import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detect } from '../src/detect.js'

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

test('recognises each kind of pasted value', () => {
  const cases = [
    [JWT, 'jwt'],
    [`Bearer ${JWT}`, 'jwt'],
    ['  1730000000  ', 'time'],
    ['1730000000123', 'time'],
    ['2026-10-31T09:00:00Z', 'time'],
    ['2026-10-31', 'time'],
    ['{"a": [1, 2]}', 'json'],
    ['[1,2,3]', 'json'],
    ['https://example.com/a?b=1', 'url'],
    ['hello%20world%26more', 'url'],
    ['*/5 * * * *', 'cron'],
    ['0 9 * * MON-FRI', 'cron'],
    ['@daily', 'cron'],
    ['SGVsbG8sIHdvcmxkIQ==', 'base64'],
    ['WGluIGNow6BvIPCfkYs', 'base64'],
    ['018f3c1e-7b2a-7c00-8a00-123456789abc', 'ids'],
    ['#3b82f6', 'color'],
    ['#fff', 'color'],
    ['rgb(59 130 246 / 50%)', 'color'],
    ['oklch(62% 0.19 260)', 'color'],
    ['0xdeadbeef', 'number'],
    ['0b1010_1010', 'number'],
    ['-rwxr-xr-x', 'chmod'],
    ['rw-r--r--', 'chmod'],
    ['&lt;div class=&quot;x&quot;&gt;', 'escape'],
    ['Xin ch\\u00e0o', 'escape'],
    ["curl -X POST https://x.dev -d 'a=1'", 'curl'],
    ['01ARYZ6S41TSV4RRFFQ69G5FAV', 'ids'],
    ['6ae8c1900000000000000000', 'objectid'],
    ['ObjectId("672f7b4e9d1c2a0012345678")', 'objectid'],
    ["new ObjectId('672f7b4e9d1c2a0012345678')", 'objectid'],
    ['{ "$oid": "672f7b4e9d1c2a0012345678" }', 'objectid'],
    ['10.0.0.0/8', 'cidr'],
    ['192.168.1.10', 'cidr'],
    ['192.168.1.10 255.255.255.0', 'cidr'],
    ['2001:db8::/32', 'cidr'],
    ['name: app\nreplicas: 2\nports:\n  - 80', 'yaml'],
    ['name,email\nAda,ada@x.dev\nBob,bob@x.dev', 'csv'],
    ['a\tb\n1\t2', 'csv'],
    ['SELECT id FROM users WHERE active', 'sql'],
    ['insert into t values (1)', 'sql'],
    ['<?xml version="1.0"?><a><b/></a>', 'xml'],
    ['<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>', 'xml'],
    ['1.5 GB', 'units'],
    ['512MiB', 'units'],
    ['1h30m', 'units'],
    ['250ms', 'units'],
    ['PT1H30M', 'units'],
    ['hello\u200bworld', 'chars'],
    ['-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----', 'cert'],
    ['$2b$10$K7zV3In2v6WuKbmmcgBPqeungTaj.dIr.90Ahw8QD0hRs8yKtDnlK', 'bcrypt'],
    ['data:image/png;base64,iVBORw0KGgo=', 'image'],
    ['24px', 'cssunits'],
    ['1.5rem', 'cssunits']
  ]
  for (const [value, tool] of cases) assert.equal(detect(value), tool, value)
})

test('leaves ordinary words and broken values to the search', () => {
  for (const value of ['', '   ', 'json', 'password', 'base64 encode', '{not json', 'hash', '12345', 'eyJhbGciOi', '#hashtag', 'rgb', 'Tom & Jerry', 'Hello, world.\nHow are you?', 'note: remember this', '1.2.3', 'select', 'Selected items', '<b>not closed', 'pm', 'P', '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', '6ae8c19000000000000000', 'ObjectId("6ae8")']) {
    assert.equal(detect(value), null, value)
  }
})

test('recognises docker run, SSH keys, otpauth URIs, payment QR payloads, .env and versions', () => {
  const cases = [
    ['docker run -d -p 80:80 nginx', 'docker'],
    ['sudo podman run --rm -it alpine sh', 'docker'],
    ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIbUDsY2Ge6v8s5SLT2HjaNVMlN7t+Mt9MFordDbmsA3 me@host', 'sshkey'],
    ['otpauth://totp/ACME:me?secret=JBSWY3DPEHPK3PXP', 'totp'],
    ['00020101021238540010A00000072701240006970436011001234567890208QRIBFTTA530370454061500005802VN62220818Thanh toan don A126304C28D', 'vietqr'],
    ['DATABASE_URL=postgres://localhost/app\nDEBUG=true', 'env'],
    ['export API_KEY=abc', 'env'],
    ['^1.2.0', 'semver'],
    ['>=2.1.0', 'semver'],
    ['v2.0.0', 'semver'],
    ['1.0.0-rc.1', 'semver']
  ]
  for (const [value, tool] of cases) assert.equal(detect(value), tool, value)
})

test('recognises a change stream resume token as JSON with a hex _data starting with 82 (REQ-043)', () => {
  const data = '82612E8513000000012B022C0100296E5A1004A5093ABB38FE4B9EA67F01BB1A96D812463C5F6964003C5F5F5F78000004'
  for (const value of [`{"_data":"${data}"}`, `  { "_data" : "${data.toLowerCase()}" }  `, `{"_id": {"_data": "${data}"}, "operationType": "insert", "ns": {"db": "a"}}`]) {
    assert.equal(detect(value), 'resumetoken', value)
  }
  // Bare hex, other prefixes, non-hex, non-strings and broken JSON are not a token.
  assert.equal(detect(data), null)
  for (const value of [`{"_data":"83${data.slice(2)}"}`, '{"_data":"zz"}', '{"_data": 82}', '{"_data": {"_data": "82"}}', '{"_id": {"_data": null}}', '{"a": "_data"}', '{"_data":"82', '{"_id": 5, "_data": "zz"}', '{"_data":"82"}', '{"_data":"82zz"}', '{"_data":"82612E8513000000"}', '{"_data":"82612E851300000001A"}']) {
    assert.notEqual(detect(value), 'resumetoken', value)
  }
  assert.equal(detect('{"_data": 82}'), 'json')
  assert.equal(detect('{"_data":"82"}'), 'json')
  // A whole timestamp (9 bytes) is the least that is taken for a token; what mongosh prints counts too.
  assert.equal(detect('{"_data":"82612E851300000001"}'), 'resumetoken')
  assert.equal(detect(`{ _data: '${data}' }`), 'resumetoken')
  assert.equal(detect(`{ _id: { _data: '${data}' }, operationType: 'insert' }`), 'resumetoken')
})
