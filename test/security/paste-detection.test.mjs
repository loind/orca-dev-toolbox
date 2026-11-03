import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { detect } from '../../src/detect.js'
import { tokenizeXml } from '../../src/tools/xml.js'
import { launch, openPanel, paste } from '../harness.mjs'

let browser
before(async () => (browser = await launch()))
after(async () => browser?.close())

function elapsed(run) {
  const start = performance.now()
  run()
  return performance.now() - start
}

test('REQ-001: a DOCTYPE with many brackets tokenizes in linear time', () => {
  const payload = "<?xml version='1.0'?><!DOCTYPE x " + '[]'.repeat(30) + '[>'
  assert.ok(elapsed(() => detect(payload)) < 100, 'detect() is slow')
  assert.ok(elapsed(() => { try { tokenizeXml(payload) } catch {} }) < 100, 'tokenizeXml() is slow')
})

test('REQ-001: a DOCTYPE with an internal subset is still one doctype token', () => {
  assert.deepEqual(tokenizeXml('<!DOCTYPE note [<!ENTITY a "b">]><note>x</note>')[0], {
    type: 'doctype',
    text: '<!DOCTYPE note [<!ENTITY a "b">]>'
  })
})

test('REQ-002: detect() returns quickly on 100 KB pastes aimed at its regexes', () => {
  for (const payload of ['ab:'.repeat(33334), '1'.repeat(100000) + 'x', '<' + 'a'.repeat(100000)]) {
    const ms = elapsed(() => detect(payload))
    assert.ok(ms < 200, `detect() took ${Math.round(ms)} ms on ${payload.slice(0, 12)}…`)
  }
})

const KEYS = [
  ['PEM', '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMG\n-----END PRIVATE KEY-----', 'MIGHAgEAMBMG'],
  ['PGP', '-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBF\n-----END PGP PRIVATE KEY BLOCK-----', 'lQOYBF']
]

const ENTER = {
  paste: (frame, text) => paste(frame, '#search', text),
  input: (frame, text) =>
    frame.evaluate((value) => {
      const node = document.querySelector('#search')
      node.value = value
      node.dispatchEvent(new Event('input', { bubbles: true }))
    }, text)
}

for (const [name, key, secret] of KEYS) {
  for (const [how, enter] of Object.entries(ENTER)) {
    test(`REQ-003: a ${name} private key entered by ${how} is refused and never shown`, async () => {
      const { page, frame, errors } = await openPanel(browser)
      await enter(frame, key)
      assert.equal(await frame.locator('#search').inputValue(), '')
      assert.equal(await frame.locator('[data-view]:not([hidden])').count(), 0)
      const alert = frame.locator('[role="alert"]')
      assert.equal(await alert.count(), 1)
      assert.match(await alert.textContent(), /private key/)
      assert.equal((await frame.locator('body').innerText()).includes(secret), false)
      assert.equal((await frame.locator('body').textContent()).includes(secret), false)
      assert.equal((await frame.content()).includes(secret), false)
      // Typing afterwards hides the alert again.
      await frame.locator('#search').fill('hash')
      assert.equal(await frame.locator('[role="alert"]:visible').count(), 0)
      assert.deepEqual(errors, [])
      await page.close()
    })
  }
}

test('REQ-003: public keys and certificates are not mistaken for private keys', async () => {
  for (const label of ['PUBLIC KEY', 'CERTIFICATE']) {
    const { page, frame, errors } = await openPanel(browser)
    await paste(frame, '#search', `-----BEGIN ${label}-----\nAAA\n-----END ${label}-----`)
    await frame.waitForSelector('[data-view]:not([hidden])')
    assert.equal(await frame.locator('[data-view]:not([hidden])').count(), 1)
    assert.equal(await frame.locator('[role="alert"]', { hasText: /private key/i }).count(), 0)
    assert.deepEqual(errors, [])
    await page.close()
  }
})

const HEADER = '-----BEGIN ' + 'PRIVATE KEY'.repeat(10000)
const SLOW = [
  ['repeated PRIVATE KEY without a closing line', HEADER, false],
  ['repeated PRIVATE KEY with a closing line', HEADER + '-----', true],
  ['1 MB after BEGIN', '-----BEGIN ' + 'A'.repeat(1000000), false]
]

for (const [name, payload, refused] of SLOW) {
  for (const [how, enter] of Object.entries(ENTER)) {
    test(`REQ-003: ${name} entered by ${how} does not hang the panel`, async () => {
      const { page, frame, errors } = await openPanel(browser)
      const start = performance.now()
      await enter(frame, payload)
      const ms = performance.now() - start
      assert.ok(ms < 300, `entering the text took ${Math.round(ms)} ms`)
      if (refused) {
        assert.equal(await frame.locator('#search').inputValue(), '')
        assert.equal(await frame.locator('[role="alert"]', { hasText: /private key/ }).count(), 1)
      }
      assert.deepEqual(errors, [])
      await page.close()
    })
  }
}
