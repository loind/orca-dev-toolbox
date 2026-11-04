// Phase 2: JSONPath must not hang or overflow the stack, semver errors must not echo megabytes,
// and the SQL table name of the mock tool must be an identifier.
// REQ-032: big results and deep data. REQ-033: the linear regex matcher (src/tools/linear-regex.js) and the
// path tokenizer. REQ-034: semver messages, linear parseVersion, the error text wraps. REQ-035: SQL table.
// Anything that could hang when the code is broken runs in a child process with a timeout, so a broken
// fix turns the test red within 10 s instead of hanging the gate.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, before, test } from 'node:test'
import { parsePath as parseUpstream, queryJson as queryUpstream } from '../fixtures/jsonpath-upstream-0.6.1.js'
import { parseVersion as parseVersionUpstream } from '../fixtures/semver-upstream-0.6.1.js'
import { launch, openPanel } from '../harness.mjs'
import { parsePath, queryJson } from '../../src/tools/jsonpath.js'
import { Regex } from '../../src/tools/linear-regex.js'
import { formatRows, seededRandom } from '../../src/tools/mock.js'
import { compareVersions, describeRange, increment, parseRange, parseVersion, satisfies, shown } from '../../src/tools/semver.js'

const timed = (fn) => {
  const start = performance.now()
  const result = fn()
  return { result, ms: performance.now() - start }
}

test('REQ-032: $..id on 200,000 objects returns 200,000 results', () => {
  const data = { a: Array.from({ length: 200000 }, (_, id) => ({ id })) }
  const { result, ms } = timed(() => queryJson(data, '$..id'))
  assert.equal(result.length, 200000)
  assert.equal(result[199999].value, 199999)
  assert.ok(ms < 10000, `took ${ms} ms`)
})

test('REQ-032: a slice of 1,000,000 elements returns 1,000,000 results', () => {
  const { result, ms } = timed(() => queryJson({ a: Array(1000000).fill(1) }, '$.a[0:1000000000]'))
  assert.equal(result.length, 1000000)
  assert.ok(ms < 10000, `took ${ms} ms`)
})

test('REQ-032: a filter that keeps 200,000 elements returns 200,000 results', () => {
  const data = { a: Array.from({ length: 200000 }, (_, id) => ({ id })) }
  const { result, ms } = timed(() => queryJson(data, '$.a[?(@.id==@.id)]'))
  assert.equal(result.length, 200000)
  assert.ok(ms < 10000, `took ${ms} ms`)
})

test('REQ-032: $..x on JSON nested 3,000 levels deep', () => {
  // Built with a loop: JSON.parse refuses this depth on some engines.
  let node = { x: 'leaf' }
  let objects = 1
  for (let i = 0; i < 3000; i++) {
    if (i % 2) {
      node = { x: node }
      objects++
    } else node = [node]
  }
  const { result, ms } = timed(() => queryJson(node, '$..x'))
  assert.equal(result.length, objects)
  assert.equal(result[objects - 1].value, 'leaf')
  assert.ok(ms < 10000, `took ${ms} ms`)
})

test('REQ-032: $..x on JSON nested 30,000 levels deep (ten times the contract, to catch a recursion)', () => {
  let node = { x: 'leaf' }
  for (let i = 0; i < 30000; i++) node = [node]
  assert.deepEqual(queryJson(node, '$..x').map((m) => m.value), ['leaf'])
})


let browser
before(async () => (browser = await launch()))
after(async () => browser?.close())

const here = import.meta.url
const url = (relative) => JSON.stringify(new URL(relative, here).href)
/** Runs `body` (an ES module that prints JSON) in a child node; a hang or a crash is a failed test. */
function inChild(body, timeout = 10000) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', body], { timeout, encoding: 'utf8', maxBuffer: 1 << 26 })
  assert.ok(!child.error, `child did not finish in ${timeout} ms: ${child.error?.code}`)
  assert.equal(child.status, 0, child.stderr.slice(0, 500))
  return JSON.parse(child.stdout)
}

const NOT_ALLOWED = (error) => error.message.startsWith('This regular expression is not allowed')
const NOT_SUPPORTED = (error) => /^This regular expression is not allowed: .+ (is|are) not supported$/.test(error.message)
// A path string literal: the tokenizer removes one backslash level.
const lit = (pattern) => `'${pattern.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const via = {
  match: (pattern, subject) => queryJson({ a: [{ v: subject }] }, `$.a[?(match(@.v, ${lit(pattern)}))]`).length === 1,
  search: (pattern, subject) => queryJson({ a: [{ v: subject }] }, `$.a[?(search(@.v, ${lit(pattern)}))]`).length === 1
}
const literal = (pattern, subject, flags = '') => queryJson({ a: [{ v: subject }] }, `$.a[?(@.v =~ /${pattern}/${flags})]`).length === 1

test('REQ-033: the patterns that used to hang answer fast and right, on 10,000 characters, in all three modes', () => {
  // [pattern, subject, search/=~ answer, match answer]; null means "not a valid pattern".
  const a = 'a'.repeat(9999) + '!'
  const cases = [
    ['(a+)+$', a, false, false],
    ['(a|aa)+$', a, false, false],
    ['(a*)*b', a, false, false],
    ['(.*a){20}', a, true, false],
    ['(a?)+$', a, true, false],
    ['a*a*a*a*b', a, false, false],
    ['^(a|a?){16}b', a, false, false],
    ['^(a|aa){26}$', a, false, false],
    ['(a|a){40}b', a, false, false],
    ['\\w+\\w+\\w+\\w+$', a, false, false],
    ['\\w+\\w+\\w+\\w+\\w+\\w+$', 'a'.repeat(10000), true, true],
    ['^(a|a?){16}$', 'a'.repeat(10000), false, false],
    ['(x+x+)+y', 'x'.repeat(10000), false, false],
    ['(?:(?:a?)?){40}c', 'aaaa', false, false],
    ['a+)+(?:b', a, null, null]
  ]
  const results = inChild(`
    import { queryJson } from ${url('../../src/tools/jsonpath.js')}
    import { Regex } from ${url('../../src/tools/linear-regex.js')}
    const lit = (p) => "'" + p.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'") + "'"
    const out = []
    for (const [pattern, subject] of ${JSON.stringify(cases.map(([p, s]) => [p, s]))}) {
      for (const mode of ['=~', 'match', 'search', 'Regex.search', 'Regex.match']) {
        const start = performance.now()
        let result
        let error
        try {
          const data = { a: [{ v: subject }] }
          if (mode === '=~') result = queryJson(data, '$.a[?(@.v =~ /' + pattern + '/)]').length === 1
          else if (mode === 'match' || mode === 'search') result = queryJson(data, '$.a[?(' + mode + '(@.v, ' + lit(pattern) + '))]').length === 1
          else result = new Regex(pattern, '', mode === 'Regex.match').test(subject)
        } catch (e) { error = e.message }
        out.push({ pattern, mode, ms: performance.now() - start, result, error })
      }
    }
    console.log(JSON.stringify(out))`)
  assert.equal(results.length, cases.length * 5)
  for (const { pattern, mode, ms, result, error } of results) {
    const [, , search, match] = cases.find(([p]) => p === pattern)
    const where = `${mode} ${pattern}`
    assert.ok(ms < 1000, `${where} took ${ms} ms`)
    if (search === null) {
      assert.ok(error, `${where} should be a syntax error`)
      if (mode !== '=~') assert.ok(error.startsWith('This regular expression is not allowed'), `${where}: ${error}`)
    } else {
      assert.equal(error, undefined, `${where}: ${error}`)
      assert.equal(result, mode === 'match' || mode === 'Regex.match' ? match : search, where)
    }
  }
})

test('REQ-033: a pattern whose repeats would expand to millions of steps is refused fast, and so is a huge subject', () => {
  const results = inChild(`
    import { Regex } from ${url('../../src/tools/linear-regex.js')}
    const out = []
    for (const pattern of ['a{1000}{1000}', '(((a{100}){100}){100}){100}', '((((a{100}){100}){100}){100}){100}', '(a{0,1000}){0,1000}', '(x|y){1000}{1000}', '(((((a?){9}){9}){9}){9}){9}']) {
      const start = performance.now()
      let message = 'did not throw'
      try { new Regex(pattern) } catch (e) { message = e.message }
      out.push({ pattern, ms: performance.now() - start, message })
    }
    // An empty body repeated without end is not expanded: these are accepted at once (or refused for their size).
    for (const pattern of ['((a{0}){99999999999})b', '(?:){99999999}a', '((a{0}){99999999999}){99999999999}a{3000}']) {
      const start = performance.now()
      let message = 'accepted'
      try { new Regex(pattern) } catch (e) { message = e.message }
      out.push({ pattern, ms: performance.now() - start, message })
    }
    const start = performance.now()
    const answer = new Regex('(a|aa)+b').test('a'.repeat(1000000))
    out.push({ pattern: 'a million characters', ms: performance.now() - start, message: String(answer) })
    console.log(JSON.stringify(out))`)
  for (const { pattern, ms, message } of results.slice(0, -1)) {
    assert.ok(ms < 1000, `${pattern} took ${ms} ms`)
    if (pattern === '((a{0}){99999999999})b' || pattern === '(?:){99999999}a') assert.equal(message, 'accepted', pattern)
    else assert.ok(message.startsWith('This regular expression is not allowed'), `${pattern}: ${message}`)
  }
  assert.ok(results.at(-1).ms < 200 && results.at(-1).message === 'false')
})

test('REQ-033: flag i follows JavaScript for every BMP case-equivalence class', () => {
  const one = (text) => (text.length === 1 ? text.charCodeAt(0) : -1)
  // Candidate classes: code units linked by a single-unit upper or lower case mapping. JavaScript's own
  // /c/i decides which pairs inside a candidate class really match, so the table under test is not the judge.
  const parent = new Map()
  const find = (c) => (parent.get(c) === undefined || parent.get(c) === c ? c : find(parent.get(c)))
  for (let c = 0; c <= 0xffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue
    const s = String.fromCharCode(c)
    for (const other of [one(s.toUpperCase()), one(s.toLowerCase())]) {
      if (other < 0 || other === c) continue
      if (!parent.has(c)) parent.set(c, c)
      if (!parent.has(other)) parent.set(other, other)
      parent.set(find(c), find(other))
    }
  }
  const groups = new Map()
  for (const c of parent.keys()) groups.set(find(c), [...(groups.get(find(c)) ?? []), c])
  const esc = (c) => `\\u${c.toString(16).padStart(4, '0')}`
  const ch = (c) => String.fromCharCode(c)
  let pairs = 0
  const check = (c, d) => {
    for (const [pattern, js] of [[esc(c), new RegExp(esc(c), 'i')], [`[${esc(c)}]`, new RegExp(`[${esc(c)}]`, 'i')], [`[^${esc(c)}]`, new RegExp(`[^${esc(c)}]`, 'i')]]) {
      assert.equal(new Regex(pattern, 'i').test(ch(d)), js.test(ch(d)), `/${pattern}/i on U+${d.toString(16)}`)
    }
    pairs++
  }
  for (const members of groups.values()) for (const c of members) for (const d of members) check(c, d)
  // A sample of pairs that are not related, and every related character against 'a', 'k', 's' and 'z'.
  const all = [...parent.keys()]
  for (let k = 0; k < 4000; k++) check(all[(k * 7919) % all.length], all[(k * 104729 + 13) % all.length])
  for (const c of all) for (const d of [0x61, 0x6b, 0x73, 0x7a, 0x41, 0x4b, 0x53, 0x5a, 0x17f, 0x212a]) check(c, d)
  assert.ok(groups.size > 1000 && pairs > 8000, `${groups.size} classes, ${pairs} pairs`)
  for (const [c, d] of [['ς', 'Σ'], ['ς', 'σ'], ['µ', 'μ'], ['ǅ', 'ǆ'], ['ǅ', 'Ǆ'], ['ϑ', 'θ'], ['ẛ', 'ṡ'], [String.fromCharCode(0x345), 'ι'], [String.fromCharCode(0x1fbe), 'ι']]) {
    assert.equal(new Regex(c, 'i').test(d), true, `${c} ${d}`)
    assert.equal(new Regex(`[${c}]`, 'i').test(d), true, `[${c}] ${d}`)
    assert.equal(new Regex(`[^${c}]`, 'i').test(d), false, `[^${c}] ${d}`)
  }
  assert.equal(new Regex('^a$', 'i').test('A'), true)
  assert.equal(new Regex('^[a-z]+$', 'i').test('ABCdef'), true)
  assert.equal(new Regex('^[^a-z]+$', 'i').test('ABC'), false)
})

test('REQ-033: one query has a work budget for all its regex matches; an ordinary query never reaches it', () => {
  const results = inChild(`
    import { queryJson } from ${url('../../src/tools/jsonpath.js')}
    const out = []
    const run = (name, data, path) => {
      const start = performance.now()
      let outcome
      try { outcome = 'results:' + queryJson(data, path).length } catch (e) { outcome = e.message }
      out.push({ name, ms: performance.now() - start, outcome })
    }
    const heavy = Array.from({ length: 200000 }, () => ({ v: 'a'.repeat(100) }))
    let letters = ''
    for (let c = 0x4e00; c < 0x4e00 + 170; c++) letters += String.fromCharCode(c)
    run('classes', { a: heavy }, '$.a[?(@.v =~ /[' + letters + 'a]{0,990}c/)]')
    run('alternatives', { a: heavy }, '$.a[?(@.v =~ /(a|aa|aaa|aaaa){1,100}b/)]')
    run('match()', { a: heavy }, "$.a[?(match(@.v, '(a|aa|aaa|aaaa){1,100}b'))]")
    // The budget is per query: an ordinary query right after a heavy one still works.
    const words = Array.from({ length: 20000 }, (_, k) => ({ v: 'x'.repeat(190) + 'word' + k }))
    run('ordinary', { a: words }, '$.a[?(@.v =~ /word19999/)]')
    run('ordinary, i flag', { a: words }, '$.a[?(@.v =~ /WORD19999/i)]')
    run('ordinary, match()', { a: words }, "$.a[?(match(@.v, 'x+word1999.'))]")
    run('ordinary again', { a: words }, '$.a[?(@.v =~ /word19999/)]')
    // Twenty-four ways to start, and text that holds none of them: positions that cannot start a match cost nothing.
    const starts = Array.from({ length: 24 }, (_, k) => String.fromCharCode(97 + k) + 'q').join('|')
    const zs = Array.from({ length: 5000 }, () => ({ v: 'z'.repeat(2000) }))
    run('no start character in the text', { a: zs }, '$.a[?(@.v =~ /(' + starts + ')y/)]')
    console.log(JSON.stringify(out))`, 30000)
  const by = Object.fromEntries(results.map((r) => [r.name, r]))
  for (const name of ['classes', 'alternatives', 'match()']) {
    assert.ok(by[name].ms < 3000, `${name} took ${by[name].ms} ms`)
    assert.ok(by[name].outcome.startsWith('This query does too much regular expression work'), `${name}: ${by[name].outcome}`)
  }
  for (const name of ['ordinary', 'ordinary, i flag', 'ordinary again']) assert.equal(by[name].outcome, 'results:1', name)
  assert.equal(by['no start character in the text'].outcome, 'results:0')
  assert.equal(by['ordinary, match()'].outcome, 'results:10') // word19990 .. word19999
})

test('REQ-033: compile and set-up cost count against the budget (patterns from the data, a million elements)', () => {
  const results = inChild(`
    import { queryJson } from ${url('../../src/tools/jsonpath.js')}
    const out = []
    const run = (name, data, path) => {
      const start = performance.now()
      let outcome
      try { outcome = 'results:' + queryJson(data, path).length } catch (e) { outcome = e.message }
      out.push({ name, ms: performance.now() - start, outcome })
    }
    const many = Array.from({ length: 1000000 }, (_, i) => ({ v: 'x' + i }))
    run('big repeat, a million elements', { a: many }, '$.a[?(@.v =~ /b{1990}/)]')
    run('big class repeat, a million elements', { a: many }, '$.a[?(@.v =~ /[a-z]{1000}[0-9]{990}/)]')
    // Every element carries its own big pattern: each one is compiled.
    const own = Array.from({ length: 20000 }, (_, i) => ({ v: 'bbb', p: 'b{1900}' + i }))
    run('a different pattern in every element', { a: own }, '$.a[?(match(@.v, @.p))]')
    const own2 = Array.from({ length: 3000 }, (_, i) => ({ v: 'bbb', p: 'a{1990}' + i }))
    run('3,000 patterns of 1,990 steps', { a: own2 }, '$.a[?(match(@.v, @.p))]')
    // The subject is too long to be searched, so only the compiling costs anything.
    const long = 'x'.repeat(10001)
    const own3 = Array.from({ length: 100000 }, (_, i) => ({ v: long, p: 'b{1900}' + i }))
    run('compiling only', { a: own3 }, '$.a[?(match(@.v, @.p))]')
    console.log(JSON.stringify(out))`, 40000)
  assert.equal(results.length, 5)
  for (const { name, ms, outcome } of results) {
    assert.ok(ms < 3000, `${name} took ${ms} ms`)
    assert.ok(outcome.startsWith('This query does too much regular expression work'), `${name}: ${outcome}`)
  }
})

test('REQ-033: a cheap-looking pattern whose threads each walk a long closure counts that walk against the budget', () => {
  const alternatives = '(?:' + Array.from({ length: 95 }, () => 'a').join('|') + ')+$'
  const results = inChild(`
    import { queryJson } from ${url('../../src/tools/jsonpath.js')}
    const out = []
    const data = { a: Array.from({ length: 3 }, () => ({ v: 'a'.repeat(10000) })) }
    const lit = (p) => "'" + p + "'"
    for (const pattern of ['(?:a?){990}$', '(?:a?){990}b', ${JSON.stringify(alternatives)}]) {
      for (const mode of ['=~', 'match']) {
        const path = mode === '=~' ? '$.a[?(@.v =~ /' + pattern + '/)]' : '$.a[?(match(@.v, ' + lit(pattern) + '))]'
        const start = performance.now()
        let outcome
        try { outcome = 'results:' + queryJson(data, path).length } catch (e) { outcome = e.message }
        out.push({ name: mode + ' ' + pattern.slice(0, 14), ms: performance.now() - start, outcome })
      }
    }
    console.log(JSON.stringify(out))`, 40000)
  assert.equal(results.length, 6)
  for (const { name, ms, outcome } of results) {
    assert.ok(ms < 3000, `${name} took ${ms} ms`)
    assert.ok(outcome.startsWith('This query does too much regular expression work') || /^results:\d+$/.test(outcome), `${name}: ${outcome}`)
  }
})

test('REQ-033: ordinary patterns on an ordinary 10 MB log stay within the budget and agree with RegExp', () => {
  const results = inChild(`
    import { queryJson } from ${url('../../src/tools/jsonpath.js')}
    import { seededRandom } from ${url('../../src/tools/mock.js')}
    const random = seededRandom(1004)
    const pick = (list) => list[Math.floor(random() * list.length)]
    const words = ['request', 'served', 'user', 'login', 'session', 'cache', 'miss', 'hit', 'database', 'query', 'slow', 'retry', 'upstream', 'gateway', 'payment', 'order', 'created', 'updated', 'queue', 'worker', 'started', 'finished', 'connection', 'closed', 'opened', 'token', 'expired', 'refreshed', 'file', 'uploaded', 'resource', 'not', 'found']
    const levels = ['INFO', 'INFO', 'INFO', 'DEBUG', 'WARN', 'ERROR']
    const rare = ['error: connection refused', 'timeout while reading', 'access denied', 'invalid token', 'fatal: out of memory', 'panic: stack overflow']
    const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(random() * 16)]).join('')
    const lines = []
    let size = 0
    while (size < 10 * 1024 * 1024) {
      const when = '2026-' + String(1 + Math.floor(random() * 12)).padStart(2, '0') + '-' + String(1 + Math.floor(random() * 28)).padStart(2, '0') + 'T' + String(Math.floor(random() * 24)).padStart(2, '0') + ':' + String(Math.floor(random() * 60)).padStart(2, '0') + ':' + String(Math.floor(random() * 60)).padStart(2, '0') + 'Z'
      let text = when + ' ' + pick(levels) + ' [' + pick(['api', 'web', 'worker', 'db']) + '-' + Math.floor(random() * 20) + '] id=' + hex(12)
      for (let n = 6 + Math.floor(random() * 14); n > 0; n--) text += ' ' + pick(words)
      if (random() < 0.05) text += ' ' + pick(rare)
      if (random() < 0.08) text += ' user' + Math.floor(random() * 5000) + '@example' + Math.floor(random() * 9) + '.com'
      lines.push({ msg: text })
      size += text.length
    }
    const data = { a: lines }
    const jobs = [
      ['error|warn|... /i', '$.a[?(@.msg =~ /error|warn|fail|fatal|panic|crash|timeout|denied|refused|invalid/i)]', /error|warn|fail|fatal|panic|crash|timeout|denied|refused|invalid/i],
      ['.*timeout.*', '$.a[?(@.msg =~ /.*timeout.*/)]', /.*timeout.*/],
      ['\\\\w+@\\\\w+\\\\.\\\\w+', '$.a[?(@.msg =~ /\\\\w+@\\\\w+\\\\.\\\\w+/)]', /\\w+@\\w+\\.\\w+/],
      ['(\\\\w+) x4 $', '$.a[?(@.msg =~ /(\\\\w+) (\\\\w+) (\\\\w+) (\\\\w+)$/)]', /(\\w+) (\\w+) (\\w+) (\\w+)$/],
      ['\\\\d{4}-\\\\d{2}-\\\\d{2}', '$.a[?(@.msg =~ /\\\\d{4}-\\\\d{2}-\\\\d{2}/)]', /\\d{4}-\\d{2}-\\d{2}/],
      ["match('.*error.*')", "$.a[?(match(@.msg, '.*error.*'))]", /^(?:.*error.*)$/]
    ]
    const out = [{ name: 'log', ms: 0, outcome: lines.length + ' lines, ' + size + ' characters', expected: '' }]
    for (const [name, path, js] of jobs) {
      const expected = 'results:' + lines.filter((l) => js.test(l.msg)).length
      const start = performance.now()
      let outcome
      try { outcome = 'results:' + queryJson(data, path).length } catch (e) { outcome = e.message }
      out.push({ name, ms: performance.now() - start, outcome, expected })
    }
    console.log(JSON.stringify(out))`, 120000)
  assert.ok(/^\d+ lines, \d+ characters$/.test(results[0].outcome) && Number.parseInt(results[0].outcome) >= 50000, results[0].outcome)
  for (const { name, ms, outcome, expected } of results.slice(1)) {
    assert.equal(outcome, expected, name)
    assert.ok(ms < 10000, `${name} took ${ms} ms`) // wide on purpose: the real assertions are the answer and no budget error
  }
})

test('REQ-033: tokenizer: an unclosed string or regex literal with 4,000 backslashes parses in linear time', () => {
  const results = inChild(`
    import { parsePath } from ${url('../../src/tools/jsonpath.js')}
    const paths = ["$[?(@.a=='" + '\\\\'.repeat(4000) + "\\n')]", '$[?(@.a=~/' + '\\\\'.repeat(4000) + ')]', "$[?(@.a==\\"" + '\\\\'.repeat(4001) + "\\")]", '$[?(@.a=~/' + 'a\\\\/'.repeat(2000) + ')]']
    const out = []
    for (const path of paths) {
      const start = performance.now()
      let outcome = 'parsed'
      try { parsePath(path) } catch (e) { outcome = e.message.slice(0, 60) }
      out.push({ ms: performance.now() - start, outcome })
    }
    console.log(JSON.stringify(out))`)
  for (const { ms, outcome } of results) assert.ok(ms < 200, `took ${ms} ms (${outcome})`)
})

test('REQ-033: tokenizer: closed literals read as before', () => {
  const rows = [{ v: "it's" }, { v: 'x/y' }, { v: 'say "hi"' }, { v: 'a\\b' }]
  for (const path of ["$[?(@.v == 'it\\'s')]", '$[?(@.v =~ /x\\/y/)]', '$[?(@.v == "say \\"hi\\"")]', "$[?(@.v == 'a\\\\b')]", "$[?(@.v == 'it\\'s' || @.v == 'x/y')]", '$[?(@.v =~ /^[a-z]\\/[a-z]$/)]']) {
    const wanted = queryUpstream(rows, path).map((m) => m.path)
    assert.deepEqual(queryJson(rows, path).map((m) => m.path), wanted, path)
  }
  assert.equal(queryJson(rows, "$[?(@.v == 'it\\'s')]").length, 1)
  assert.equal(queryJson(rows, '$[?(@.v =~ /x\\/y/)]').length, 1)
  // Same errors as before for literals that never close.
  for (const path of ["$[?(@.a=='abc)]", '$[?(@.a=~/abc)]', "$[?(@.a=='a\\\nb')]"]) {
    const message = (fn) => { try { fn(); return 'ok' } catch (e) { return e.message } }
    assert.equal(message(() => parsePath(path)), message(() => parseUpstream(path)), path)
  }
})

test('REQ-033: ordinary patterns run and give the right answer', () => {
  const cases = [
    ['^[A-Z]\\w+$', 'Hello', 'hello'],
    ['^\\d{3}-\\d{4}$', '555-1234', '5551234'],
    ['^(png|jpg)$', 'png', 'gif'],
    ['^(\\d{3}-){2}\\d{4}$', '555-123-4567', '555-4567'],
    ['^(\\d{1,3}\\.){3}\\d{1,3}$', '192.168.1.1', '192.168.1'],
    ['^a+!$', 'aaa!', 'aaa'],
    ['(a|b){3}', 'xabax', 'xabx'],
    ['^[\\w.+-]+@[\\w-]+\\.[\\w.-]+$', 'a.b+c@x-y.example.com', 'a@b'],
    ['(https?|ftp)+', 'see ftp://x', 'see file://x'],
    ['^(https?|ftp)+://', 'https://x', 'gopher://x'],
    ['(a|b)*c', 'abac', 'abab'],
    ['\\(a\\*\\|b\\)', 'x(a*|b)x', 'x(a|b)x'],
    ['[+*|(]+x', 'a*|(x', 'a*|(']
  ]
  for (const [pattern, yes, no] of cases) {
    const names = pattern.startsWith('^') && pattern.endsWith('$') ? ['search', 'match'] : ['search']
    for (const name of names) {
      assert.equal(via[name](pattern, yes), true, `${name} ${pattern} on ${yes}`)
      assert.equal(via[name](pattern, no), false, `${name} ${pattern} on ${no}`)
    }
    if (!/\[\+\*\|\(\]|\//.test(pattern)) {
      assert.equal(literal(pattern, yes), true, `=~ ${pattern} on ${yes}`)
      assert.equal(literal(pattern, no), false, `=~ ${pattern} on ${no}`)
    }
  }
  assert.equal(via.search('(a|b)*', ''), true)
  assert.equal(via.match('(a|b)*', 'abba'), true)
  assert.equal(via.match('(a|b)*', 'abca'), false)
  assert.equal(via.match('a', 'aa'), false)
  assert.equal(via.search('a', 'ba'), true)
  assert.equal(literal('^abc$', 'ABC', 'i'), true)
  assert.equal(literal('^abc$', 'ABC'), false)
})

test('REQ-033: a search that jumps ahead still sees assertions again at the new position', () => {
  // The first 'a' leads to \b, which is false before 'c'; at the later 'b' the same \b is true.
  for (const [pattern, subject] of [['a?\\bb', 'ac b'], ['(?:a\\b)?\\bb', 'ac b'], ['a?$', 'ac'], ['a?\\Bb', 'a bcb'], ['x?^y', 'xa\ny']]) {
    for (const flags of ['', 'm']) {
      assert.equal(new Regex(pattern, flags).test(subject), new RegExp(pattern, flags).test(subject), `/${pattern}/${flags} on ${JSON.stringify(subject)}`)
    }
  }
  assert.equal(new Regex('a?\\bb').test('ac b'), true)
})

test('REQ-033: flags i, m and s behave as in JavaScript; g and y keep the state of a shared RegExp', () => {
  assert.equal(literal('^b', 'a\nb', 'm'), true)
  assert.equal(literal('^b', 'a\nb'), false)
  assert.equal(literal('a$', 'a\nb', 'm'), true)
  assert.equal(literal('a.b', 'a\nb', 's'), true)
  assert.equal(literal('a.b', 'a\nb'), false)
  assert.equal(literal('A', 'a', 'i'), true)
  // The literal is one RegExp for all elements of a filter: with g or y, lastIndex carries over (as in the code before).
  for (const flags of ['g', 'y', 'gy', 'i', 'gi', 'yi']) {
    for (const pattern of ['a', '^a', 'a+', 'b*', 'a|b', '\\bb', '$']) {
      const rows = ['a', 'ab', 'aab', 'ba', '', 'a', 'b', 'abab'].map((v) => ({ v }))
      const wanted = queryUpstream(rows, `$[?(@.v =~ /${pattern}/${flags})]`).map((m) => m.path)
      assert.deepEqual(queryJson(rows, `$[?(@.v =~ /${pattern}/${flags})]`).map((m) => m.path), wanted, `/${pattern}/${flags}`)
    }
  }
})

test('REQ-033: =~, match() and search() give the same yes/no as JavaScript; g and y keep lastIndex (seeded property test)', () => {
  // Flags '', i, m and s, patterns of the supported syntax, subjects of up to 12 characters: 24,000+ pairs per mode.
  const result = inChild(`await import(${url('./regex-property.mjs')})`, 60000)
  assert.deepEqual(result.bad, [])
  assert.ok(result.patterns >= 8000 && result.pairs >= 48000, `${result.patterns} patterns, ${result.pairs} pairs`)
  assert.ok(result.queries >= 200 && result.stateful >= 500, `${result.queries} queries, ${result.stateful} stateful steps`)
})

test('REQ-033: unsupported syntax, syntax errors and the size limits give an error that starts with the rule name', () => {
  for (const pattern of ['(?i:a)', '(?-i:a)', '(?s:.)', '\\1', '(a)\\1', '(?<n>a)\\k<n>', '(?=a)', '(?!a)', '(?<=a)', '(?<!a)', '\\p{L}', '\\P{L}']) {
    assert.throws(() => new Regex(pattern), NOT_SUPPORTED, pattern)
    assert.throws(() => via.search(pattern, 'a'), NOT_SUPPORTED, pattern)
  }
  assert.throws(() => new Regex('(?i:a)'), (e) => e.message === 'This regular expression is not allowed: inline flags (?i:...) are not supported')
  assert.throws(() => queryJson({}, '$[?(@.v =~ /a/u)]'), NOT_SUPPORTED)
  assert.throws(() => queryJson({}, '$[?(@.v =~ /a/v)]'), Error)
  assert.throws(() => new Regex('a', 'u'), NOT_SUPPORTED)
  for (const pattern of ['(', 'a)', '(a', '[a', '*a', 'a**', 'a{2,1}', '[b-a]', 'a\\', '+', '(?', '(?x)', '^*', '\\b+', 'a{1}{2}']) {
    assert.throws(() => new Regex(pattern), NOT_ALLOWED, pattern)
  }
  assert.throws(() => new Regex('a', 'gg'), NOT_ALLOWED)
  assert.throws(() => new Regex('a', 'x'), NOT_ALLOWED)
  // Size: 200 characters of pattern, 2,000 instructions, 10,000 characters of subject.
  assert.doesNotThrow(() => new Regex('a'.repeat(200)))
  assert.throws(() => new Regex('a'.repeat(201)), NOT_ALLOWED)
  assert.throws(() => via.search('a'.repeat(201), 'a'), NOT_ALLOWED)
  assert.throws(() => new Regex('a{1000}{1000}'), NOT_ALLOWED)
  assert.throws(() => new Regex('(((a{100}){100}){100}){100}'), NOT_ALLOWED)
  assert.doesNotThrow(() => new Regex('a{2000}'))
  assert.doesNotThrow(() => new Regex('a{2000}', '', true))
  assert.throws(() => new Regex('a{2001}'), NOT_ALLOWED)
  assert.throws(() => new Regex('(ab){1000}c'), NOT_ALLOWED)
  assert.equal(new Regex('a{3}').test('xaaax'), true)
  assert.equal(new Regex('a{3}').test('xaax'), false)
  assert.equal(new Regex('a{2,3}b').test('xaab'), true)
  assert.equal(new Regex('^a{2,3}b$').test('aaaab'), false)
  assert.equal(new Regex('^a{2,3}b$').test('ab'), false)
  assert.equal(new Regex('^a{0}b$').test('b'), true)
  assert.equal(new Regex('^(?:ab){2}$').test('abab'), true)
  assert.equal(new Regex('^(?:ab){2}$').test('ababab'), false)
  assert.equal(new Regex('^a{3,}$').test('aaaa'), true)
  assert.equal(new Regex('^a{3,}$').test('aa'), false)
  const ten = 'a'.repeat(10000)
  assert.equal(new Regex('^a+$').test(ten), true)
  assert.equal(new Regex('^a+$').test(ten + 'a'), false)
  assert.equal(literal('^a+$', ten), true)
  assert.equal(literal('a', ten + 'a'), false)
  assert.equal(via.search('a', ten + 'a'), false)
  assert.equal(via.match('a+', ten + 'a'), false)
  assert.equal(via.match('a+', ten), true)
  assert.throws(() => via.search('(a', ten + 'a'), NOT_ALLOWED)
})

test('REQ-033: a literal =~ pattern is checked when the path is parsed, match() and search() when they run', () => {
  assert.throws(() => queryJson({}, '$.a[?(@.v =~ /(?=a)/)]'), NOT_SUPPORTED)
  assert.throws(() => queryJson({ a: [] }, '$.a[?(@.v =~ /\\1/)]'), NOT_SUPPORTED)
  assert.throws(() => queryJson({ a: [] }, `$.a[?(@.v =~ /${'a'.repeat(201)}/)]`), NOT_ALLOWED)
  assert.throws(() => queryJson({ a: [] }, '$.a[?(@.v =~ /a{1000}{1000}/)]'), NOT_ALLOWED)
  assert.throws(() => parsePath('$.a[?(@.v =~ /*a/)]'), NOT_ALLOWED)
  // No element, so match() is never called and the pattern is never read.
  assert.deepEqual(queryJson({ a: [] }, "$.a[?(match(@.v, '(?=a)'))]"), [])
  assert.throws(() => queryJson({ a: [{ v: 'a' }] }, "$.a[?(match(@.v, '(?=a)'))]"), NOT_SUPPORTED)
  assert.throws(() => queryJson({ a: [{ v: 'a', p: '(a' }] }, '$.a[?(match(@.v, @.p))]'), NOT_ALLOWED)
  assert.throws(() => queryJson({ a: [{ v: 'a' }] }, "$.a[?(search(@.v, '(?!a)'))]"), NOT_SUPPORTED)
  // The pattern is not wrapped in a string: a pattern that closes a group early does not escape match().
  assert.throws(() => via.match('a+)+(?:b', 'ab'), NOT_ALLOWED)
  assert.throws(() => via.match('a)|(b', 'a'), NOT_ALLOWED)
  // A RegExp literal given to match() contributes its source; the flags are ignored, as before.
  assert.equal(queryJson({ a: [{ v: 'ABC' }] }, '$.a[?(match(@.v, /abc/i))]').length, queryUpstream({ a: [{ v: 'ABC' }] }, '$.a[?(match(@.v, /abc/i))]').length)
})

test('REQ-032, REQ-033: small inputs give the same result as upstream (seeded property test)', () => {
  const random = seededRandom(20261104)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const word = () => pick(['a', 'b', 'id', 'name', 'x', 'price', 'tags', 'foo bar', 'v', 'item'])
  const value = (depth) => {
    const r = random()
    if (depth > 3 || r < 0.4) return pick([0, 1, 2, 7.5, -3, 'a', 'abc', 'foo', '123', true, false, null, 'A1'])
    if (r < 0.7) return Array.from({ length: Math.floor(random() * 5) }, () => value(depth + 1))
    return Object.fromEntries(Array.from({ length: Math.floor(random() * 5) }, () => [word(), value(depth + 1)]))
  }
  const filters = ['@.id', '@.price > 1', '@.v == 1', '!@.a', "@.name == 'a' || @.id", '@.a == @.a', '@.id >= 0 && @.x', "@.v =~ /^a/", "@.name =~ /^[a-z]+$/", "match(@.v, 'a|b')", "search(@.name, '(ab)+')", 'length(@.tags) > 1', '@']
  const steps = () => pick([`.${word().replace(' ', '')}`, `['${word()}']`, '[*]', '.*', '..a', '..id', '..*', '..[0]', '[0]', '[-1]', '[1:3]', '[::2]', '[::-1]', '[0,2]', "['a','b']", '[:-1]', `[?(${pick(filters)})]`, `..[?(${pick(filters)})]`])
  const run = (fn, doc, path) => {
    try {
      return { ok: fn(doc, path) }
    } catch (error) {
      return { error: error.message }
    }
  }
  let compared = 0
  for (let i = 0; i < 600; i++) {
    const doc = value(0)
    const path = '$' + Array.from({ length: 1 + Math.floor(random() * 3) }, steps).join('')
    assert.deepEqual(run(queryJson, doc, path), run(queryUpstream, doc, path), `${path} on ${JSON.stringify(doc)}`)
    compared++
  }
  assert.equal(compared, 600)
})

const bigVersion = '1.'.repeat(500000)
const noLoneSurrogate = (text) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text)
const messageOf = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.message
  }
  assert.fail('did not throw')
}

test('REQ-034: a long input is cut to 120 UTF-16 units plus an ellipsis in every semver message', () => {
  const cases = [
    [() => parseVersion(bigVersion), bigVersion],
    [() => compareVersions('1.0.0', bigVersion), bigVersion],
    [() => compareVersions(bigVersion, '1.0.0'), bigVersion],
    [() => satisfies('1.0.0', 'x'.repeat(1000000)), 'x'.repeat(1000000)],
    [() => satisfies(bigVersion, '^1.0.0'), bigVersion],
    [() => parseRange('^1.0.0 || ' + '9'.repeat(10) + 'x'.repeat(500000)), '9'.repeat(10) + 'x'.repeat(500000)],
    [() => describeRange('>=' + 'y'.repeat(500000)), 'y'.repeat(500000)],
    [() => increment(bigVersion, 'patch'), bigVersion],
    [() => parseVersion('   ' + bigVersion + '  '), bigVersion]
  ]
  for (const [fn, input] of cases) {
    const message = messageOf(fn)
    assert.ok(message.length <= 200, `message of ${message.length} characters`)
    assert.ok(message.includes(input.trim().slice(0, 120) + '…'), message.slice(0, 80))
    assert.ok(!message.includes(input.trim().slice(0, 121)), 'more than 120 units copied')
  }
  assert.equal(messageOf(() => parseVersion(bigVersion)), `"${bigVersion.slice(0, 120)}…" is not a semantic version (MAJOR.MINOR.PATCH).`)
  assert.equal(messageOf(() => satisfies('1.0.0', 'x'.repeat(1000000))), `"${'x'.repeat(120)}…" is not a version or range.`)
})

test('REQ-034: the cut never splits a surrogate pair', () => {
  for (const at of [118, 119, 120, 121]) {
    const input = 'a'.repeat(at) + '😀' + 'b'.repeat(300)
    for (const message of [messageOf(() => parseVersion(input)), messageOf(() => satisfies('1.0.0', input))]) {
      assert.ok(noLoneSurrogate(message), `emoji at ${at}`)
      assert.ok(message.length <= 200)
      assert.ok(message.includes('…'))
    }
  }
  // At position 119 the pair would straddle the limit: it is dropped whole, so at most 120 units are copied.
  assert.ok(messageOf(() => parseVersion('a'.repeat(119) + '😀' + 'b'.repeat(300))).includes('"' + 'a'.repeat(119) + '…"'))
  assert.ok(messageOf(() => parseVersion('a'.repeat(118) + '😀' + 'b'.repeat(300))).includes('"' + 'a'.repeat(118) + '😀…"'))
})

test('REQ-034: short input keeps the message as before', () => {
  assert.equal(messageOf(() => parseVersion('  abc ')), '"abc" is not a semantic version (MAJOR.MINOR.PATCH).')
  assert.equal(messageOf(() => parseVersion('1.2')), '"1.2" is not a semantic version (MAJOR.MINOR.PATCH).')
  assert.equal(messageOf(() => compareVersions('1.0.0', 'nope')), '"nope" is not a semantic version (MAJOR.MINOR.PATCH).')
  assert.equal(messageOf(() => satisfies('1.0.0', '^abc')), '"abc" is not a version or range.')
  assert.equal(messageOf(() => describeRange('foo bar')), '"foo" is not a version or range.')
  assert.equal(messageOf(() => increment('x.y', 'patch')), '"x.y" is not a semantic version (MAJOR.MINOR.PATCH).')
  assert.equal(messageOf(() => increment('1.0.0', 'bogus')), 'Unknown increment bogus')
  const exact = 'b'.repeat(120)
  assert.equal(messageOf(() => parseVersion(exact)), `"${exact}" is not a semantic version (MAJOR.MINOR.PATCH).`)
  assert.equal(messageOf(() => parseVersion(exact + 'c')), `"${exact}…" is not a semantic version (MAJOR.MINOR.PATCH).`)
})

test('REQ-034: an unknown increment kind is cut too', () => {
  const message = messageOf(() => increment('1.0.0', 'k'.repeat(1000000)))
  assert.ok(message.length <= 200)
})

test('REQ-035: the SQL table name must be an identifier', () => {
  const rows = [{ id: 1, name: "O'Brien" }]
  for (const table of ['users; DROP TABLE x; --', 'a b', '1abc', 'a.b.c', 'a.', '.a', "x'", 'x"y', 'a-b', ' users', 'users\n', 'é', 0, false, {}, ['users']]) {
    assert.throws(() => formatRows(rows, 'sql', { table }), Error, JSON.stringify(table))
  }
  const users = "INSERT INTO users (id, name) VALUES\n  (1, 'O''Brien');"
  assert.equal(formatRows(rows, 'sql'), users)
  assert.equal(formatRows(rows, 'sql', {}), users)
  for (const table of ['', null, undefined, 'users']) assert.equal(formatRows(rows, 'sql', { table }), users)
  assert.equal(formatRows(rows, 'sql', { table: 'public.users' }), users.replace('INTO users', 'INTO public.users'))
  assert.equal(formatRows(rows, 'sql', { table: '_t1' }), users.replace('INTO users', 'INTO _t1'))
  // Other formats do not read the table.
  assert.equal(formatRows(rows, 'csv', { table: 'a b' }), 'id,name\n1,O\'Brien')
})

test('REQ-034: parseVersion is linear on a string that is all white space (1,000,000 characters)', () => {
  const results = inChild(`
    import { parseVersion } from ${url('../../src/tools/semver.js')}
    const out = []
    for (const text of [' '.repeat(1000000) + 'x', 'v' + ' '.repeat(1000000), '=' + ' '.repeat(500000) + 'v' + ' '.repeat(500000), ' '.repeat(500000) + '1.2.3' + ' '.repeat(500000) + 'x']) {
      const start = performance.now()
      let message = 'did not throw'
      try { parseVersion(text) } catch (e) { message = e.message }
      out.push({ ms: performance.now() - start, message })
    }
    console.log(JSON.stringify(out))`)
  for (const { ms, message } of results) {
    assert.ok(ms < 200, `took ${ms} ms`)
    assert.ok(message.endsWith('is not a semantic version (MAJOR.MINOR.PATCH).') && message.length <= 200, message.slice(0, 100))
  }
})

test('REQ-034: parseVersion accepts and rejects exactly what it did before (seeded, 8,000 strings)', () => {
  const random = seededRandom(34034)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const space = () => pick(['', '', ' ', '  ', '\t', '\n', '\u00a0', '\ufeff', ' \u2028'])
  const piece = () => pick(['0', '1', '2', '10', '01', '1.', '.', '-', '+', 'a', 'rc', 'x', 'v', '=', ' ', '1.2.3', '0.0.0', '-rc.1', '-0', '-01', '+b.1', '-a-b', '..', 'V'])
  const sample = () => {
    if (random() < 0.5) return Array.from({ length: Math.floor(random() * 8) }, piece).join('')
    const pre = pick(['', '', '-rc.1', '-alpha', '-1', '-0.3.7', '-x.7.z.92', '-01', '-', '-a_b'])
    const build = pick(['', '', '+b.1', '+001', '+a-b', '+', '+a..b'])
    return space() + pick(['', '', 'v', '=', 'v ', '= ', 'V']) + space() + [pick(['0', '1', '12', '01']), pick(['0', '3', '45']), pick(['0', '9', '100'])].join('.') + pre + build + space()
  }
  let accepted = 0
  for (let n = 0; n < 8000; n++) {
    const text = sample()
    const run = (fn) => {
      try {
        return { ok: fn(text) }
      } catch (error) {
        return { error: error.message }
      }
    }
    const old = run(parseVersionUpstream)
    assert.deepEqual(run(parseVersion), old, JSON.stringify(text))
    if (old.ok) accepted++
  }
  const outcome = (fn, text) => {
    try {
      return { ok: fn(text) }
    } catch (error) {
      return { error: error.message }
    }
  }
  for (const text of [' v 1.2.3', '=v1', 'v=1.2.3', '  =  1.2.3  ', 'v\t1.2.3\n', '\ufeff1.2.3']) assert.deepEqual(outcome(parseVersion, text), outcome(parseVersionUpstream, text), JSON.stringify(text))
  assert.ok(accepted > 500, `only ${accepted} accepted samples`)
})

test('REQ-034: shown() trims, cuts at 120 units and keeps surrogate pairs whole', () => {
  assert.equal(shown('  abc  '), 'abc')
  assert.equal(shown('b'.repeat(120)), 'b'.repeat(120))
  assert.equal(shown('b'.repeat(121)), 'b'.repeat(120) + '…')
  assert.equal(shown('a'.repeat(119) + '😀'), 'a'.repeat(119) + '…')
  assert.equal(shown('a'.repeat(118) + '😀' + 'c'), 'a'.repeat(118) + '😀…')
  assert.equal(shown('a'.repeat(117) + '😀' + 'c'), 'a'.repeat(117) + '😀' + 'c')
})

test('REQ-034: the sort mode names each wrong line in at most 200 characters; a long error wraps (300 px)', async () => {
  const { page, frame, errors } = await openPanel(browser, { width: 300 })
  await frame.locator('#search').fill('semver')
  await frame.locator('#search').press('Enter')
  const view = frame.locator('[data-view="semver"]')
  const fits = () => frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  // Check mode: the shortened echo is still an unbroken run of 120 characters.
  await view.getByLabel('Version', { exact: true }).fill('x'.repeat(300))
  assert.equal(await view.locator('.error').count(), 1)
  assert.equal(await fits(), true)
  assert.equal(await view.locator('.error').evaluate((node) => node.scrollWidth <= node.clientWidth), true)
  // A 300-character error without a break point, as the error element shows any tool's message.
  await view.locator('.error').evaluate((node) => (node.textContent = 'x'.repeat(300)))
  assert.equal(await fits(), true)
  assert.equal(await view.locator('.error').evaluate((node) => node.scrollWidth <= node.clientWidth), true)
  // Sort mode: a line of 1,000,000 characters.
  await view.locator('button', { hasText: /^Sort$/ }).click()
  await view.locator('textarea').fill(['1.0.0', 'z'.repeat(1000000), '2.0.0', ' ' + 'y'.repeat(300) + ' '].join('\n'))
  const message = await view.locator('.error').textContent()
  assert.ok(message.startsWith('Not versions: '), message.slice(0, 40))
  assert.ok(message.length <= 14 + 2 * 122 + 2, `message of ${message.length} characters`)
  assert.ok(message.includes('z'.repeat(120) + '…') && message.includes('y'.repeat(120) + '…'))
  assert.equal(await fits(), true)
  assert.equal(await view.locator('.error').evaluate((node) => node.scrollWidth <= node.clientWidth), true)
  assert.deepEqual(errors, [])
  await page.close()
})
