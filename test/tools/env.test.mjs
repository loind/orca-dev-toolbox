import assert from 'node:assert/strict'
import { test } from 'node:test'

import { looksSecret, parseDotenv, readEnv, writeEnv } from '../../src/tools/env.js'

test('dotenv parsing: export, quotes, escapes, comments, multi-line values', () => {
  assert.deepEqual(parseDotenv('# c\nexport API_KEY="abc 123"\nDEBUG=true # inline\nMULTI="a\\nb"\nRAW=\'x # y\'\nPEM="-----BEGIN\nabc\n-----END"\nEMPTY='), [
    ['API_KEY', 'abc 123'], ['DEBUG', 'true'], ['MULTI', 'a\nb'], ['RAW', 'x # y'], ['PEM', '-----BEGIN\nabc\n-----END'], ['EMPTY', '']
  ])
  assert.throws(() => parseDotenv('JUST TEXT'), /Line 1/)
})

test('reads JSON, Secrets, ConfigMaps and docker flags', () => {
  assert.deepEqual(readEnv('{"A": "1", "B": 2}').pairs, [['A', '1'], ['B', '2']])
  const secret = readEnv('apiVersion: v1\nkind: Secret\nmetadata:\n  name: api\ndata:\n  TOKEN: czNjcmV0\nstringData:\n  MODE: dev\n')
  assert.deepEqual(secret, { pairs: [['TOKEN', 's3cret'], ['MODE', 'dev']], from: 'Secret', name: 'api' })
  assert.deepEqual(readEnv("docker run -e A=1 --env 'B=two words' -e C=x nginx").pairs, [['A', '1'], ['B', 'two words'], ['C', 'x']])
})

test('writes every target', () => {
  const pairs = [['API_KEY', 'abc 123'], ['MULTI', 'a\nb']]
  assert.equal(writeEnv(pairs, 'dotenv'), 'API_KEY="abc 123"\nMULTI="a\\nb"')
  assert.match(writeEnv(pairs, 'secret'), /API_KEY: YWJjIDEyMw==/)
  assert.match(writeEnv(pairs, 'configmap'), /kind: ConfigMap/)
  assert.equal(writeEnv(pairs, 'docker'), "-e 'API_KEY=abc 123' \\\n-e $'MULTI=a\\nb'")
  assert.equal(writeEnv([['Q', "it's"]], 'shell'), "export Q='it'\\''s'")
  assert.ok(looksSecret('STRIPE_API_KEY') && !looksSecret('PORT'))
})
