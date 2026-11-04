import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { TOOLS } from '../src/registry.js'
import { launch, openPanel, paste } from './harness.mjs'

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyNDI2MjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

const CERT = readFileSync(new URL('./fixtures/server.pem', import.meta.url), 'utf8')

let browser
before(async () => (browser = await launch()))
after(async () => browser?.close())

test('lists every tool by group in both themes without CSP violations', async () => {
  for (const theme of ['light', 'dark']) {
    const { page, frame, errors } = await openPanel(browser, { theme })
    const names = await frame.locator('.tool-item .tool-name').allTextContents()
    assert.deepEqual(names.sort(), TOOLS.map((tool) => tool.title).sort())
    assert.deepEqual(await frame.locator('.group h2').allTextContents(), ['Inspect', 'Encode', 'Convert', 'Format', 'Generate', 'Text'])
    assert.equal(await frame.evaluate(() => document.activeElement.id), 'search')
    // Every tool shows its own icon tile.
    assert.equal(await frame.locator('.tool-item .tile svg').count(), TOOLS.length)
    // No horizontal scroll at sidebar width.
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.deepEqual(errors, [])
    await page.close()
  }
})

test('pasting a JWT opens the decoder with its claims', async () => {
  const { page, frame, errors } = await openPanel(browser)
  await paste(frame, '#search', JWT)
  await frame.waitForSelector('[data-view="jwt"]:not([hidden])')
  assert.equal(await frame.locator('.title').textContent(), 'JWT Decoder')
  const view = frame.locator('[data-view="jwt"]')
  assert.match(await view.locator('.out').nth(1).textContent(), /"name": "John Doe"/)
  assert.match(await view.locator('.rows').textContent(), /Expires.*expired/s)
  // Esc returns to the list with an empty search.
  await frame.locator('[data-view="jwt"] textarea').first().press('Escape')
  assert.equal(await frame.locator('.home').isVisible(), true)
  assert.equal(await frame.locator('#search').inputValue(), '')
  assert.deepEqual(await frame.locator('.group').first().locator('h2').textContent(), 'Recent')
  assert.deepEqual(errors, [])
  await page.close()
})

test('typing searches tools by keyword and Enter opens the first match', async () => {
  const { page, frame, errors } = await openPanel(browser)
  await frame.locator('#search').fill('sha256')
  assert.deepEqual(await frame.locator('.tool-item .tool-name').allTextContents(), ['Hash & HMAC'])
  await frame.locator('#search').press('Enter')
  const view = frame.locator('[data-view="hash"]')
  // Enter opens the tool without typing a line break into it.
  assert.equal(await view.locator('textarea').inputValue(), '')
  await view.locator('textarea').fill('abc')
  assert.match(await view.locator('.rows').textContent(), /ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad/)
  await view.locator('input[type="text"]').fill('key')
  assert.match(await view.locator('.rows').textContent(), /HMAC-SHA-256/)
  await frame.locator('.back').click()
  await frame.locator('#search').fill('nothing like this')
  assert.match(await frame.locator('.empty').textContent(), /No tool matches/)
  assert.deepEqual(errors, [])
  await page.close()
})

test('typed values offer the matching tool', async () => {
  const { page, frame, errors } = await openPanel(browser)
  await frame.locator('#search').fill('*/15 * * * *')
  assert.match(await frame.locator('.suggest').textContent(), /Open in Cron/)
  await frame.locator('#search').press('Enter')
  const view = frame.locator('[data-view="cron"]')
  assert.equal(await view.locator('.sentence').textContent(), 'Every 15 minutes')
  assert.equal(await view.locator('.row').count(), 5)
  assert.deepEqual(errors, [])
  await page.close()
})

test('every tool opens and produces output without errors', async () => {
  const { page, frame, errors } = await openPanel(browser)
  const inputs = {
    time: ['input', '1730000000', /2024-10-27T03:33:20\.000Z/],
    base64: ['textarea', 'SGVsbG8sIHdvcmxkIQ==', /Hello, world!/],
    url: ['textarea', 'https://example.com/a?x=1&y=two', /two/],
    json: ['textarea', '{"b":1,"a":2}', /"b": 1/],
    regex: ['textarea', 'ann@a.com bob@b.com', null],
    escape: ['textarea', '<b>&</b>', /&lt;b&gt;&amp;&lt;\/b&gt;/],
    color: ['input', 'hsl(217 91% 60%)', /#3c83f6/],
    number: ['input', '0xff', /0b11111111/],
    chmod: ['input', 'rw-r--r--', /chmod 644 file/],
    case: ['textarea', 'userProfileId', /user_profile_id/],
    lines: ['textarea', 'b\na\nb', /b\na3 lines → 2/],
    stats: ['textarea', 'Hello world', /Words\s*2/],
    diff: ['textarea', 'one\ntwo', null],
    yaml: ['textarea', 'a: 1\nb: [x]', /"b": \[\n\s+"x"/],
    csv: ['textarea', 'n,v\nx,1', /"v": 1/],
    types: ['textarea', '{"id": 1, "tags": ["a"]}', /tags: string\[\]/],
    curl: ['textarea', "curl https://x.dev -H 'A: b'", /fetch\("https:\/\/x\.dev"/],
    cidr: ['input', '10.0.0.0/30', /10\.0\.0\.2/],
    http: ['input', '429', /Too Many Requests/],
    qr: ['textarea', 'https://onorca.dev', /modules/],
    transform: ['textarea', 'Xin chào Đà Nẵng', /Xin chao Da Nang/],
    chars: ['textarea', 'a\u200bb', /ZERO WIDTH SPACE/],
    units: ['input', '1.5 GB', /1,500,000,000/],
    xml: ['textarea', '<a><b>1</b></a>', /<a>\n  <b>1<\/b>\n<\/a>/],
    sql: ['textarea', 'select a from t where x = 1 and y = 2', /WHERE x = 1\n  AND y = 2/],
    cert: ['textarea', CERT, /api\.example\.com/],
    jsx: ['textarea', '<div class="a"><br></div>', /<div className="a"><br \/><\/div>/],
    cssunits: ['input', '32px', /2rem/],
    objectid: ['input', '507f191e810c19729de860ea', /2012-10-17T20:46:22\.000Z/]
  }
  for (const tool of TOOLS) {
    await frame.locator('#search').fill(tool.title)
    await frame.locator(`.tool-item[data-tool="${tool.id}"]`).click()
    const view = frame.locator(`[data-view="${tool.id}"]`)
    await view.waitFor()
    const input = inputs[tool.id]
    if (input) {
      if (tool.id === 'regex') await view.locator('input').first().fill('(\\w+)@')
      if (tool.id === 'base64') await view.getByRole('button', { name: 'Decode' }).click()
      await view.locator(input[0]).first().fill(input[1])
      if (input[2]) assert.match(await view.textContent(), input[2], tool.id)
    }
    if (tool.id === 'regex') assert.match(await view.locator('.subhead').textContent(), /^2 matches/)
    if (tool.id === 'ids') assert.equal((await view.locator('.ids').textContent()).split('\n').length, 5)
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, tool.id)
    await frame.locator('.back').click()
  }
  assert.deepEqual(errors, [])
  await page.close()
})

test('new tools: diff marks changed words, chmod grid stays in sync, colours paste', async () => {
  const { page, frame, errors } = await openPanel(browser)
  await frame.locator('#search').fill('diff')
  await frame.locator('#search').press('Enter')
  const diff = frame.locator('[data-view="diff"]')
  await diff.locator('textarea').nth(0).fill('const answer = 41;\nkeep')
  await diff.locator('textarea').nth(1).fill('const answer = 42;\nkeep\nadded')
  assert.equal(await diff.locator('.block-head').textContent(), '+2 −1Copy')
  assert.equal(await diff.locator('ins').first().textContent(), '42')
  assert.equal(await diff.locator('del').first().textContent(), '41')
  await frame.locator('.back').click()

  await frame.locator('#search').fill('chmod')
  await frame.locator('#search').press('Enter')
  const chmod = frame.locator('[data-view="chmod"]')
  await chmod.getByLabel('Others execute').uncheck()
  assert.equal(await chmod.locator('input.mono').inputValue(), '754')
  assert.match(await chmod.locator('.rows').textContent(), /rwxr-xr--/)
  await frame.locator('.back').click()

  await paste(frame, '#search', '#ff000080')
  const color = frame.locator('[data-view="color"]')
  await color.waitFor()
  assert.match(await color.locator('.rows').first().textContent(), /rgba\(255, 0, 0, 0\.502\)/)
  assert.equal(await frame.locator('.tool-header .tile svg').count(), 1)
  assert.deepEqual(errors, [])
  await page.close()
})

test('JWT verifies and signs; QR renders an image', async () => {
  const { page, frame, errors } = await openPanel(browser)
  await paste(frame, '#search', JWT)
  const jwt = frame.locator('[data-view="jwt"]')
  await jwt.waitFor()
  await jwt.locator('input').first().fill('your-256-bit-secret')
  assert.match(await jwt.locator('.rows').nth(1).textContent(), /invalid/)
  await jwt.getByRole('button', { name: 'Sign', exact: true }).click()
  await jwt.locator('input').nth(1).fill('s3cret')
  assert.match(await jwt.locator('.out').last().textContent(), /^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.eyJ/)
  await frame.locator('.back').click()
  await frame.locator('#search').fill('qr')
  await frame.locator('#search').press('Enter')
  const qr = frame.locator('[data-view="qr"]')
  await qr.locator('textarea').fill('Xin chào 👋')
  assert.equal(await qr.locator('img.qr').evaluate((img) => img.complete && img.naturalWidth > 0), true)
  assert.deepEqual(errors, [])
  await page.close()
})

test('bcrypt hashes and verifies; a pasted data URI previews; passwords generate', async () => {
  const { page, frame, errors } = await openPanel(browser)
  await frame.locator('#search').fill('bcrypt')
  await frame.locator('#search').press('Enter')
  const bcrypt = frame.locator('[data-view="bcrypt"]')
  await bcrypt.locator('input[type="number"]').fill('4')
  await bcrypt.getByPlaceholder('Password').fill('hunter2')
  await frame.waitForFunction(() => /\$2b\$04\$/.test(document.querySelector('[data-view="bcrypt"] .rows')?.textContent ?? ''))
  const hash = (await bcrypt.locator('.row-value').first().textContent()).trim()
  await bcrypt.getByRole('button', { name: 'Verify', exact: true }).click()
  await bcrypt.getByPlaceholder('$2b$10$…').fill(hash)
  await frame.waitForFunction(() => /matches/.test(document.querySelector('[data-view="bcrypt"] .rows')?.textContent ?? ''))
  await frame.locator('.back').click()

  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  await paste(frame, '#search', png)
  const image = frame.locator('[data-view="image"]')
  await image.locator('img.preview').waitFor()
  assert.match(await image.locator('.hint').first().textContent(), /1×1/)
  await frame.locator('.back').click()

  await frame.locator('#search').fill('password')
  await frame.locator('#search').press('Enter')
  const lines = (await frame.locator('[data-view="password"] .out').textContent()).split('\n')
  assert.equal(lines.length, 5)
  assert.equal(lines[0].length, 20)
  assert.deepEqual(errors, [])
  await page.close()
})

test('copy buttons copy, or fall back without throwing', async () => {
  const { page, frame, errors } = await openPanel(browser)
  await paste(frame, '#search', '{"a":1}')
  const copy = frame.locator('[data-view="json"] .block .copy')
  await copy.click()
  await frame.waitForFunction(() => /Copied|Select/.test(document.querySelector('[data-view="json"] .block .copy').textContent))
  assert.deepEqual(errors, [])
  await page.close()
})

test('MongoDB ObjectId: id and local time stay in sync, the sample query follows, bad fields give errors', async () => {
  const { page, frame, errors } = await openPanel(browser)
  await frame.locator('#search').fill('objectid')
  await frame.locator('#search').press('Enter')
  const view = frame.locator('[data-view="objectid"]')
  const id = view.getByLabel('ObjectId', { exact: true })
  const field = (name) => view.getByLabel(name, { exact: true })
  const command = (hex) => `db.collection.find({ _id: { $gt: ObjectId("${hex}") } })`

  // Opening the tool shows the current time, rounded down to the second.
  const opened = await id.inputValue()
  assert.match(opened, /^[0-9a-f]{8}0{16}$/)
  assert.ok(Math.abs(parseInt(opened.slice(0, 8), 16) - Date.now() / 1000) < 60)
  assert.equal(await field('Year').inputValue(), String(new Date(parseInt(opened.slice(0, 8), 16) * 1000).getFullYear()))

  // REQ-019, REQ-023, REQ-024: an ObjectId fills the six fields and the rows.
  await id.fill('507f191e810c19729de860ea')
  assert.equal(await field('Year').inputValue(), '2012')
  assert.equal(await field('Second').inputValue(), '22')
  const rows = await view.locator('.rows').textContent()
  for (const text of ['ObjectId("507f191e810c19729de860ea")', '2012-10-17T20:46:22.000Z', '1350506782', command('507f191e810c19729de860ea')]) {
    assert.ok(rows.includes(text), text)
  }
  const offset = rows.match(/GMT[+-]\d{2}:\d{2}/)?.[0]
  assert.ok(offset)
  assert.ok((await view.locator('.field-label', { hasText: 'Local time' }).textContent()).includes(offset))
  assert.ok((await view.getByRole('group').getAttribute('aria-label')).includes(offset))
  const commandRow = view.locator('.row', { hasText: 'db.collection.find' })
  assert.equal(await commandRow.locator('button.copy').count(), 1)
  await commandRow.locator('button.copy').click()
  await frame.waitForFunction(() => [...document.querySelectorAll('[data-view="objectid"] .row')].some((row) => /db\.collection/.test(row.textContent) && /Copied|Select/.test(row.querySelector('.copy').textContent)))

  // REQ-020, REQ-023: a field rebuilds the ObjectId and the sample query.
  await field('Second').fill('23')
  assert.equal(await id.inputValue(), '507f191f0000000000000000')
  assert.ok((await view.locator('.rows').textContent()).includes(command('507f191f0000000000000000')))
  await field('Hour').fill('0')
  await field('Hour').fill('')
  assert.match(await view.locator('.error').textContent(), /Hour is empty/)

  // REQ-022: no silent date change; every bad field is named.
  await field('Hour').fill('9')
  await field('Month').fill('2')
  await field('Day').fill('30')
  assert.match(await view.locator('.error').textContent(), /no day 30/)
  for (const [name, value, message] of [['Month', '13', /Month/], ['Second', '1.5', /Second/], ['Hour', '24', /Hour/], ['Year', '2107', /2106/], ['Year', '1968', /Year/], ['Year', '1969', /1970/], ['Day', '1e3', /Day/], ['Day', '-0', /Day/]]) {
    for (const [other, text] of [['Hour', '9'], ['Minute', '0'], ['Second', '0'], ['Year', '2026'], ['Month', '2'], ['Day', '3']]) await field(other).fill(text)
    await field(name).fill(value)
    assert.match(await view.locator('.error').textContent(), message, `${name}=${value}`)
  }

  // Hostile text in the ObjectId field: a clear error, no script error, no horizontal scroll.
  for (const text of ['x'.repeat(100000), '__proto__', '"><img src=x onerror=alert(1)>', '😀\u0000\u202e', `ObjectId("507f191e810c19729de860ea')`, '   ']) {
    await id.fill(text)
    assert.equal(await view.locator('.error').count(), text.trim() ? 1 : 0)
    assert.equal(await view.locator('img').count(), 0)
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  }
  await id.fill('ObjectId("507F191E810C19729DE860EA")')
  assert.equal(await field('Year').inputValue(), '2012')
  assert.deepEqual(errors, [])
  await page.close()
})

test('MongoDB ObjectId: a pasted ObjectId opens the tool; layout fits 300 px in both themes', async () => {
  for (const theme of ['light', 'dark']) {
    const { page, frame, errors } = await openPanel(browser, { theme, width: 300 })
    await paste(frame, '#search', 'ObjectId("507f191e810c19729de860ea")')
    await frame.waitForSelector('[data-view="objectid"]:not([hidden])')
    const view = frame.locator('[data-view="objectid"]')
    assert.match(await view.textContent(), /2012-10-17T20:46:22\.000Z/)
    assert.equal(await frame.locator('.tool-header .tile svg').count(), 1)
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    // The three-column grid: three fields share a row.
    const tops = await view.locator('.time-parts input').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)))
    assert.deepEqual([tops[0] === tops[1], tops[1] === tops[2], tops[2] === tops[3], tops[3] === tops[4], tops[4] === tops[5]], [true, true, false, true, true])
    await view.getByLabel('Month', { exact: true }).fill('2')
    await view.getByLabel('Day', { exact: true }).fill('30')
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.deepEqual(errors, [])
    await page.close()
  }
})

// Chromium reads TZ when it starts, so a browser launched with TZ set shows that time zone.
async function launchIn(timeZone) {
  const before = process.env.TZ
  process.env.TZ = timeZone
  try {
    return await launch()
  } finally {
    if (before === undefined) delete process.env.TZ
    else process.env.TZ = before
  }
}

test('MongoDB ObjectId: Now is the current time floored to the second, in every row', async () => {
  const { page, frame, errors } = await openPanel(browser)
  const clock = Date.UTC(2026, 10, 4, 1, 25, 31, 362)
  // Playwright's clock reaches the panel frame too; the time has milliseconds that Now must drop.
  await page.clock.setFixedTime(clock)
  await frame.locator('#search').fill('objectid')
  await frame.locator('#search').press('Enter')
  const view = frame.locator('[data-view="objectid"]')
  await view.getByLabel('ObjectId', { exact: true }).fill('507f191e810c19729de860ea')
  await view.getByRole('button', { name: 'Now', exact: true }).click()
  const rows = await view.locator('.rows').textContent()
  assert.equal(await view.getByLabel('ObjectId', { exact: true }).inputValue(), '6aea898b0000000000000000')
  for (const text of ['ObjectId("6aea898b0000000000000000")', '2026-11-04T01:25:31.000Z', '1793755531000', '1793755531']) assert.ok(rows.includes(text), text)
  assert.ok(!rows.includes('362'))
  assert.deepEqual(errors, [])
  await page.close()
})

test('MongoDB ObjectId: a repeated hour stays in the offset shown, and the label follows the shown date (America/New_York)', async () => {
  const ny = await launchIn('America/New_York')
  try {
    const { page, frame, errors } = await openPanel(ny)
    await frame.locator('#search').fill('objectid')
    await frame.locator('#search').press('Enter')
    const view = frame.locator('[data-view="objectid"]')
    const id = view.getByLabel('ObjectId', { exact: true })
    const field = (name) => view.getByLabel(name, { exact: true })
    const label = () => view.locator('.field-label', { hasText: 'Local time' }).textContent()

    // The label is the offset of the displayed date, not of today.
    await id.fill('507f191e810c19729de860ea')
    assert.equal(await label(), 'Local time (GMT-04:00)')
    assert.equal(await field('Hour').inputValue(), '16')
    await id.fill('6955b9000000000000000000')
    assert.equal(await label(), 'Local time (GMT-05:00)')
    assert.equal(await field('Year').inputValue(), '2025')

    // 2025-11-02 01:30 happens twice. The second one is 06:30Z (GMT-05:00).
    await id.fill('6906fa68')
    assert.match(await view.locator('.error').textContent(), /24 hex/)
    await id.fill('6906fa680000000000000000')
    assert.equal(await label(), 'Local time (GMT-05:00)')
    assert.deepEqual([await field('Hour').inputValue(), await field('Minute').inputValue()], ['1', '30'])
    assert.ok((await view.locator('.rows').textContent()).includes('2025-11-02T06:30:00.000Z'))
    await field('Second').fill('1')
    assert.equal(await id.inputValue(), '6906fa690000000000000000')
    assert.equal(await label(), 'Local time (GMT-05:00)')
    assert.ok((await view.locator('.rows').textContent()).includes('2025-11-02T06:30:01.000Z'))
    await field('Minute').fill('45')
    assert.equal(await id.inputValue(), '6906fded0000000000000000')
    assert.equal(await label(), 'Local time (GMT-05:00)')
    // The first one is 05:30Z (GMT-04:00) and stays there.
    await id.fill('6906ec580000000000000000')
    assert.equal(await label(), 'Local time (GMT-04:00)')
    await field('Second').fill('1')
    assert.equal(await id.inputValue(), '6906ec590000000000000000')
    assert.equal(await label(), 'Local time (GMT-04:00)')
    // Leaving the repeated hour reads the new time with its own offset.
    await field('Hour').fill('3')
    assert.equal(await label(), 'Local time (GMT-05:00)')
    assert.equal(await id.inputValue(), '690716890000000000000000')
    // A time the clock skips is an error, and the ObjectId is not changed.
    await field('Year').fill('2026')
    await field('Month').fill('3')
    await field('Day').fill('8')
    await field('Hour').fill('2')
    await field('Minute').fill('30')
    assert.match(await view.locator('.error').textContent(), /does not exist/)
    assert.deepEqual(errors, [])
    await page.close()
  } finally {
    await ny.close()
  }
})

test('MongoDB ObjectId: a half-typed number says it is not a whole number', async () => {
  const { page, frame, errors } = await openPanel(browser)
  await frame.locator('#search').fill('objectid')
  await frame.locator('#search').press('Enter')
  const view = frame.locator('[data-view="objectid"]')
  const year = view.getByLabel('Year', { exact: true })
  await year.fill('')
  await year.pressSequentially('20e')
  assert.equal(await year.evaluate((node) => node.validity.badInput), true)
  assert.match(await view.locator('.error').textContent(), /^Year is not a whole number\.?$/)
  await year.fill('')
  assert.match(await view.locator('.error').textContent(), /Year is empty/)
  assert.deepEqual(errors, [])
  await page.close()
})

test('MongoDB ObjectId sits in Inspect right after Timestamp (REQ-026)', async () => {
  const at = TOOLS.findIndex((tool) => tool.id === 'time')
  assert.equal(TOOLS[at + 1].id, 'objectid')
  assert.equal(TOOLS[at + 1].group, 'Inspect')
  const { page, frame, errors } = await openPanel(browser)
  const inspect = await frame.locator('.group', { has: frame.locator('h2', { hasText: /^Inspect$/ }) }).locator('.tool-item .tool-name').allTextContents()
  assert.equal(inspect[inspect.indexOf('Timestamp') + 1], 'MongoDB ObjectId')
  assert.deepEqual(errors, [])
  await page.close()
})
