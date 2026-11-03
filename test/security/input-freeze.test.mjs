import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { verifyPassword } from '../../src/tools/bcrypt.js'
import { pxToRemInCss } from '../../src/tools/cssunits.js'
import { jsonLength, loadYaml, parseYaml } from '../../src/tools/yaml.js'

// A rejected hash must not leave bcryptjs running in the background, or the run never ends.
after(() => setImmediate(() => process.exit(process.exitCode)))

function elapsed(run) {
  const start = performance.now()
  run()
  return performance.now() - start
}

function aliasBomb() {
  const lines = ['a0: &a0 [' + Array(10).fill('"lol"').join(',') + ']']
  for (let level = 1; level <= 6; level++) {
    lines.push(`a${level}: &a${level} [` + Array(10).fill(`*a${level - 1}`).join(',') + ']')
  }
  return lines.join('\n')
}

test('REQ-004: an alias bomb is rejected quickly with an error that mentions aliases', () => {
  const bomb = aliasBomb()
  assert.ok(bomb.length < 500)
  let error
  const ms = elapsed(() => {
    try { parseYaml(bomb) } catch (caught) { error = caught }
  })
  assert.ok(error, 'parseYaml() did not throw')
  assert.match(error.message, /aliases/)
  assert.ok(ms < 500, `parseYaml() took ${ms} ms`)
})

test('REQ-004: a bomb of long strings is rejected before it can be printed', () => {
  const leaf = '"' + 'x'.repeat(200) + '"'
  const lines = ['a0: &a0 [' + Array(9).fill(leaf).join(',') + ']']
  for (let level = 1; level <= 5; level++) {
    lines.push(`a${level}: &a${level} [` + Array(9).fill(`*a${level - 1}`).join(',') + ']')
  }
  const bomb = lines.join('\n')
  assert.ok(bomb.length < 3000)
  let error
  const ms = elapsed(() => {
    try { parseYaml(bomb) } catch (caught) { error = caught }
  })
  assert.match(error?.message ?? '', /aliases/)
  assert.ok(ms < 500, `parseYaml() took ${ms} ms`)
})

function expectRejected(bomb) {
  let error
  const ms = elapsed(() => {
    try { parseYaml(bomb) } catch (caught) { error = caught }
  })
  assert.match(error?.message ?? '', /aliases/)
  assert.ok(ms < 500, `parseYaml() took ${ms} ms`)
}

/** a0 is a flow collection of `fan` leaves; a1..a<levels> hold `fan` aliases of the level before. */
function nestedBomb(leaf, fan, levels, { map = false, tail = '' } = {}) {
  const open = map ? '{' : '['
  const close = map ? '}' : ']'
  const items = (value) => Array.from({ length: fan }, (_, i) => (map ? `${'k'.repeat(200)}${i}: ` : '') + value).join(',')
  const lines = [`a0: &a0 ${open}${items(leaf)}${close}`]
  for (let level = 1; level <= levels; level++) lines.push(`a${level}: &a${level} ${open}${items(`*a${level - 1}`)}${close}`)
  return lines.join('\n') + tail
}

test('REQ-004: a bomb hidden under deep nesting is rejected', () => {
  const deep = (name) => `\n${name}: ` + '['.repeat(95) + `*a5` + ']'.repeat(95)
  const bomb = nestedBomb('1', 7, 5, { tail: ['d0', 'd1', 'd2', 'd3', 'd4'].map(deep).join('') })
  assert.ok(bomb.length < 1500)
  expectRejected(bomb)
  const small = nestedBomb('1', 8, 5, { tail: deep('d0') })
  assert.ok(small.length < 500)
  expectRejected(small)
})

test('REQ-004: one deep list without aliases is rejected', () => {
  const text = '['.repeat(98) + '1,'.repeat(999000) + '1' + ']'.repeat(98)
  // js-yaml needs about 300 ms to read 2 MB, and that is not what is under test: time the check alone.
  const value = loadYaml(text)
  assert.ok(elapsed(() => assert.ok(jsonLength(value, 12_000_000) > 12_000_000)) < 500)
  assert.throws(() => parseYaml(text), /aliases/)
})

test('REQ-004: a map of maps with short keys and values is rejected', () => {
  const entries = (value) => Array.from({ length: 999 }, (_, i) => `k${String(i).padStart(14, '0')}: ${value}`).join(', ')
  const rows = [`k${'0'.repeat(14)}: &a0 {${entries('v'.repeat(15))}}`]
  rows.push(...Array.from({ length: 998 }, (_, i) => `k${String(i + 1).padStart(14, '0')}: *a0`))
  expectRejected(`{${rows.join(', ')}}`)
})

test('REQ-004: a bomb of long keys is rejected', () => {
  const bomb = nestedBomb('1', 7, 6, { map: true })
  assert.ok(bomb.length < 15000)
  expectRejected(bomb)
})

test('REQ-004: a bomb of long numbers is rejected', () => {
  expectRejected(nestedBomb('-1.2345678901234567e-300', 9, 5))
})

// A small seeded generator, so a failure can be replayed.
function random(seed) {
  let state = seed
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function randomValue(next, depth) {
  const pick = (list) => list[Math.floor(next() * list.length)]
  const kind = Math.floor(next() * (depth >= 6 ? 7 : 9))
  switch (kind) {
    case 0: return null
    case 1: return next() < 0.5
    case 2: return pick([0, 1, -1, 42, 3.14159, -1.2345678901234567e-300, 1e21, 123456789012, Infinity, NaN, -0])
    case 3: return pick(['', 'a', 'say "hi"', 'back\\slash', 'line\nbreak\ttab', 'ctrl\u0001\u001f', 'héllo wörld', '日本語', '😀 emoji', 'lone\ud800', 'x'.repeat(100)])
    case 4: return String(Math.floor(next() * 1e6))
    case 5: return pick([[], {}])
    case 6: return Math.floor(next() * 1e9) / 1000
    case 7: return Array.from({ length: Math.floor(next() * 5) }, () => randomValue(next, depth + 1))
    default: {
      const map = {}
      const keys = ['a', 'key with spaces', '"quoted"', 'é', '😀', 'k\nn', 'x'.repeat(40), '__proto__', 'constructor', '', '0']
      for (let i = Math.floor(next() * 5); i > 0; i--) {
        Object.defineProperty(map, pick(keys), { value: randomValue(next, depth + 1), enumerable: true, configurable: true, writable: true })
      }
      return map
    }
  }
}

test('REQ-004: jsonLength() matches the length of JSON.stringify(value, null, 2)', () => {
  const next = random(2024)
  for (let i = 0; i < 400; i++) {
    const doc = randomValue(next, 0)
    const real = JSON.stringify(doc, null, 2).length
    const estimate = jsonLength(doc)
    assert.ok(estimate >= real, `doc ${i}: estimate ${estimate} is below ${real}`)
    assert.ok(estimate <= real * 1.05 + 100, `doc ${i}: estimate ${estimate} is far above ${real}`)
  }
})

test('REQ-004: big documents without aliases still parse', () => {
  assert.equal(parseYaml('[' + '1,'.repeat(200000) + '1]').value.length, 200001)
  assert.equal(parseYaml('- 1\n'.repeat(200000)).value.length, 200000)
  const map = Array.from({ length: 200000 }, (_, i) => `k${i}: 1`).join('\n')
  assert.equal(Object.keys(parseYaml(map).value).length, 200000)
  assert.equal(parseYaml('[' + '1,'.repeat(999989) + '1]').value.length, 999990)
  assert.equal(parseYaml('- [1,2,3,4,5,6,7,8,9,10]\n'.repeat(100000)).value.length, 100000)
})

test('REQ-004: normal alias use still works', () => {
  assert.deepEqual(parseYaml('base: &b {x: 1}\nuse: *b').value, { base: { x: 1 }, use: { x: 1 } })
})

test('REQ-005: a long run of digits converts in linear time', () => {
  const css = 'a{content:"' + '1'.repeat(2000) + '"}'
  let result
  const ms = elapsed(() => { result = pxToRemInCss(css) })
  assert.ok(ms < 200, `pxToRemInCss() took ${ms} ms`)
  assert.equal(result.css, css)
})

test('REQ-005: a number with two dots is left alone and a leading dot still converts', () => {
  assert.equal(pxToRemInCss('a{margin:1.5.3px}').css, 'a{margin:1.5.3px}')
  assert.equal(pxToRemInCss('a{margin:.5px}').css, 'a{margin:0.0313rem}')
})

for (const [version, cost] of [['2b', 31], ['2b', 16], ['2a', 16], ['2y', 16]]) {
  test(`REQ-006: a $${version} hash with cost ${cost} is rejected before bcrypt runs`, { timeout: 2000 }, async () => {
    const start = performance.now()
    await assert.rejects(verifyPassword('x', `$${version}$${cost}$` + 'a'.repeat(53)), /cost/)
    assert.ok(performance.now() - start < 100)
  })
}

test('REQ-006: a hash with cost 15 is not rejected for its cost', { timeout: 20000 }, async () => {
  const result = await verifyPassword('x', '$2b$15$' + 'a'.repeat(53)).catch((error) => error)
  assert.equal(result, false)
})
