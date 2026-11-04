import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { composeToRun, runToCompose } from '../../src/tools/docker.js'
import { parseDotenv, readEnv, writeEnv } from '../../src/tools/env.js'

const shells = ['bash', 'zsh'].filter((shell) => spawnSync(shell, ['-c', 'true']).status === 0)
/** The executed tests need bash and say in the output when zsh is missing. */
const needShells = (t) => {
  assert.ok(shells.includes('bash'), 'bash is required to run the generated shell text, and it was not found')
  if (!shells.includes('zsh')) t.diagnostic('zsh was not found: the zsh part of this test was skipped')
}
const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'odt-env-docker-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
/** Runs shell text in a shell inside dir; returns the NUL-separated words the script printed. */
const run = (shell, dir, script) => {
  const done = spawnSync(shell, ['-c', script], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } })
  return { ...done, words: done.stdout.split('\0').slice(0, -1) }
}
const PRINT_ARGS = 'docker() { for a in "$@"; do printf "%s\\0" "$a"; done; }\n'
const PRINT_VARS = 'printenv() { for n in "$@"; do eval "printf \'%s\\\\0\' \\"\\$$n\\""; done; }\n'

const BAD_SHELL_NAMES = ['a;touch /tmp/x', 'b$(id)', 'c\nINJECTED', 'd`id`', '1abc', 'a-b', 'a.b', '']

test('REQ-028: the shell target rejects a name that is not a POSIX variable name', () => {
  for (const name of BAD_SHELL_NAMES) {
    assert.throws(() => writeEnv([[name, '1']], 'shell'), (error) => error.message.includes(name), JSON.stringify(name))
  }
  assert.throws(() => writeEnv([['OK', '1'], ['a;touch /tmp/x', '1']], 'shell'), /a;touch \/tmp\/x/)
})

test('REQ-028: a valid name keeps today\'s output', () => {
  assert.equal(writeEnv([['FOO', 'x y']], 'shell'), "export FOO='x y'")
  assert.equal(writeEnv([['FOO', 'x y'], ['BAR_1', "it's"]], 'shell'), "export FOO='x y'\nexport BAR_1='it'\\''s'")
  assert.equal(writeEnv([['_a1', 'v']], 'shell'), 'export _a1=v')
  // A value that starts with = or holds := is single-quoted (zsh expands =ls and a:=ls); other values stay as they were.
  assert.equal(writeEnv([['A', '=ls'], ['B', 'a:=ls'], ['C', 'a=b'], ['D', 'a:b'], ['E', '=']], 'shell'), "export A='=ls'\nexport B='a:=ls'\nexport C=a=b\nexport D=a:b\nexport E='='")
  // The docker target is a command, not an assignment, so it is as it was.
  assert.equal(writeEnv([['A', '=ls']], 'docker'), '-e A==ls')
})

test('REQ-028: the shell output reads values back exactly and runs no command for a hostile name', (t) => {
  needShells(t)
  for (const shell of shells) {
    withDir((dir) => {
      const text = writeEnv([['FOO', 'x y'], ['BAR_1', "it's"], ['BAZ', 'a\nb\t$(id) `id` "q" \\ ;'], ['EQ', '=ls'], ['COLON', 'a:=ls'], ['EQ2', '=ls\nx'], ['PLAIN', 'a=b'], ['TILDE', '~/x:=y']], 'shell')
      const done = run(shell, dir, `${text}\n${PRINT_VARS}printenv FOO BAR_1 BAZ EQ COLON EQ2 PLAIN TILDE`)
      assert.equal(done.status, 0, `${shell}: ${done.stderr}`)
      assert.deepEqual(done.words, ['x y', "it's", 'a\nb\t$(id) `id` "q" \\ ;', '=ls', 'a:=ls', '=ls\nx', 'a=b', '~/x:=y'], shell)
      for (const name of [`a;touch ${dir}/canary1`, `b$(touch ${dir}/canary2)`, `c\ntouch ${dir}/canary3`, `d\`touch ${dir}/canary4\``, '1abc', 'a-b', 'a.b', '']) {
        let text2 = null
        try {
          text2 = writeEnv([[name, '1']], 'shell')
        } catch {
          // rejected: nothing to run
        }
        if (text2 !== null) run(shell, dir, text2)
        assert.deepEqual(readdirSync(dir), [], `${shell}: ${JSON.stringify(name)} created a file`)
      }
    })
  }
})

test('REQ-029: dotenv, docker and compose reject a name that breaks the line or the flag', () => {
  for (const target of ['dotenv', 'docker', 'compose']) {
    for (const name of ['c\nINJECTED', 'a=b', 'a b', 'a#b', 'a\u0000b', '']) {
      assert.throws(() => writeEnv([[name, '1']], target), (error) => error.message.includes(name), `${target} ${JSON.stringify(name)}`)
    }
  }
})

test('REQ-029: valid names keep today\'s output on the three targets', () => {
  const pairs = [['spring.datasource.url', 'a b'], ['my-key', '1'], ['A_1', 'x=y']]
  assert.equal(writeEnv(pairs, 'dotenv'), 'spring.datasource.url="a b"\nmy-key=1\nA_1=x=y')
  assert.equal(writeEnv(pairs, 'docker'), "-e 'spring.datasource.url=a b' \\\n-e my-key=1 \\\n-e A_1=x=y")
  assert.equal(writeEnv(pairs, 'compose'), "environment:\n  spring.datasource.url: a b\n  my-key: '1'\n  A_1: x=y\n")
})

test('REQ-029: json, secret and configmap are unchanged', () => {
  const pairs = [['c\nINJECTED', '1'], ['a=b', '2'], ['', '3']]
  assert.equal(writeEnv(pairs, 'json'), '{\n  "c\\nINJECTED": "1",\n  "a=b": "2",\n  "": "3"\n}')
  assert.equal(writeEnv(pairs, 'secret'), "apiVersion: v1\nkind: Secret\nmetadata:\n  name: app-env\ntype: Opaque\ndata:\n  c_INJECTED: MQ==\n  a_b: Mg==\n  '': Mw==\n")
  assert.equal(writeEnv(pairs, 'configmap'), "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app-env\ndata:\n  c_INJECTED: '1'\n  a_b: '2'\n  '': '3'\n")
})

/** A 6-level alias bomb: each level holds 10 aliases of the one before (a few hundred bytes, 10 million leaves). */
const bomb = () => {
  const lines = [`a0: &a0 [${Array.from({ length: 10 }, (_, i) => `s${i}`).join(', ')}]`]
  for (let level = 1; level <= 6; level++) lines.push(`a${level}: &a${level} [${Array(10).fill(`*a${level - 1}`).join(', ')}]`)
  return lines
}
const COMPOSE_BOMB = `x-bomb:\n${bomb().map((line) => `  ${line}`).join('\n')}\nservices:\n  web:\n    image: nginx\n    command: *a6\n`
const CONFIGMAP_BOMB = `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n  annotations:\n${bomb().map((line) => `    ${line}`).join('\n')}\ndata:\n  big: *a6\n`
const timed = (fn) => {
  const start = performance.now()
  let error = null
  try {
    fn()
  } catch (e) {
    error = e
  }
  return { error, ms: performance.now() - start }
}

test('REQ-030: an alias bomb in a Compose command or a ConfigMap is rejected fast', () => {
  assert.ok(COMPOSE_BOMB.length < 700 && CONFIGMAP_BOMB.length < 800)
  for (const [name, fn] of [['composeToRun', () => composeToRun(COMPOSE_BOMB)], ['readEnv', () => readEnv(CONFIGMAP_BOMB)]]) {
    const { error, ms } = timed(fn)
    assert.ok(error, `${name} returned`)
    assert.match(error.message, /aliases/, name)
    assert.ok(ms < 2000, `${name} took ${ms} ms`)
  }
})

test('REQ-030: ordinary Compose and ConfigMap, also with small anchors and aliases, give today\'s output', () => {
  const compose = 'x-common: &c [echo, hi]\nservices:\n  web:\n    image: nginx\n    command: *c\n  db:\n    image: postgres\n    environment: &e\n      A: 1\n  db2:\n    image: postgres\n    environment: *e\n'
  assert.deepEqual(composeToRun(compose), {
    commands: 'docker run -d --name web nginx echo hi\n\ndocker run -d --name db -e A=1 postgres\n\ndocker run -d --name db2 -e A=1 postgres',
    services: 3,
    notes: []
  })
  const configmap = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cfg\ndata:\n  A: &v "one"\n  B: *v\n  C: 3\n'
  assert.deepEqual(readEnv(configmap), { pairs: [['A', 'one'], ['B', 'one'], ['C', '3']], from: 'ConfigMap', name: 'cfg' })
})

test('REQ-030: more than one YAML document is an error that says so', () => {
  assert.throws(() => composeToRun('services:\n  a:\n    image: x\n---\nservices:\n  b:\n    image: y\n'), /one document/)
  assert.throws(() => readEnv('apiVersion: v1\nkind: Secret\ndata:\n  A: eA==\n---\napiVersion: v1\nkind: Secret\ndata:\n  B: eQ==\n'), /one document/)
})

test('REQ-030: a YAML syntax error says Not valid YAML once', () => {
  for (const fn of [() => composeToRun('services: ['), () => readEnv('kind: ConfigMap\ndata: [')]) {
    assert.throws(fn, (error) => error.message.startsWith('Not valid YAML') && error.message.match(/Not valid YAML/g).length === 1 && !/Not valid YAML: Not valid YAML/.test(error.message))
  }
})

test('REQ-030: a Compose without services and a ConfigMap without data keep today\'s result', () => {
  assert.throws(() => composeToRun('version: "3"\n'), (error) => error.message === 'No services: section found.')
  assert.deepEqual(readEnv('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cfg\n'), { pairs: [], from: 'ConfigMap', name: 'cfg' })
  assert.throws(() => readEnv('apiVersion: v1\nkind: Pod\n'), (error) => error.message === 'A Pod holds no variables; paste a Secret or ConfigMap.')
})

const compose = (service, name = 'a') => `services:\n  ${name}:\n${Object.entries(service).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`).join('\n')}\n`

test('REQ-031: an image or a container name that starts with - is rejected', () => {
  assert.throws(() => composeToRun(compose({ image: '--privileged' })), /--privileged/)
  assert.throws(() => composeToRun(compose({ image: 'nginx', container_name: '--rm' })), /--rm/)
  assert.throws(() => composeToRun(compose({ image: 'nginx' }, '-x')), /-x/)
  assert.throws(() => composeToRun(compose({ image: '-x' })), /-x/)
})

test('REQ-031: a numeric image becomes text and valid values keep today\'s output', () => {
  assert.equal(composeToRun(compose({ image: 5 })).commands, 'docker run -d --name a 5')
  assert.equal(composeToRun(compose({ image: 'nginx', container_name: 'x' })).commands, 'docker run -d --name x nginx')
  assert.equal(composeToRun(compose({ image: 'nginx' })).commands, 'docker run -d --name a nginx')
  // A service with build: and no image still gets the placeholder, and a - inside the name is fine.
  assert.equal(composeToRun('services:\n  my-app:\n    build: .\n').commands, "docker run -d --name my-app '<my-app-image>'")
})

test('REQ-031: a word that starts with = is quoted, and one that only contains = is not', () => {
  const text = 'services:\n  a:\n    image: nginx\n    command: ["=ls", "a=b"]\n    env_file: ["=x"]\n    volumes: ["=x"]\n    labels:\n      k: "=zsh"\n'
  const { commands } = composeToRun(text)
  assert.equal(commands, "docker run -d --name a --env-file '=x' -v '=x' -l k==zsh nginx '=ls' a=b")
})

test('REQ-031: the generated command runs with the right arguments and no side effect', (t) => {
  needShells(t)
  const text = 'services:\n  a:\n    image: nginx\n    command: ["=ls", "a=b", "$(touch CANARY)", "x y"]\n    env_file: ["=x"]\n    volumes: ["=x"]\n    labels:\n      k: "=zsh"\n    environment:\n      V: "`touch CANARY`; x"\n'
  for (const shell of shells) {
    withDir((dir) => {
      const { commands } = composeToRun(text.replaceAll('CANARY', `${dir}/canary`))
      const done = run(shell, dir, `${PRINT_ARGS}${commands}`)
      assert.equal(done.status, 0, `${shell}: ${done.stderr}`)
      assert.deepEqual(done.words, ['run', '-d', '--name', 'a', '--env-file', '=x', '-e', `V=\`touch ${dir}/canary\`; x`, '-v', '=x', '-l', 'k==zsh', 'nginx', '=ls', 'a=b', `$(touch ${dir}/canary)`, 'x y'], shell)
      assert.deepEqual(readdirSync(dir), [], `${shell}: a file was created`)
    })
  }
})

// --- Round trip of a value through the .env writer and reader (REQ-029) ---------------------------------

/** Small seeded generator (mulberry32), so a failure can be reproduced. */
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296
}
const pick = (random, list) => list[Math.floor(random() * list.length)]

test('REQ-029: a value goes through .env and back unchanged', () => {
  for (const value of ['x\ry', 'a\r\nb', 'tab\there', '\r', '\\r', 'a\\\r']) {
    assert.deepEqual(parseDotenv(writeEnv([['K', value]], 'dotenv')), [['K', value]], JSON.stringify(value))
  }
  const random = seeded(2901)
  const alphabet = ['a', 'Z', '0', ' ', '\t', '\r', '\n', '"', "'", '`', '#', '$', '\\', '=', 'é', '😀', '\u2028', '\u00a0', 'n', 'r', '\\n', '\r\n', ' #x']
  for (let i = 0; i < 400; i++) {
    const pairs = Array.from({ length: 1 + Math.floor(random() * 3) }, (_, k) => [`K${k}`, Array.from({ length: Math.floor(random() * 12) }, () => pick(random, alphabet)).join('')])
    assert.deepEqual(parseDotenv(writeEnv(pairs, 'dotenv')), pairs, JSON.stringify(pairs))
  }
})

// --- Linear time (REQ-036) -----------------------------------------------------------------------------

/** parseDotenv as it was before the fix: right, but slow on long input. Kept here as the reference. */
function referenceParseDotenv(text) {
  const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/
  const closingIndex = (body, q) => {
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '\\' && q === '"') i++
      else if (body[i] === q) return i
    }
    return -1
  }
  const closes = (body, q) => closingIndex(body, q) !== -1
  const pairs = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (let n = 0; n < lines.length; n++) {
    let line = lines[n].trim()
    if (!line || line.startsWith('#')) continue
    line = line.replace(/^export\s+/, '')
    const eq = line.indexOf('=')
    if (eq <= 0) throw new Error(`Line ${n + 1}: expected NAME=value.`)
    const name = line.slice(0, eq).trim()
    if (!NAME.test(name)) throw new Error(`Line ${n + 1}: "${name}" is not a valid variable name.`)
    let rest = line.slice(eq + 1).trim()
    let value
    const q = rest[0]
    if (q === '"' || q === "'" || q === '`') {
      let body = rest.slice(1)
      while (!closes(body, q) && n + 1 < lines.length) body += `\n${lines[++n]}`
      const end = closingIndex(body, q)
      if (end === -1) throw new Error(`The value of ${name} never closes its ${q} quote.`)
      value = body.slice(0, end)
      if (q === '"') value = value.replace(/\\([nrt"\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c)
    } else {
      value = rest.replace(/\s+#.*$/, '')
    }
    pairs.push([name, value])
  }
  return pairs
}

const outcome = (fn, text) => {
  try {
    return { pairs: fn(text) }
  } catch (error) {
    return { error: error.message }
  }
}

test('REQ-036: parseDotenv gives what it gave before on 3,000 seeded random documents', () => {
  const random = seeded(36)
  const names = ['A', 'B_1', 'my-key', 'a.b', '_x', '1bad', 'a b', '', 'export', 'export A']
  const bits = ['x', 'hello world', 'a=b', '  ', '\t', '#', ' #c', '\t# c', '#c', '"', "'", '`', '\\', '\\n', '\\r', '\\t', '\\"', '\\\\', '\\q', '$X', 'é', '😀', '\u2028', '\u00a0', '\u3000', '\ufeff', '=', 'export ']
  const ends = ['\n', '\n', '\n', '\r\n', '\r', '\n\n', '\n# comment\n']
  const word = () => Array.from({ length: Math.floor(random() * 6) }, () => pick(random, bits)).join('')
  const quoted = () => {
    const q = pick(random, ['"', "'", '`'])
    return `${q}${word()}${random() < 0.4 ? pick(random, ['\n', '\r\n']) : ''}${word()}${random() < 0.9 ? q : ''}${random() < 0.5 ? pick(random, ['', ' # note', ' x', '#y']) : ''}`
  }
  let parsed = 0
  let failed = 0
  for (let i = 0; i < 3000; i++) {
    let text = ''
    const lines = 1 + Math.floor(random() * 5)
    for (let k = 0; k < lines; k++) {
      const kind = random()
      if (kind < 0.1) text += pick(random, ['', '  ', '# c', '  # c', 'no equals', '=novalue'])
      else if (kind < 0.25) text += word()
      else text += `${random() < 0.2 ? pick(random, [' ', '\t', '']) : ''}${pick(random, names)}${pick(random, ['=', ' = ', '= ', ' ='])}${random() < 0.5 ? quoted() : word()}`
      text += pick(random, ends)
    }
    const old = outcome(referenceParseDotenv, text)
    assert.deepEqual(outcome(parseDotenv, text), old, JSON.stringify(text))
    if (old.error) failed++
    else parsed++
  }
  // The comparison must cover both kinds of result.
  assert.ok(parsed > 500 && failed > 100, `parsed ${parsed}, failed ${failed}`)
})

test('REQ-036: parseDotenv strips a comment the way it did, also with line separators after the #', () => {
  for (const text of ['A=x  # c', 'A=x\t#c', 'A=x #c\u2028d', 'A=x #c #d', 'A=x #a\u2028b #c', 'A=x#c', 'A= #c', 'A=x \u00a0# c', 'A=a\u2028 #b', 'A=# not a comment', 'A=x \u2028# y']) {
    assert.deepEqual(outcome(parseDotenv, text), outcome(referenceParseDotenv, text), JSON.stringify(text))
  }
  assert.deepEqual(parseDotenv('A=x  # c'), [['A', 'x']])
})

const timeOf = (fn) => {
  const start = performance.now()
  const result = fn()
  return { result, ms: performance.now() - start }
}

test('REQ-036: parseDotenv with 80,000 spaces before a word takes under 1,000 ms', () => {
  const { result, ms } = timeOf(() => parseDotenv(`A=x${' '.repeat(80000)}y`))
  assert.deepEqual(result, [['A', `x${' '.repeat(80000)}y`]])
  assert.ok(ms < 1000, `took ${ms} ms`)
})

test('REQ-036: parseDotenv with a quote that never closes and 100,000 lines takes under 1,000 ms', () => {
  const { result, ms } = timeOf(() => outcome(parseDotenv, `A="\n${'b\n'.repeat(100000)}`))
  assert.match(result.error, /never closes/)
  assert.ok(ms < 1000, `took ${ms} ms`)
  // Closing far down still works, also after a backslash at the end of a line.
  assert.deepEqual(parseDotenv(`A="x\\\n${'b\n'.repeat(50000)}"`), [['A', `x\\\n${'b\n'.repeat(50000)}`]])
})

test('REQ-036: runToCompose with 20,000 commands that share an image takes under 1,000 ms and names them x, x-2, x-3', () => {
  const { result, ms } = timeOf(() => runToCompose('docker run x\n'.repeat(20000)))
  assert.ok(ms < 1000, `took ${ms} ms`)
  assert.equal(result.services, 20000)
  const names = [...result.yaml.matchAll(/^ {2}(\S+):$/gm)].map((match) => match[1])
  assert.equal(names.length, 20000)
  assert.deepEqual(names.slice(0, 4), ['x', 'x-2', 'x-3', 'x-4'])
  assert.equal(names[19999], 'x-20000')
})

test('REQ-036: a service name that already ends in -2 is never taken twice', () => {
  const names = (text) => [...runToCompose(text).yaml.matchAll(/^ {2}(\S+):$/gm)].map((match) => match[1])
  assert.deepEqual(names('docker run --name x-2 y\ndocker run x\ndocker run x\ndocker run x'), ['x-2', 'x', 'x-3', 'x-4'])
  assert.deepEqual(names('docker run x\ndocker run x\ndocker run --name x-3 y\ndocker run x\ndocker run x'), ['x', 'x-2', 'x-3', 'x-4', 'x-5'])
  assert.deepEqual(names('docker run --name x-2 y\ndocker run --name x-2 y\ndocker run --name x y\ndocker run x'), ['x-2', 'x-2-2', 'x', 'x-3'])
})

// --- Empty service and special names (REQ-037) ---------------------------------------------------------

test('REQ-037: an empty service becomes a bare docker run with a note, and the others still convert', () => {
  const empty = composeToRun('services:\n  a:\n')
  assert.equal(empty.commands, "docker run -d --name a '<a-image>'")
  assert.equal(empty.services, 1)
  assert.match(empty.notes[0], /^a: uses build:/)
  const mixed = composeToRun('services:\n  a:\n  b:\n    image: nginx\n')
  assert.equal(mixed.commands, "docker run -d --name a '<a-image>'\n\ndocker run -d --name b nginx")
})

test('REQ-037: a service or a variable called __proto__ is kept', () => {
  const service = runToCompose('docker run --name __proto__ nginx')
  assert.match(service.yaml, /__proto__:\n {4}image: nginx/)
  const env = runToCompose('docker run -e __proto__=x -e A=1 nginx')
  assert.match(env.yaml, /__proto__: x/)
  assert.match(env.yaml, /A: '1'/)
})
