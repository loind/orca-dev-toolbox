// A small regular expression matcher that never backtracks: it answers "does this match?" for the
// patterns of JSONPath filters (=~, match(), search()). JavaScript cannot cancel a running RegExp, and
// a pattern from the user or from the data can make it backtrack for minutes.
//
// The pattern is parsed, compiled to a Thompson/Pike program and run on the subject once: every thread
// advances in lockstep and no state is added twice in one step, so for a given pattern the time is linear
// in the subject. The constant is the program: each live thread walks the precomputed closure behind it
// after every character, so one match costs at most about (instructions x instructions x characters)
// steps, and a query is held to a work budget (see BUDGET). While no thread is alive, a search jumps to
// the next character a match can start with (not used when the pattern can match the empty string, when
// the search is anchored (y flag, match()), or when more than 32 different sets can start a match).
// Supported: literals and escapes, . and [...], \d \D \w \W \s \S \b \B, ^ $, groups ((...), (?:...), (?<n>...)), |, and the quantifiers * + ? {n}
// {n,} {n,m} with their lazy forms. Flags: i (JavaScript's case folding without the u flag, for every
// BMP character), m, s, and g, y as RegExp.test keeps lastIndex.
// Refused: back references, lookahead and lookbehind, \p{...}, inline flags (?i:...), the u flag, and
// anything over the size limits.
//
// Known limits, accepted:
// - With g or y, lastIndex can differ from RegExp when a loop can match the empty string (JavaScript
//   drops an empty iteration, this matcher does not: /(?:|a)?/y on 'a' leaves lastIndex 1 in JavaScript
//   and 0 here). The yes/no answer of that call is the same; a later test() on the same object starts from
//   the other position and can differ.
// - match() and search() used to compile with the u flag. Now an astral character is two UTF-16 units
//   (. does not match a whole emoji), \u{61} is the letter u repeated 61 times, and an identity escape
//   such as \- outside a class is accepted.
// - One match is not bounded tightly: up to about 2,000 x 2,000 x 10,000 steps. A whole query is bounded
//   by withRegexBudget(): see BUDGET. Work that stays linear in the data (up to FREE_PER_CHAR states per
//   character searched) is not counted against it.

const MAX_PATTERN = 200 // characters
const MAX_PROGRAM = 2000 // instructions, after counted repeats are expanded
const MAX_SUBJECT = 10000 // characters; a longer subject never matches
// Work allowed for all the regex matches of one query, counted in states: for every thread that moves,
// the length of the closure it walks (new states or not), plus the steps of working out a closure the first
// time, plus the length of the program for every test(), plus COMPILE_COST per instruction for every
// pattern compiled during the query. A filter runs a match once per element, so without a total a
// near-cap pattern on 200,000 elements takes minutes, and the view re-runs it on every keystroke.
// The budget is BUDGET plus FREE_PER_CHAR for every character searched: work that stays linear in the data
// is not what the budget is for. An ordinary pattern needs a few states per character (see the 10 MB log
// test: error|warn|... /i, (\w+) (\w+) (\w+) (\w+)$, \w+@\w+\.\w+, .*timeout.* all stay below
// FREE_PER_CHAR), so it never reaches the budget. A pattern whose threads walk long closures, such as
// (?:a?){990}$, needs thousands per character; the budget is checked after every character, so the match
// stops soon after BUDGET states (0.3-0.6 s here). The tests for it allow 3 s so that a busy machine passes.
const BUDGET = 20000000
const FREE_PER_CHAR = 10
const COMPILE_COST = 64
let meter = null

/** Runs `fn`; every regex match inside it draws on one budget, and the match that exhausts it throws. */
export function withRegexBudget(fn) {
  meter = { left: BUDGET }
  try {
    return fn()
  } finally {
    meter = null
  }
}
const overBudget = () => new Error(`This query does too much regular expression work (over ${BUDGET / 1e6} million steps beyond ${FREE_PER_CHAR} per character searched): use a simpler pattern or a narrower filter.`)

const fail = (reason) => {
  throw new Error(`This regular expression is not allowed: ${reason}`)
}
const unsupported = (feature) => fail(`${feature} is not supported`)

const isLineEnd = (c) => c === 10 || c === 13 || c === 0x2028 || c === 0x2029
const DIGIT = [48, 57]
const WORD = [48, 57, 65, 90, 95, 95, 97, 122]
const SPACE = [9, 13, 32, 32, 160, 160, 0x1680, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f, 0x202f, 0x205f, 0x205f, 0x3000, 0x3000, 0xfeff, 0xfeff]
const LINE_ENDS = [10, 10, 13, 13, 0x2028, 0x2029]
const isWord = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || c === 95 || (c >= 97 && c <= 122)

/** The ranges [lo, hi, lo, hi, ...] of the code units not in `ranges`. */
function complement(ranges) {
  const sorted = []
  for (let i = 0; i < ranges.length; i += 2) sorted.push([ranges[i], ranges[i + 1]])
  sorted.sort((a, b) => a[0] - b[0])
  const out = []
  let next = 0
  for (const [lo, hi] of sorted) {
    if (lo > next) out.push(next, lo - 1)
    next = Math.max(next, hi + 1)
  }
  if (next <= 0xffff) out.push(next, 0xffff)
  return out
}

// ---- Parser: pattern text -> tree. Nodes: { set, neg } | { assert } | { cat } | { alt } | { rep, min, max, lazy }.

function parse(source) {
  let i = 0
  const hex = (count) => {
    const digits = source.slice(i + 1, i + 1 + count)
    if (digits.length !== count || !/^[0-9a-fA-F]+$/.test(digits)) return -1
    i += count
    return parseInt(digits, 16)
  }
  // After a backslash (i is on the character after it): a code unit, or a class as { ranges, neg }.
  function escape(inClass) {
    if (i >= source.length) fail('a trailing backslash is not valid')
    const c = source[i]
    if (c === 'd' || c === 'D') return { ranges: DIGIT, neg: c === 'D' }
    if (c === 'w' || c === 'W') return { ranges: WORD, neg: c === 'W' }
    if (c === 's' || c === 'S') return { ranges: SPACE, neg: c === 'S' }
    if (/[1-9]/.test(c)) unsupported('a back reference')
    if (c === '0' && /\d/.test(source[i + 1] ?? '')) unsupported('an octal escape')
    if (c === 'k') unsupported('a named back reference')
    if (c === 'p' || c === 'P') unsupported('a Unicode property escape')
    if (c === 'c') unsupported('a control escape')
    const named = { 0: 0, n: 10, r: 13, t: 9, v: 11, f: 12 }
    if (c in named) return named[c]
    if (c === 'b' && inClass) return 8
    if (c === 'x' || c === 'u') {
      const code = hex(c === 'x' ? 2 : 4)
      return code >= 0 ? code : c.charCodeAt(0)
    }
    return source.charCodeAt(i)
  }
  function quantifierAt(at) {
    const c = source[at]
    if (c === '*') return { min: 0, max: Infinity, end: at + 1 }
    if (c === '+') return { min: 1, max: Infinity, end: at + 1 }
    if (c === '?') return { min: 0, max: 1, end: at + 1 }
    const m = c === '{' ? /^\{(\d+)(?:(,)(\d*))?\}/.exec(source.slice(at)) : null
    if (!m) return null
    const min = Number(m[1])
    const max = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : min
    if (max < min) fail('the numbers in {} are out of order')
    return { min, max, end: at + m[0].length }
  }
  const members = (e) => (typeof e === 'object' ? (e.neg ? complement(e.ranges) : e.ranges) : [e, e])
  function charClass() {
    i++
    const neg = source[i] === '^'
    if (neg) i++
    const ranges = []
    const item = () => {
      const c = source[i++]
      if (c !== '\\') return c.charCodeAt(0)
      const e = escape(true)
      i++
      return e
    }
    while (source[i] !== ']') {
      if (i >= source.length) fail('a character class is not closed')
      const lo = item()
      if (source[i] === '-' && i + 1 < source.length && source[i + 1] !== ']') {
        i++
        const hi = item()
        if (typeof lo === 'object' || typeof hi === 'object') ranges.push(...members(lo), 45, 45, ...members(hi)) // [\d-z]: the dash is a plain character
        else if (lo > hi) fail('a character range is out of order')
        else ranges.push(lo, hi)
      } else ranges.push(...members(lo))
    }
    i++
    return { set: ranges, neg }
  }
  function atom() {
    const c = source[i]
    if (c === '(') {
      i++
      if (source[i] === '?') {
        const kind = source.slice(i + 1, i + 3)
        if (kind[0] === ':') i += 2
        else if (kind === '<=' || kind === '<!') unsupported('lookbehind')
        else if (kind[0] === '=' || kind[0] === '!') unsupported('lookahead')
        else if (/^<[^>]+>/.test(source.slice(i + 1))) i += source.slice(i + 1).indexOf('>') + 2
        else if (/^[a-zA-Z-]+:/.test(source.slice(i + 1))) fail('inline flags (?i:...) are not supported')
        else fail('this group syntax is not valid')
      }
      const inner = alternation()
      if (source[i] !== ')') fail('a group is not closed')
      i++
      return inner
    }
    if (c === '[') return charClass()
    if (c === '.') return i++, { set: LINE_ENDS, neg: true, dot: true }
    if (c === '^' || c === '$') return i++, { assert: c }
    if (c === '*' || c === '+' || c === '?' || (c === '{' && quantifierAt(i))) fail('there is nothing to repeat')
    if (c === '\\') {
      i++
      if (source[i] === 'b' || source[i] === 'B') return i++, { assert: source[i - 1] }
      const e = escape(false)
      i++
      return typeof e === 'object' ? { set: e.ranges, neg: e.neg } : { set: [e, e], neg: false }
    }
    i++
    return { set: [c.charCodeAt(0), c.charCodeAt(0)], neg: false }
  }
  function sequence() {
    const list = []
    while (i < source.length && source[i] !== '|' && source[i] !== ')') {
      let node = atom()
      const q = quantifierAt(i)
      if (q) {
        if (node.assert) fail('an assertion cannot be repeated')
        i = q.end
        const lazy = source[i] === '?'
        if (lazy) i++
        node = { rep: node, min: q.min, max: q.max, lazy }
        if (quantifierAt(i)) fail('there is nothing to repeat')
      }
      list.push(node)
    }
    return { cat: list }
  }
  function alternation() {
    const list = [sequence()]
    while (source[i] === '|') {
      i++
      list.push(sequence())
    }
    return list.length === 1 ? list[0] : { alt: list }
  }
  const tree = alternation()
  if (i < source.length) fail('a ) has no matching (')
  return tree
}

// ---- Compiler: tree -> program, as parallel arrays. SET tests one character against `arg`
// ({ set: ranges, neg }); SPLIT tries `x` before `y`; JMP goes to `x`; ASSERT checks a position; MATCH ends.

const SET = 0
const SPLIT = 1
const JMP = 2
const ASSERT = 3
const MATCH = 4

function compile(tree, full, dotAll) {
  const prog = { op: [], x: [], y: [], arg: [] }
  const emit = (op, x = 0, y = 0, arg = null) => {
    if (prog.op.length > MAX_PROGRAM + 4) fail(`it needs more than ${MAX_PROGRAM} steps`) // stops a huge {n,m} early
    prog.op.push(op)
    prog.x.push(x)
    prog.y.push(y)
    prog.arg.push(arg)
    return prog.op.length - 1
  }
  const here = () => prog.op.length
  // `lazy` swaps which side of a SPLIT is tried first; the answer is the same, the match end is not.
  const aim = (split, body, after, lazy) => {
    prog.x[split] = lazy ? after : body
    prog.y[split] = lazy ? body : after
  }
  function gen(node) {
    if (node.cat) for (const part of node.cat) gen(part)
    else if (node.alt) {
      const jumps = []
      node.alt.forEach((branch, k) => {
        if (k === node.alt.length - 1) return gen(branch)
        const split = emit(SPLIT, here() + 1)
        gen(branch)
        jumps.push(emit(JMP))
        prog.y[split] = here()
      })
      for (const jump of jumps) prog.x[jump] = here()
    } else if (node.rep) {
      // Stop copying a body that emits nothing, so an empty body repeated 10^11 times stays cheap.
      const copy = () => {
        const before = here()
        gen(node.rep)
        return here() > before
      }
      let grows = true
      for (let n = 0; n < node.min && grows; n++) grows = copy()
      if (node.max === Infinity) {
        const split = emit(SPLIT)
        copy()
        emit(JMP, split)
        aim(split, split + 1, here(), node.lazy)
      } else {
        const splits = []
        for (let n = node.min; n < node.max && grows; n++) {
          splits.push(emit(SPLIT))
          grows = copy()
        }
        for (const split of splits) aim(split, split + 1, here(), node.lazy)
      }
    } else if (node.assert) emit(ASSERT, 0, 0, node.assert)
    else emit(SET, 0, 0, (node.made ??= makeSet(node.dot && dotAll ? [] : node.set, node.dot && dotAll ? true : node.neg))) // one set per parse node, not per copy of a counted repeat
  }
  if (full) emit(ASSERT, 0, 0, 'A')
  const base = here()
  gen(tree)
  if (here() - base > MAX_PROGRAM) fail(`it needs more than ${MAX_PROGRAM} steps`)
  if (full) emit(ASSERT, 0, 0, 'Z')
  emit(MATCH)
  return prog
}

// ---- Matcher: Pike's lockstep simulation. Threads stay in priority order, so the end it returns is
// the one a backtracking engine reports; a state is added at most once per step, which bounds the work.

/** A character set for the matcher: sorted, merged ranges, and a table for the characters below 256. */
function makeSet(ranges, neg) {
  const pairs = []
  for (let k = 0; k < ranges.length; k += 2) pairs.push([ranges[k], ranges[k + 1]])
  pairs.sort((p, q) => p[0] - q[0])
  const merged = []
  for (const [lo, hi] of pairs) {
    if (merged.length && lo <= merged[merged.length - 1] + 1) merged[merged.length - 1] = Math.max(merged[merged.length - 1], hi)
    else merged.push(lo, hi)
  }
  const set = { r: Int32Array.from(merged), neg, low: new Uint8Array(256), take: new Uint8Array(256) }
  for (let c = 0; c < 256; c++) {
    set.low[c] = binarySearch(set.r, c) ? 1 : 0
    set.take[c] = set.low[c] === 1 !== neg ? 1 : 0 // the answer for hits(), without the i flag
  }
  return set
}
// Whether c is in the sorted, merged ranges r = [lo, hi, lo, hi, ...].
function binarySearch(r, c) {
  let lo = 0
  let hi = r.length / 2 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (c < r[2 * mid]) hi = mid - 1
    else if (c > r[2 * mid + 1]) lo = mid + 1
    else return true
  }
  return false
}
const contains = (set, c) => (c < 256 ? set.low[c] === 1 : binarySearch(set.r, c))

const one = (text) => (text.length === 1 ? text.charCodeAt(0) : -1)
// JavaScript's case folding without the u flag (the spec's Canonicalize): the upper case of a single code
// unit, unless that is more than one unit or turns a non-ASCII character into an ASCII one.
const fold = (c) => {
  const up = one(String.fromCharCode(c).toUpperCase())
  return up < 0 || (c >= 128 && up < 128) ? c : up
}
// variantsOf[c]: every code unit that counts as the same as c with the i flag, undefined when there is
// none. Built once, on the first use of the i flag.
let variantsOf = null
function foldTable() {
  const classes = new Map()
  for (let c = 0; c <= 0xffff; c++) {
    const key = fold(c)
    if (classes.has(key)) classes.get(key).push(c)
    else classes.set(key, [c])
  }
  variantsOf = new Array(0x10000)
  for (const members of classes.values()) if (members.length > 1) for (const c of members) variantsOf[c] = members
}

// Whether `set` takes the character c; `same` are the characters that count as c with the i flag.
function hits(set, c, same) {
  if (!same) return c < 256 ? set.take[c] === 1 : binarySearch(set.r, c) !== set.neg
  let hit = false
  for (let v = 0; v < same.length && !hit; v++) hit = contains(set, same[v])
  return hit !== set.neg
}

/**
 * The characters a match can start with, or null when there is no use in looking: the pattern can match
 * the empty string, or it starts with too many different sets. `low` answers for the characters below
 * 256 at once. Assertions are taken as true, so this only ever lets too many positions through.
 */
function firstSet(prog, ignoreCase) {
  const seen = new Uint8Array(prog.op.length)
  const todo = [0]
  const sets = []
  while (todo.length) {
    const pc = todo.pop()
    if (seen[pc]) continue
    seen[pc] = 1
    if (prog.op[pc] === JMP) todo.push(prog.x[pc])
    else if (prog.op[pc] === SPLIT) todo.push(prog.x[pc], prog.y[pc])
    else if (prog.op[pc] === ASSERT) todo.push(pc + 1)
    else if (prog.op[pc] === MATCH || sets.length >= 32) return null
    else sets.push(prog.arg[pc])
  }
  const low = new Uint8Array(256)
  for (let c = 0; c < 256; c++) low[c] = sets.some((set) => hits(set, c, ignoreCase ? variantsOf[c] : undefined)) ? 1 : 0
  return { low, sets }
}

let closureCost = 0
/** The character sets, assertions and MATCH reached from `start` through jumps, in priority order. */
function closure(prog, start) {
  const seen = new Uint8Array(prog.op.length)
  const todo = [start]
  const leaves = []
  closureCost = 0
  while (todo.length) {
    const pc = todo.pop()
    if (seen[pc]) continue
    seen[pc] = 1
    closureCost++
    if (prog.op[pc] === JMP) todo.push(prog.x[pc])
    else if (prog.op[pc] === SPLIT) todo.push(prog.y[pc], prog.x[pc])
    else leaves.push(pc)
  }
  return Int32Array.from(leaves)
}

/** The end of the match found in `s` from `from`, or -1. */
function run(re, s, from) {
  const { program, buffers, anchored, multiline, ignoreCase } = re
  const { op, arg, first, take, base } = program
  const { mark } = buffers
  const len = s.length
  // Stamps tell the states added in one step from those of another; they never repeat in a buffer.
  let stamp = buffers.stamp + 1
  buffers.stamp += len + 3
  if (buffers.stamp > 0x3fffffff) {
    mark.fill(0)
    buffers.stamp = 0
  }
  let clist = { pcs: buffers.a, n: 0 }
  let nlist = { pcs: buffers.b, n: 0 }
  const holds = (kind, pos) => {
    const before = pos > 0 ? s.charCodeAt(pos - 1) : -1
    const after = pos < len ? s.charCodeAt(pos) : -1
    switch (kind) {
      case 'A': return pos === 0
      case 'Z': return pos === len
      case '^': return pos === 0 || (multiline && isLineEnd(before))
      case '$': return pos === len || (multiline && isLineEnd(after))
      case 'b': return isWord(before) !== isWord(after)
      default: return isWord(before) === isWord(after)
    }
  }
  // The states a thread can enter from `start` without reading a character: the character sets and MATCH at
  // the end of the jumps, in priority order. The jumps are walked once per start and kept; an assertion on
  // the way is checked here, at the position, and the states behind it follow in its place.
  const enter = (list, start, pos) => {
    let leaves = program.closures[start]
    if (leaves === undefined) {
      leaves = program.closures[start] = closure(program, start)
      program.asserts[start] = leaves.some((q) => op[q] === ASSERT) ? 1 : 0
      work += closureCost
    }
    let added = leaves.length // the walk is the cost, whether a state is new or not
    for (let k = 0; k < leaves.length; k++) {
      const q = leaves[k]
      if (mark[q] === stamp) continue
      mark[q] = stamp
      if (op[q] !== ASSERT) list.pcs[list.n++] = q
      else if (holds(arg[q], pos)) added += enter(list, q + 1, pos)
    }
    return added
  }
  // The set-up of a run costs as much as the program is long; every character searched pays for FREE_PER_CHAR states.
  let work = op.length
  if (meter) meter.left += FREE_PER_CHAR * len
  let matched = -1
  for (let pos = from; ; pos++) {
    if (matched < 0 && (!anchored || pos === from)) {
      if (first && !anchored && clist.n === 0) {
        // No thread is alive: jump to the next character a match can start with.
        const before = pos
        while (pos < len && !(s.charCodeAt(pos) < 256 ? first.low[s.charCodeAt(pos)] === 1 : first.sets.some((set) => hits(set, s.charCodeAt(pos), ignoreCase ? variantsOf[s.charCodeAt(pos)] : undefined)))) pos++
        if (pos >= len) break
        if (pos > before) stamp++
      }
      work += enter(clist, 0, pos)
    }
    if (clist.n === 0 && (matched >= 0 || anchored)) break
    if (meter && work > meter.left) throw overBudget()
    stamp++
    nlist.n = 0
    const c = pos < len ? s.charCodeAt(pos) : -1
    const alive = clist.pcs
    const aliveCount = clist.n
    const next = nlist.pcs
    let nextCount = 0
    for (let k = 0; k < aliveCount; k++) {
      const pc = alive[k]
      if (op[pc] === MATCH) {
        matched = pos
        break // the threads after this one have a lower priority
      }
      if (c >= 0 && (c < 256 ? take[base[pc] + c] === 1 : hits(arg[pc], c, ignoreCase ? variantsOf[c] : undefined))) {
        const leaves = program.closures[pc + 1]
        if (leaves !== undefined && !program.asserts[pc + 1]) {
          // The common case, inline: the states behind this one are known and need no assertion.
          work += leaves.length // the walk is the cost, whether a state is new or not
          for (let j = 0; j < leaves.length; j++) {
            const q = leaves[j]
            if (mark[q] !== stamp) {
              mark[q] = stamp
              next[nextCount++] = q
            }
          }
        } else {
          nlist.n = nextCount
          work += enter(nlist, pc + 1, pos + 1)
          nextCount = nlist.n
        }
      }
    }
    nlist.n = nextCount
    const swap = clist
    clist = nlist
    nlist = swap
    if (pos >= len) break
  }
  if (meter) {
    meter.left -= work
    if (meter.left < 0) throw overBudget()
  }
  return matched
}

export class Regex {
  /** `full` makes the whole subject match (for match()); otherwise a part may match (search(), =~). */
  constructor(source, flags = '', full = false) {
    if (source.length > MAX_PATTERN) fail(`too long (${MAX_PATTERN} characters at most)`)
    for (const flag of flags) {
      if (flag === 'u' || flag === 'v') unsupported(`the ${flag} flag`)
      if (!'dgimsy'.includes(flag) || flags.indexOf(flag) !== flags.lastIndexOf(flag)) fail(`the flags "${flags}" are not valid`)
    }
    this.source = source
    this.flags = flags
    this.full = full
    this.lastIndex = 0
    this.multiline = flags.includes('m')
    this.ignoreCase = flags.includes('i')
    this.anchored = full || flags.includes('y')
    if (this.ignoreCase && !variantsOf) foldTable()
    const program = compile(parse(source), full, flags.includes('s'))
    program.first = this.anchored ? null : firstSet(program, this.ignoreCase)
    program.closures = new Array(program.op.length)
    program.asserts = new Uint8Array(program.op.length)
    // One row of 256 answers per distinct set: whether it takes each character below 256 (with the i flag folded in).
    const rows = new Map()
    program.base = new Int32Array(program.op.length)
    for (let pc = 0; pc < program.op.length; pc++) if (program.op[pc] === SET && !rows.has(program.arg[pc])) rows.set(program.arg[pc], rows.size * 256)
    program.take = new Uint8Array(rows.size * 256)
    for (const [set, at] of rows) for (let c = 0; c < 256; c++) program.take[at + c] = hits(set, c, this.ignoreCase ? variantsOf[c] : undefined) ? 1 : 0
    for (let pc = 0; pc < program.op.length; pc++) if (program.op[pc] === SET) program.base[pc] = rows.get(program.arg[pc])
    this.program = program
    // Buffers are made once and reused by every test(), so a test costs no allocation.
    const size = program.op.length
    this.buffers = { mark: new Int32Array(size), a: new Int32Array(size), b: new Int32Array(size), stamp: 0 }
    // Compiling a pattern that comes from the data is paid for from the query's budget.
    if (meter) {
      meter.left -= COMPILE_COST * size
      if (meter.left < 0) throw overBudget()
    }
  }

  /** Like RegExp.prototype.test, including lastIndex for the g and y flags. */
  test(subject) {
    const sticky = this.flags.includes('y')
    const stateful = sticky || this.flags.includes('g')
    const from = stateful ? this.lastIndex : 0
    let end = -1
    if (from <= subject.length && subject.length <= MAX_SUBJECT) end = run(this, subject, from)
    if (stateful) this.lastIndex = end < 0 ? 0 : end
    return end >= 0
  }
}
