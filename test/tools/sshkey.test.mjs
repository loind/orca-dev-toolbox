import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseSshKey, parseSshKeys } from '../../src/tools/sshkey.js'

// Throwaway keys; fingerprints from ssh-keygen -l and ssh-keygen -E md5 -l.
const ED25519 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIbUDsY2Ge6v8s5SLT2HjaNVMlN7t+Mt9MFordDbmsA3 dev@example.com'
const RSA = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC0BC3BJkDthWzbyQl+QZofsIg3L1d2o/5JGO3Mi5KK7/VwLWi6Cm7lM/6bRLxGgc6fp2tD3xvBFSZx0Q9O/Qg9c03y0I2XrgkRU3tx432/vZQ0BdxmihIdKGsQjDJhVgchIx7bG3upNomm9tx11ZDGFoSsoQjbTo4rmHCBY2US36jmJfv+yjkIEk4l4jyydhbMDtJA0WuSLAIG2AZBdMZ3QQ1+KZl5gFYrSZPsrGkVS6bXBAhYrtnLIxaIx9+x0LmRNvOF3Eh4ss4w6XrJgYK/t2EZESu6r0smZm/0DxL6iSZiyiTvvS+xgXRGYqG6O3/lciyWTcm9aZ8DiAFHXpra/8Ugb0uL9HZL+dA/vdB5b0IdCzlXlUkTw0xPrJrRCkIx9NqQWY1VU6OWLjcl8CeR5oYuUasSZHBWCICM1jOiQtOCIYwcFTKYK4/22xFOqAWnRPh2pORlcoDNsSt+jIA1Xz8IdZ1baMGDDV+pBjsP7Mup2sm1SN9613dbHhyw+R8= ci-deploy'
const ECDSA = 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBFYWlhjpjLHGUOYzUJkqvi6/5u5R6awmPU359Yo5urDQJWjohnc4y9IF1JQy32OOS5U45aDR5HUQzW/TEM7lOLI='

test('types, sizes and fingerprints match ssh-keygen', () => {
  const ed = parseSshKey(ED25519)
  assert.deepEqual([ed.label, ed.bits, ed.comment, ed.sha256, ed.md5], ['Ed25519', 256, 'dev@example.com', 'SHA256:AfFIOtYX6FKIl68CE+Wn711z3fVefJJJB/+ZO7HuUVM', 'MD5:ac:46:28:18:4b:90:e7:0c:d3:8a:76:c8:fa:c7:bc:42'])
  const rsa = parseSshKey(RSA)
  assert.deepEqual([rsa.label, rsa.bits, rsa.sha256], ['RSA', 3072, 'SHA256:TA+xE3vTqLgqrLVKimqF9WmQLkY7bRuCAHtAjHyI6YU'])
  const ec = parseSshKey(ECDSA)
  assert.deepEqual([ec.label, ec.bits, ec.sha256, ec.comment], ['ECDSA P-256', 256, 'SHA256:zAPuJ5kFaBZpCV9Te95hNjem6NgZKPxzpwIPNrqPZBU', ''])
})

test('authorized_keys lines with options, and private keys refused', () => {
  const { keys, errors } = parseSshKeys(`# team\nno-pty,from="10.0.0.0/8" ${ED25519}\n\n${ECDSA}\nnot a key`)
  assert.equal(keys.length, 2)
  assert.equal(keys[0].options, 'no-pty,from="10.0.0.0/8"')
  assert.match(errors[0], /^Line 5/)
  assert.throws(() => parseSshKeys('-----BEGIN OPENSSH PRIVATE KEY-----\nabc'), /private key/)
})
