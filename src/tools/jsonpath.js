// JSONPath (RFC 9535 in spirit): $.a.b, ['key'], [0], [-1], [*], .*, ..deep, [1:3], [0,2] and
// filters such as [?(@.price < 10 && @.tags)]. No eval: the panel's CSP forbids it anyway.

/** Tokens of a path: { type: 'child' | 'deep', selectors: [...] }. */
export function parsePath(text) {
  let src = text.trim()
  if (!src) throw new Error('Type a path such as $.items[*].name')
  if (src[0] !== '$') src = src[0] === '.' || src[0] === '[' ? `$${src}` : `$.${src}`
  const steps = []
  let i = 1
  while (i < src.length) {
    if (src.startsWith('..', i)) {
      i += 2
      if (src[i] === '[') {
        const [selectors, next] = bracket(src, i)
        steps.push({ type: 'deep', selectors })
        i = next
      } else {
        const [name, next] = identifier(src, i)
        steps.push({ type: 'deep', selectors: [name === '*' ? { kind: 'wildcard' } : { kind: 'name', name }] })
        i = next
      }
    } else if (src[i] === '.') {
      const [name, next] = identifier(src, i + 1)
      steps.push({ type: 'child', selectors: [name === '*' ? { kind: 'wildcard' } : { kind: 'name', name }] })
      i = next
    } else if (src[i] === '[') {
      const [selectors, next] = bracket(src, i)
      steps.push({ type: 'child', selectors })
      i = next
    } else if (/\s/.test(src[i])) {
      i++
    } else {
      throw new Error(`Unexpected "${src[i]}" at position ${i + 1}.`)
    }
  }
  return steps
}

function identifier(src, i) {
  if (src[i] === '*') return ['*', i + 1]
  const match = /^[^.[\]\s]+/.exec(src.slice(i))
  if (!match) throw new Error(`Expected a name at position ${i + 1}.`)
  return [match[0], i + match[0].length]
}

// [ ... ] with comma-separated selectors; returns [selectors, index after ']'].
function bracket(src, start) {
  let depth = 0
  let quote = null
  let i = start
  for (; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
    } else if (c === "'" || c === '"') quote = c
    else if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') {
      depth--
      if (depth === 0 && c === ']') break
    }
  }
  if (i >= src.length) throw new Error('A [ is never closed.')
  const body = src.slice(start + 1, i).trim()
  return [splitTop(body, ',').map((part) => selector(part.trim())), i + 1]
}

function splitTop(text, sep) {
  const parts = []
  let depth = 0
  let quote = null
  let last = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
    } else if (c === "'" || c === '"') quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === sep && depth === 0) {
      parts.push(text.slice(last, i))
      last = i + 1
    }
  }
  parts.push(text.slice(last))
  return parts
}

function selector(part) {
  if (part === '*') return { kind: 'wildcard' }
  if (/^-?\d+$/.test(part)) return { kind: 'index', index: Number(part) }
  if (/^(-?\d*):(-?\d*)(:(-?\d+))?$/.test(part)) {
    const [, a, b, , step] = /^(-?\d*):(-?\d*)(:(-?\d+))?$/.exec(part)
    return { kind: 'slice', start: a === '' ? null : Number(a), end: b === '' ? null : Number(b), step: step ? Number(step) : 1 }
  }
  if (/^(['"]).*\1$/s.test(part)) return { kind: 'name', name: unquote(part) }
  if (part.startsWith('?')) {
    let expr = part.slice(1).trim()
    if (expr.startsWith('(') && expr.endsWith(')') && balanced(expr.slice(1, -1))) expr = expr.slice(1, -1)
    return { kind: 'filter', expr: parseExpr(expr) }
  }
  throw new Error(`Cannot read selector [${part}].`)
}

function balanced(text) {
  let depth = 0
  for (const c of text) {
    if (c === '(') depth++
    else if (c === ')' && --depth < 0) return false
  }
  return depth === 0
}

function unquote(text) {
  return text.slice(1, -1).replace(/\\(.)/g, '$1')
}

// Filter expressions: || && ! comparisons, @ and $ paths, literals, length(@.x), match/search.
function parseExpr(text) {
  const tokens = tokenize(text)
  let pos = 0
  const peek = () => tokens[pos]
  const take = (value) => {
    if (value && tokens[pos]?.value !== value) throw new Error(`Expected ${value} in filter "${text}".`)
    return tokens[pos++]
  }
  function or() {
    let left = and()
    while (peek()?.value === '||') {
      take()
      left = { op: '||', left, right: and() }
    }
    return left
  }
  function and() {
    let left = not()
    while (peek()?.value === '&&') {
      take()
      left = { op: '&&', left, right: not() }
    }
    return left
  }
  function not() {
    if (peek()?.value === '!') {
      take()
      return { op: '!', value: not() }
    }
    return comparison()
  }
  function comparison() {
    const left = primary()
    const op = peek()?.value
    if (['==', '!=', '<', '<=', '>', '>=', '=~'].includes(op)) {
      take()
      return { op, left, right: primary() }
    }
    return { op: 'exists', value: left }
  }
  function primary() {
    const token = take()
    if (!token) throw new Error(`Filter "${text}" ends early.`)
    if (token.value === '(') {
      const inner = or()
      take(')')
      return inner
    }
    if (token.type === 'path') return { op: 'path', root: token.value[0], steps: token.value === '@' || token.value === '$' ? [] : parsePath(`$${token.value.slice(1)}`) }
    if (token.type === 'func') {
      const args = []
      take('(')
      while (peek()?.value !== ')') {
        const arg = or()
        // A bare path passed to a function is its value, not an existence test.
        args.push(arg.op === 'exists' ? arg.value : arg)
        if (peek()?.value === ',') take()
      }
      take(')')
      return { op: 'call', name: token.value, args }
    }
    if (token.type === 'literal') return { op: 'literal', value: token.literal }
    throw new Error(`Unexpected "${token.value}" in filter.`)
  }
  const tree = or()
  if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos].value}" in filter.`)
  return tree
}

function tokenize(text) {
  const tokens = []
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    let m
    if (/^\s/.test(rest)) i++
    else if ((m = /^(\|\||&&|==|!=|<=|>=|=~|[<>!(),])/.exec(rest))) {
      tokens.push({ type: 'op', value: m[0] })
      i += m[0].length
    } else if ((m = /^[@$](\.\.?[\w-]+|\.\*|\[[^\]]*\])*/.exec(rest)) && m[0]) {
      tokens.push({ type: 'path', value: m[0] })
      i += m[0].length
    } else if ((m = /^(['"])((?:\\.|(?!\1).)*)\1/.exec(rest))) {
      tokens.push({ type: 'literal', value: m[0], literal: m[2].replace(/\\(.)/g, '$1') })
      i += m[0].length
    } else if ((m = /^\/((?:\\.|[^/])+)\/([gimsuy]*)/.exec(rest))) {
      tokens.push({ type: 'literal', value: m[0], literal: new RegExp(m[1], m[2]) })
      i += m[0].length
    } else if ((m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest))) {
      tokens.push({ type: 'literal', value: m[0], literal: Number(m[0]) })
      i += m[0].length
    } else if ((m = /^(true|false|null)\b/.exec(rest))) {
      tokens.push({ type: 'literal', value: m[0], literal: JSON.parse(m[0]) })
      i += m[0].length
    } else if ((m = /^(length|count|match|search|value)(?=\s*\()/.exec(rest))) {
      tokens.push({ type: 'func', value: m[0] })
      i += m[0].length
    } else throw new Error(`Cannot read "${rest.slice(0, 12)}" in filter.`)
  }
  return tokens
}

const NOTHING = Symbol('nothing')

function evaluate(node, current, root) {
  switch (node.op) {
    case 'literal':
      return node.value
    case 'path': {
      const found = select(node.steps, [{ value: node.root === '@' ? current : root, path: '$' }], root)
      return found.length ? found[0].value : NOTHING
    }
    case 'exists': {
      const value = evaluate(node.value, current, root)
      return node.value.op === 'path' ? value !== NOTHING : truthy(value)
    }
    case '!':
      return !evaluate(node.value, current, root)
    case '&&':
      return Boolean(evaluate(node.left, current, root)) && Boolean(evaluate(node.right, current, root))
    case '||':
      return Boolean(evaluate(node.left, current, root)) || Boolean(evaluate(node.right, current, root))
    case 'call': {
      const args = node.args.map((arg) => evaluate(arg, current, root))
      if (node.name === 'length' || node.name === 'count') {
        const v = args[0]
        if (typeof v === 'string' || Array.isArray(v)) return v.length
        return v && typeof v === 'object' ? Object.keys(v).length : NOTHING
      }
      if (node.name === 'match' || node.name === 'search') {
        if (typeof args[0] !== 'string') return false
        const pattern = args[1] instanceof RegExp ? args[1].source : String(args[1])
        return new RegExp(node.name === 'match' ? `^(?:${pattern})$` : pattern, 'u').test(args[0])
      }
      return args[0]
    }
    default: {
      const left = evaluate(node.left, current, root)
      const right = evaluate(node.right, current, root)
      if (node.op === '=~') return typeof left === 'string' && right instanceof RegExp && right.test(left)
      if (left === NOTHING || right === NOTHING) return node.op === '!=' ? left !== right : node.op === '==' && left === right
      switch (node.op) {
        case '==': return equal(left, right)
        case '!=': return !equal(left, right)
        case '<': return comparable(left, right) && left < right
        case '<=': return comparable(left, right) && left <= right
        case '>': return comparable(left, right) && left > right
        case '>=': return comparable(left, right) && left >= right
      }
    }
  }
  return false
}

const truthy = (value) => value !== NOTHING && value !== false && value !== null
const comparable = (a, b) => (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string')
const equal = (a, b) => (a && typeof a === 'object') || (b && typeof b === 'object') ? JSON.stringify(a) === JSON.stringify(b) : a === b

const childPath = (path, key) => (typeof key === 'number' ? `${path}[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`)

function children(node) {
  const { value, path } = node
  if (Array.isArray(value)) return value.map((v, i) => ({ value: v, path: childPath(path, i) }))
  if (value && typeof value === 'object') return Object.keys(value).map((k) => ({ value: value[k], path: childPath(path, k) }))
  return []
}

function descendants(node) {
  const out = [node]
  for (const child of children(node)) out.push(...descendants(child))
  return out
}

function apply(selector, node, root) {
  const { value, path } = node
  switch (selector.kind) {
    case 'name':
      return value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, selector.name) ? [{ value: value[selector.name], path: childPath(path, selector.name) }] : []
    case 'wildcard':
      return children(node)
    case 'index': {
      if (!Array.isArray(value)) return []
      const i = selector.index < 0 ? value.length + selector.index : selector.index
      return i >= 0 && i < value.length ? [{ value: value[i], path: childPath(path, i) }] : []
    }
    case 'slice': {
      if (!Array.isArray(value) || selector.step === 0) return []
      const n = value.length
      const norm = (i, fallback) => (i === null ? fallback : i < 0 ? Math.max(n + i, selector.step > 0 ? 0 : -1) : Math.min(i, n))
      const out = []
      if (selector.step > 0) for (let i = norm(selector.start, 0); i < norm(selector.end, n); i += selector.step) out.push({ value: value[i], path: childPath(path, i) })
      else for (let i = norm(selector.start, n - 1); i > norm(selector.end, -1); i += selector.step) if (i < n) out.push({ value: value[i], path: childPath(path, i) })
      return out
    }
    case 'filter':
      return children(node).filter((child) => truthy(evaluate(selector.expr, child.value, root)))
  }
  return []
}

function select(steps, nodes, root) {
  let current = nodes
  for (const step of steps) {
    const next = []
    for (const node of current) {
      const targets = step.type === 'deep' ? descendants(node) : [node]
      for (const target of targets) for (const s of step.selectors) next.push(...apply(s, target, root))
    }
    current = next
  }
  return current
}

/** Matches of `path` in `data`, each { value, path }. */
export function queryJson(data, path) {
  return select(parsePath(path), [{ value: data, path: '$' }], data)
}
