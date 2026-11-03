import assert from 'node:assert/strict'
import { test } from 'node:test'

import { convertCurl } from '../../src/tools/curl.js'
import { jsonToTypes } from '../../src/tools/types.js'

const httpie = (command) => convertCurl(command, 'httpie').code

test('REQ-007: HTTPie rejects a method that is not letters only', () => {
  assert.throws(() => convertCurl("curl -X '$(id)' https://api.example.com/items", 'httpie'), /letters/)
  assert.throws(() => convertCurl('curl -X evil.com https://api.internal/items -u u:p', 'httpie'), /letters/)
  assert.throws(() => convertCurl("curl -X '' https://x.dev", 'httpie'), /letters/)
  // HTTPie reads GET2 as the URL, and M-SEARCH too.
  assert.throws(() => convertCurl('curl -X GET2 https://x.dev', 'httpie'), /letters/)
  assert.throws(() => convertCurl('curl -X M-SEARCH https://x.dev', 'httpie'), /letters/)
  assert.equal(httpie('curl -X POST https://x.dev'), 'http POST https://x.dev')
  assert.equal(httpie('curl -X patch https://x.dev'), 'http PATCH https://x.dev')
  assert.equal(httpie('curl -I https://x.dev'), 'http HEAD https://x.dev')
  // fetch and python quote the method, so they keep working.
  assert.match(convertCurl("curl -X '$(id)' https://x.dev", 'fetch').code, /method: "\$\(ID\)"/)
  assert.match(convertCurl("curl -X '$(id)' https://x.dev", 'python').code, /requests\.request\('\$\(ID\)', 'https:\/\/x\.dev'\)/)
})

test('REQ-008: HTTPie items keep a leading @ or = as text', () => {
  assert.equal(httpie("curl https://x.example/c -H 'X-Trace: @.env'"), "http GET https://x.example/c 'X-Trace:\\@.env'")
  assert.equal(httpie("curl https://x.example/c -d 'note=@/etc/passwd'"), "http --form POST https://x.example/c 'note=\\@/etc/passwd'")
  assert.equal(httpie(`curl https://x.example/c --json '{"note":"@/path"}'`), "http POST https://x.example/c 'note=\\@/path'")
  assert.equal(httpie("curl https://x.example/c -H 'X-Trace: =@secret.json'"), "http GET https://x.example/c 'X-Trace:\\=@secret.json'")
  assert.equal(httpie("curl https://x.example/c -d 'note==@/etc/passwd'"), "http --form POST https://x.example/c 'note=\\=@/etc/passwd'")
  assert.equal(httpie(`curl https://x.example/c --json '{"note":"=@/etc/passwd"}'`), "http POST https://x.example/c 'note=\\=@/etc/passwd'")
  assert.match(httpie("curl https://x.example/c -F 'n==@x'"), / 'n=\\=@x'$/)
  assert.equal(httpie("curl https://x.example/c -F 'file=@a.png'"), 'http --multipart POST https://x.example/c file@a.png')
})

test('REQ-008: separators in a name are escaped, and a backslash HTTPie cannot spell is an error', () => {
  assert.equal(httpie("curl https://x.example/c -d 'a:=b=c'"), "http --form POST https://x.example/c 'a\\:=b=c'")
  assert.equal(httpie("curl https://x.example/c -H 'X=Y@Z;: v'"), "http GET https://x.example/c 'X\\=Y\\@Z\\;:v'")
  assert.equal(httpie(`curl https://x.example/c --json '{"a:@b":"c"}'`), "http POST https://x.example/c 'a\\:\\@b=c'")
  // HTTPie cannot spell a backslash before : ; = @ in a name, so that is an error, not a wrong item.
  assert.throws(() => httpie("curl https://x.example/c -d 'a\\@/etc/passwd=v'"), /backslash/)
  assert.throws(() => httpie("curl https://x.example/c -H 'x\\: v'"), /backslash/)
  assert.throws(() => httpie("curl https://x.example/c -F 'a\\=b=v'"), /backslash/)
  assert.equal(httpie("curl https://x.example/c -d 'a\\b=c'"), "http --form POST https://x.example/c 'a\\b=c'")
  assert.throws(() => httpie(`curl https://x.example/c --json '{"a\\\\@b":"x"}'`), /backslash/)
  assert.equal(httpie(`curl https://x.example/c --json '{"filter[status]":"x"}'`), "http POST https://x.example/c 'filter[status]=x'")
  // Ordinary values are not touched.
  assert.equal(httpie("curl https://x.example/c -H 'Authorization: Bearer abc==' -d 'q=a=b'"), "http --form POST https://x.example/c 'Authorization:Bearer abc==' q=a=b")
})

test('HTTPie: nothing taken from the curl command is an HTTPie option', () => {
  // Without `--`, an item such as --output=/tmp/x writes the response to a file.
  assert.equal(httpie("curl https://x.example/c -H '--output=/tmp/x: y'"), "http -- GET https://x.example/c '--output\\=/tmp/x:y'")
  assert.equal(httpie("curl https://x.example/c -d '--output=/tmp/x'"), 'http --form -- POST https://x.example/c --output=/tmp/x')
  assert.equal(httpie(`curl https://x.example/c --json '{"--output":"/tmp/x"}'`), 'http -- POST https://x.example/c --output=/tmp/x')
  assert.equal(httpie(`curl https://x.example/c --json '{"-o":1}'`), 'http -- POST https://x.example/c -o:=1')
  assert.equal(httpie("curl https://x.example/c -F '--output=/tmp/x'"), 'http --multipart -- POST https://x.example/c --output=/tmp/x')
  // --raw is an option too, so it stays before the `--`.
  assert.equal(httpie(`curl https://x.example/c -H 'Content-Type: text/plain' -d x -H '-a: b'`), 'http --raw=x -- POST https://x.example/c Content-Type:text/plain -a:b')
  // The URL always has a scheme, so it never starts with `-`. A credential that does is attached.
  assert.equal(httpie('curl --url -x'), 'http GET http://-x')
  assert.equal(httpie("curl https://x.example/c -u '-x:y'"), 'http --auth=-x:y GET https://x.example/c')
  assert.equal(httpie('curl https://x.example/c -u ann:pw'), 'http --auth ann:pw GET https://x.example/c')
})

test('HTTPie: an item that starts with = is quoted for the shell', () => {
  assert.equal(httpie("curl https://x.example/c -d '=ls'"), "http --form POST https://x.example/c '=ls'")
})

const evil = 'id`\n}\nfunc init() { println("x") }\ntype Z struct {\n\tB int `json:"b'

test('REQ-009: a JSON key cannot break out of a Go struct tag', () => {
  const go = jsonToTypes(JSON.stringify({ [evil]: 1, user_id: 2 }), 'go')
  assert.ok(go.split('\n').every((line) => !/^(func|type Z)/.test(line)))
  assert.ok(go.includes(JSON.stringify('json:' + JSON.stringify(evil))))
  assert.ok(go.includes('`json:"user_id"`'))
  const optional = jsonToTypes(JSON.stringify([{ [evil]: 1 }, {}]), 'go')
  assert.ok(optional.includes(JSON.stringify('json:' + JSON.stringify(evil + ',omitempty'))))
  assert.ok(optional.split('\n').every((line) => !/^(func|type Z)/.test(line)))
})

// Each key alone, so that dropping any one part of the check in goTag breaks a row. A key goes into a
// raw `json:"..."` tag only when that is safe; U+2028 is fine in a Go raw string.
const GO_KEYS = [
  ['user_id', 'raw'], ['a b', 'raw'], ['a\u2028b', 'raw'],
  ['a`b', 'quoted'], ['x"y', 'quoted'], ['a\\b', 'quoted'], ['a\nb', 'quoted'], ['a\tb', 'quoted'],
  ['a\0b', 'quoted'], ['a\x7fb', 'quoted'], ['x" xml:"y', 'quoted'], ['\n', 'quoted'], ['`', 'quoted'], ['"', 'quoted'], ['\\', 'quoted']
]

test('REQ-009: every kind of hostile key gets the tag goTag must produce', () => {
  for (const [key, kind] of GO_KEYS) {
    for (const [sample, options, field] of [[{ [key]: 1 }, '', 'int64'], [[{ [key]: 1 }, {}], ',omitempty', '\\*int64']]) {
      const tag = kind === 'raw' ? `\`json:"${key}${options}"\`` : JSON.stringify('json:' + JSON.stringify(key + options))
      const lines = jsonToTypes(JSON.stringify(sample), 'go').split('\n')
      const fields = lines.filter((line) => line.startsWith('\t'))
      assert.equal(fields.length, 1, JSON.stringify(key))
      assert.ok(fields[0].endsWith(` ${tag}`) && new RegExp(`^\\t\\w+ +${field} +\\S`).test(fields[0]), JSON.stringify(key) + options)
      assert.ok(lines.filter((line) => !line.startsWith('\t')).every((line) => /^(|type \w+ struct \{|type Root \[\]RootItem|\})$/.test(line)), JSON.stringify(key))
    }
  }
})

test('REQ-010: a JSON key is escaped in a Rust rename attribute', () => {
  const rust = jsonToTypes('{"a\\"b\\\\c": 1, "x\\ny": 2}', 'rust')
  assert.ok(rust.includes('rename = "a\\"b\\\\c"'))
  assert.ok(rust.includes('rename = "x\\u{a}y"'))
  const hostile = jsonToTypes(JSON.stringify({ [evil]: 1 }), 'rust')
  const allowed = /^(|use serde::\{Deserialize, Serialize\};|#\[derive\(Debug, Clone, Serialize, Deserialize\)\]|pub struct Root \{|    #\[serde\(rename = ".*"\)\]|    pub \w+: i64,|\})$/
  assert.ok(hostile.split('\n').every((line) => allowed.test(line)), hostile)
})

test('Types: a hostile JSON key stays inside one string in every language', () => {
  const sample = JSON.stringify({ [evil]: { [evil]: [1] }, 'a b': 1 })
  const allowed = {
    typescript: /^(|export interface \w+ \{|  ("([^"\\]|\\.)*"|\w+): [\w\[\]]+|\})$/,
    go: /^(|type \w+ struct \{|\t\w+ +[\w*\[\]]+ +(`json:"[^`"\\]*"`|"json:\\"([^"\\]|\\.)*\\"")|\})$/,
    rust: /^(|use serde::\{Deserialize, Serialize\};|#\[derive\(Debug, Clone, Serialize, Deserialize\)\]|pub struct \w+ \{|    #\[serde\(rename = "([^"\\]|\\.)*"\)\]|    pub \w+: [\w<>]+,|\})$/,
    python: /^(|from __future__ import annotations|from dataclasses import dataclass|@dataclass|class \w+:|    \w+: [\w\[\] |]+)$/
  }
  for (const language of Object.keys(allowed)) {
    const code = jsonToTypes(sample, language)
    for (const line of code.split('\n')) assert.ok(allowed[language].test(line), `${language}: ${JSON.stringify(line)}`)
  }
})

test('Types: the root type name is reduced to letters and digits', () => {
  for (const language of ['typescript', 'go', 'rust', 'python']) {
    const code = jsonToTypes('{"a":{"b":1}}', language, 'X {}\nfunc init() {}\ntype Z struct {')
    assert.ok(code.split('\n').every((line) => !/^(func|type Z)/.test(line)), language)
    assert.ok(/(interface|class|type|struct) XFuncInitTypeZStruct\b/.test(code), language)
  }
})
