// Run by test/security/jsonpath-small.test.mjs in a child process with a timeout: compares the linear
// matcher with JavaScript's RegExp on seeded random patterns and short subjects, and prints a JSON summary.
// A matcher that hangs makes the parent test fail after its timeout instead of hanging the whole gate.
import { queryJson } from '../../src/tools/jsonpath.js'
import { Regex } from '../../src/tools/linear-regex.js'
import { seededRandom } from '../../src/tools/mock.js'

const bad = []
const report = (message) => bad.length < 5 && bad.push(message)
const stats = { patterns: 0, pairs: 0, queries: 0, stateful: 0 }

const random = seededRandom(33033)
const pick = (list) => list[Math.floor(random() * list.length)]
const atoms = ['a', 'b', 'A', '-', '1', ' ', '.', '\\.', '\\n', '\\s', '\\S', '\\d', '\\D', '\\w', '\\W', '\\b', '\\B', '^', '$', '[ab]', '[^a]', '[a-b1]', '[\\d-]', '[\\w.]', '[^\\n]', '[]', '[^]', '[a-]', '[\\b]', '\\x61', '\\u0062', '\\t', 'é', '[+*|(]', '\\(', '\\|', '[A-b]', 'ς', 'σ', 'Σ', 'µ', 'μ', 'ǅ', 'ǆ', 'ϑ', 'θ', '[ςa]', '[^σ]', '[Σ-σ]']
const quantifiers = ['*', '+', '?', '{2}', '{1,3}', '{0,2}', '{2,}', '{0}', '{0,1}']
const expression = (depth) => {
  const parts = []
  for (let n = 1 + Math.floor(random() * 3); n > 0; n--) {
    let piece
    if (depth < 3 && random() < 0.3) piece = pick(['(', '(?:', '(?<g>']) + expression(depth + 1) + ')'
    else piece = pick(atoms)
    if (random() < 0.35 && !['^', '$', '\\b', '\\B'].includes(piece)) piece += pick(quantifiers) + (random() < 0.25 ? '?' : '')
    parts.push(piece)
  }
  let text = parts.join('')
  if (depth < 3 && random() < 0.25) text += '|' + expression(depth + 1)
  return text
}
const letters = ['a', 'b', 'A', 'B', '-', '1', ' ', '\n', '.', 'é', '\r', 'ς', 'σ', 'Σ', 'µ', 'μ', 'ǅ', 'ǆ', 'ϑ', 'θ']
const subject = () => Array.from({ length: Math.floor(random() * 13) }, () => pick(letters)).join('')

// The yes/no answer of search (=~, search()) and of match() for flags '', i, m and s.
for (const flags of ['', 'i', 'm', 's']) {
  for (let n = 0; n < 2500; n++) {
    const source = expression(0)
    let search
    let full
    try {
      search = new RegExp(source, flags)
      full = new RegExp(`(?<![^])(?:${source})(?![^])`, flags)
    } catch {
      continue
    }
    stats.patterns++
    const searcher = new Regex(source, flags)
    const matcher = new Regex(source, flags, true)
    for (let k = 0; k < 4; k++) {
      const s = subject()
      if (searcher.test(s) !== search.test(s)) report(`search /${source}/${flags} on ${JSON.stringify(s)}`)
      if (matcher.test(s) !== full.test(s)) report(`match /${source}/${flags} on ${JSON.stringify(s)}`)
      stats.pairs += 2
    }
  }
}

// The same through queryJson, for the =~ literal.
for (let n = 0; n < 400; n++) {
  const source = expression(0)
  if (/\[\+\*\|\(\]|\\\(/.test(source)) continue // an unbalanced ( inside a path filter
  const flags = pick(['', 'i', 'm', 's'])
  let js
  try {
    js = new RegExp(source, flags)
  } catch {
    continue
  }
  const s = subject()
  stats.queries++
  if ((queryJson([{ v: s }], `$[?(@.v =~ /${source}/${flags})]`).length === 1) !== js.test(s)) report(`=~ /${source}/${flags} on ${JSON.stringify(s)}`)
}

// g and y: lastIndex carries over from one test to the next, as in RegExp.
const small = ['a', 'a+', 'ab?', 'a*', '^a', 'b|a', '(ab)+', '\\bb', 'a{2}', '.a', 'a$', '', 'a+?', '(a|ab)(c|bcd)?']
for (const flags of ['g', 'y', 'gy']) {
  for (const source of small) {
    const js = new RegExp(source, flags)
    const mine = new Regex(source, flags)
    for (let k = 0; k < 12; k++) {
      const s = Array.from({ length: Math.floor(random() * 6) }, () => pick(['a', 'b', 'c', 'd'])).join('')
      stats.stateful++
      if (mine.test(s) !== js.test(s) || mine.lastIndex !== js.lastIndex) report(`/${source}/${flags} on ${JSON.stringify(s)} (step ${k}): lastIndex ${mine.lastIndex} vs ${js.lastIndex}`)
    }
  }
}
console.log(JSON.stringify({ ...stats, bad }))
