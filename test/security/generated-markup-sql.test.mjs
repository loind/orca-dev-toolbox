// Phase 4: JSX, image snippets and SQL IN lists are code or markup, so hostile input must stay data.
// JSX is compiled with esbuild and evaluated in node:vm with a recording `pwn`; nothing may call it.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import vm from 'node:vm'
import { transform as compileJsx } from 'esbuild'
import { snippets } from '../../src/tools/image.js'
import { htmlToJsx } from '../../src/tools/jsx.js'
import { transform } from '../../src/tools/transform.js'
import { launch, openPanel } from '../harness.mjs'

let browser
before(async () => (browser = await launch()))
after(async () => browser?.close())

/**
 * Compiles `jsx` and renders it against a stub React, in a sandbox where the sentinels are REAL globals:
 * pwn, alert, fetch, window, self, document. `calls` lists every call of a sentinel, `touched` every property
 * read on window, self or document. `marker` says that the value of the whole expression (or of the component)
 * is an object made by `h`: JSX that JavaScript reads as comparisons or regexes gives a boolean or a number.
 */
async function render(jsx) {
  const calls = []
  const touched = []
  const made = new WeakSet()
  const sentinel = (name) => (...args) => calls.push([name, ...args])
  const trap = (name) => new Proxy({}, { get: (_, key) => (touched.push(`${name}.${String(key)}`), sentinel(`${name}.${String(key)}`)) })
  const sandbox = {
    h: (type, props, ...children) => {
      const node = { type, props, children }
      made.add(node)
      return node
    },
    F: Symbol('Fragment'),
    pwn: sentinel('pwn'),
    alert: sentinel('alert'),
    fetch: sentinel('fetch'),
    window: trap('window'),
    self: trap('self'),
    document: trap('document')
  }
  vm.createContext(sandbox)
  const component = jsx.startsWith('export default')
  const before = Object.keys(sandbox)
  // A component is run through globalThis.__fn, so nothing else is added to the sandbox.
  const source = component ? jsx.replace(/^export default function/, 'globalThis.__fn = function') : `globalThis.__out = (\n${jsx}\n)`
  const { code } = await compileJsx(source, { loader: 'jsx', jsxFactory: 'h', jsxFragment: 'F' })
  let failed
  try {
    vm.runInContext(code, sandbox, { timeout: 2000 })
    if (component) sandbox.__out = sandbox.__fn()
  } catch (error) {
    failed = error.message
  }
  const added = Object.keys(sandbox).filter((key) => !before.includes(key) && key !== '__out' && key !== '__fn')
  return { calls, touched, added, tree: sandbox.__out, failed, marker: made.has(sandbox.__out) }
}

const elements = (node) => (node && typeof node === 'object' ? [node.type, ...(node.children ?? []).flatMap(elements)] : [])

/** How many inputs the oracle could not compile or run: safe, but the test reports the number. */
const unusable = { compile: 0, run: 0 }

/**
 * Converts, compiles and renders; asserts that nothing the input wrote ran (no sentinel called or touched, no global
 * written) and that the value is one element or fragment made by `h`. Returns the render.
 */
async function safe(html, options) {
  const jsx = htmlToJsx(html, options)
  let result
  try {
    result = await render(jsx)
  } catch (error) {
    // Output that does not compile is wrong but harmless; calling pwn is what must never happen.
    unusable.compile++
    return { calls: [], added: [], jsx, failed: error.message }
  }
  const where = `${JSON.stringify(html)} => ${jsx}`
  assert.deepEqual(result.calls, [], `a sentinel was called by ${where}`)
  assert.deepEqual(result.touched, [], `window, self or document was read by ${where}`)
  assert.deepEqual(result.added, [], `a global was written by ${where}`)
  if (result.failed) unusable.run++
  else assert.ok(result.marker, `the value is not an element made by h: ${where}`)
  return { ...result, jsx }
}

test('REQ-011: an attribute name that is not a plain name is dropped', () => {
  assert.equal(htmlToJsx('<path d="M0 0" {...pwn()}/>'), '<path d="M0 0" />')
  assert.equal(htmlToJsx('<div {...pwn(1, 2)} class="a">x</div>'), '<div className="a">x</div>')
  assert.equal(htmlToJsx('<div @click="a" :b="c" a.b="d" [e]="f" #g="h" (i)="j" ok="k">x</div>'), '<div ok="k">x</div>')
})

test('REQ-012: a style property name that is not a CSS name is dropped', () => {
  assert.ok(!htmlToJsx(`<div style="a(){},[pwn('k')](){},b: red">x</div>`).includes('pwn'))
  assert.equal(htmlToJsx('<div style="color: red; --gap: 4px">x</div>'), "<div style={{ color: 'red', '--gap': '4px' }}>x</div>")
  assert.equal(htmlToJsx('<div style="__proto__: x; [a]: 1; 1a: 2; a b: c; font-size: 12px">x</div>'), "<div style={{ fontSize: '12px' }}>x</div>")
})

test('REQ-012: a style value stays one string, even with quotes, backslashes and line breaks', async () => {
  const html = "<div style=\"font-family: 'A',\n  B\\; x: y'+pwn(1)+'\">x</div>"
  const { calls, tree } = await render(htmlToJsx(html))
  assert.deepEqual(calls, [])
  assert.equal(tree.props.style.fontFamily, "'A',\n  B\\")
  assert.equal(tree.props.style.x, "y'+pwn(1)+'")
})

test('REQ-013: an event handler that could leave its arrow function is dropped', () => {
  const dropped = htmlToJsx('<a onclick="}} data-x={pwn(1)} y={() => {">x</a>')
  assert.ok(!dropped.includes('pwn') && !dropped.includes('onClick'), dropped)
  assert.equal(htmlToJsx('<button onclick="go()">x</button>'), '<button onClick={() => { go() }}>x</button>')
  for (const bad of ['a{', 'a}', 'a`b', 'a/b', 'a<b', 'a\nb', 'a\r--> ', 'a\u2028b', 'a\u2029b', "go('x", 'go("x', "go('x\\'", 'go("x\\"', "go('a') + '", 'go(\'a" + \'']) {
    const q = bad.includes('"') ? "'" : '"'
    if (bad.includes(q)) continue
    assert.ok(!htmlToJsx(`<a onclick=${q}${bad}${q}>x</a>`).includes('onClick'), JSON.stringify(bad))
  }
  assert.ok(htmlToJsx(`<a onclick="go('a\\'b', 'c')">x</a>`).includes('onClick'))
})

test('REQ-013: a handler with an unclosed quote cannot swallow the markup after it', async () => {
  // Without the quote check, the text between two handlers becomes code inside the first handler.
  for (const html of [
    `<a onclick="String('">') ,pwn(1), x = '</a><b onclick="String('">z</a>`,
    `<a onclick='String("'>") ,pwn(1), x = "</a><b onclick='String("'>z</a>`,
    `<a onclick="String('\\">') ,pwn(1), x = '</a><b onclick="String('">z</a>`
  ]) {
    const jsx = htmlToJsx(html)
    // Dropping the handlers leaves tags that do not match, so the output may not compile; it must not run.
    const { calls, tree } = await render(jsx).catch(() => ({ calls: [], tree: null }))
    assert.deepEqual(calls, [], jsx)
    // Run every handler that survived: the text never was code.
    const run = (node) => {
      for (const value of Object.values(node?.props ?? {})) if (typeof value === 'function') try { value() } catch {}
      for (const child of node?.children ?? []) run(child)
    }
    run(tree)
    assert.deepEqual(calls, [], html)
  }
})

test('REQ-027: text that is left without an element is wrapped, never printed as code', async () => {
  const fragment = '<>\n  pwn(1)\n</>'
  assert.equal(htmlToJsx('<window.alert>pwn(1)</window.alert>'), fragment)
  assert.equal(htmlToJsx('pwn(1)'), fragment)
  assert.equal(htmlToJsx('x = pwn(1)'), '<>\n  x = pwn(1)\n</>')
  assert.equal(htmlToJsx('<'), "<>\n  {'<'}\n</>")
  // Text after a stray closing tag is outside every element too.
  assert.equal(htmlToJsx('</a>pwn(1)'), '<>\n  pwn(1)\n</>')
  assert.equal(htmlToJsx('pwn(1)', { component: 'C' }), 'export default function C() {\n  return (\n    <>\n      pwn(1)\n    </>\n  )\n}')
  for (const options of [undefined, { component: 'C' }]) {
    for (const html of ['<window.alert>pwn(1)</window.alert>', 'pwn(1)', 'style=<!-- /*/ -->']) {
      const { calls, tree, jsx, failed } = await safe(html, options)
      assert.deepEqual(calls, [], jsx)
      assert.equal(failed, undefined, `${html} => ${jsx}: ${failed}`)
      assert.equal(typeof tree.type, 'symbol', 'the root is a fragment')
      assert.ok(tree.children.every((child) => typeof child === 'string'), jsx)
    }
  }
  // A comment cannot end early, so what follows `*/` stays inside it.
  assert.equal(htmlToJsx('<p><!-- */ pwn(1) /* --></p>'), '<p>{/* * / pwn(1) /* */}</p>')
  assert.equal((await safe('<p><!-- */ pwn(1) /* --></p>')).failed, undefined)
  // Markup with an element is not wrapped again.
  assert.equal(htmlToJsx('<p>pwn(1)</p>'), '<p>pwn(1)</p>')
  assert.equal(htmlToJsx('<div class="a">x<b>y</b></div>'), '<div className="a">x<b>y</b></div>')
  assert.equal(htmlToJsx('<p>a</p><p>b</p>'), '<>\n  <p>a</p><p>b</p>\n</>')
  // A comment at the root is root content too: `{/* c */}` in `return ( … )` is an object literal.
  assert.equal(htmlToJsx('<!-- c --><p>x</p>'), '<>\n  {/* c */}<p>x</p>\n</>')
  assert.equal(htmlToJsx('<!-- c -->'), '<>\n  {/* c */}\n</>')
  assert.equal(htmlToJsx('<p><!-- c -->x</p>'), '<p>{/* c */}x</p>')
})

test('JSX: the output is balanced by construction', async () => {
  const cases = {
    // A closing tag that matches nothing is dropped, at any depth.
    '<br></a><i title="/,pwn(1),/"></i><br>': '<>\n  <br /><i title="/,pwn(1),/"></i><br />\n</>',
    '<img src=a></p><!--pwn(1)--><b a=/><br>': '<>\n  <img src="a" />{/* pwn(1) */}<b a /><br />\n</>',
    '<div></p>x</div>': '<div>x</div>',
    '<div>x</span></div>': '<div>x</div>',
    '</div><p>x</p>': '<p>x</p>',
    '<br></br>': '<br />',
    // A closing tag closes the tags opened inside it; tags still open at the end are closed.
    '<div><b>x</div>': '<div><b>x</b></div>',
    '<a><b><i>x</a>y</i>': '<>\n  <a><b><i>x</i></b></a>y\n</>',
    '<div><p>x': '<div><p>x</p></div>',
    '<div class="a"': '<>\n  {\'<\'}div class="a"\n</>',
    // HTML5 end tags that may be left out: the open <li> is not closed by the next <li>, so they nest.
    '<ul><li>a<li>b</ul>': '<ul><li>a<li>b</li></li></ul>',
    '<p>a<p>b': '<p>a<p>b</p></p>',
    // Tag names match without case, and the closing tag is written as the opening one.
    '<DIV>x</div>': '<DIV>x</DIV>',
    '<DIV>x</div>y': '<>\n  <DIV>x</DIV>y\n</>',
    // A raw-text element is never self-closing in HTML.
    '<style/>a{}</style>': '<style>{`a{}`}</style>'
  }
  for (const [html, expected] of Object.entries(cases)) assert.equal(htmlToJsx(html), expected, html)
  // Well-formed markup is not changed.
  for (const html of ['<div><p class="a">x</p><br></div>', '<ul><li>a</li><li>b</li></ul>', '<svg viewBox="0 0 1 1"><g><path d="M0 0"/></g></svg>', '<p>a<br>b<img src="x"></p>']) {
    const out = htmlToJsx(html)
    assert.ok(!out.startsWith('<>'), html)
    assert.equal(out, htmlToJsx(html.replace(/>\s+</g, '><')))
  }
  assert.equal(htmlToJsx('<ul><li>a</li><li>b</li></ul>'), '<ul><li>a</li><li>b</li></ul>')
  assert.equal(htmlToJsx('<svg viewBox="0 0 1 1"><g><path d="M0 0"/></g></svg>'), '<svg viewBox="0 0 1 1"><g><path d="M0 0" /></g></svg>')
  assert.equal(htmlToJsx('<p>a<br>b<img src="x"></p>'), '<p>a<br />b<img src="x" /></p>')
  // Every shape above compiles and renders as one element or fragment.
  for (const html of Object.keys(cases)) {
    const result = await safe(html)
    // `<DIV>` is a reference to a variable in JSX, so it stops at run time here; the empty case and the lone `<` are fine.
    if (!html.startsWith('<DIV>')) assert.equal(result.failed, undefined, html)
  }
})

test('REQ-012: a carriage return in a style value is written as an escape', async () => {
  const out = htmlToJsx('<div style="x: a\rb\r\nc">x</div>')
  assert.equal(out, "<div style={{ x: 'a\\rb\\r\\nc' }}>x</div>")
  assert.ok(!out.includes('\r'))
  assert.equal((await render(out)).tree.props.style.x, 'a\rb\r\nc')
})

test('REQ-014: a "</" inside the raw text of <style> or <script> does not throw', async () => {
  const cases = {
    '<style>a</</style>': '<style>{`a</`}</style>',
    '<style>a</*b</style>': '<style>{`a</*b`}</style>',
    '<script>x</ a</script>': '<script>{`x</ a`}</script>',
    '<script>if (a </b) x()</script>': '<script>{`if (a </b) x()`}</script>',
    '<style>\\</`</style>': '<style>{`\\\\</\\``}</style>'
  }
  for (const [html, expected] of Object.entries(cases)) {
    assert.equal(htmlToJsx(html), expected, html)
    const { failed } = await safe(html)
    assert.equal(failed, undefined, `${html} does not compile: ${failed}`)
  }
})

test('JSX: a tag whose name only starts with style or script is a normal tag', () => {
  assert.equal(htmlToJsx('<style-x>a</style-x><style>b</style>'), '<>\n  <style-x>a</style-x><style>{`b`}</style>\n</>')
  assert.equal(htmlToJsx('<script:x>a</script:x>'), '<script:x>a</script:x>')
})

test('REQ-012: U+2028 and U+2029 in a style value are written as escapes, for toolchains older than ES2019', () => {
  const out = htmlToJsx('<div style="x: a\u2028b\u2029c">x</div>')
  assert.equal(out, "<div style={{ x: 'a\\u2028b\\u2029c' }}>x</div>")
  assert.ok(!/[\u2028\u2029]/.test(out))
})

test('REQ-014: the raw text of <style> and <script> is one template literal with the same text', () => {
  const literalOf = (html) => /\{(`[\s\S]*`)\}/.exec(htmlToJsx(html))[1]
  const evaluate = (literal) => {
    const calls = []
    const text = new Function('pwn', `return ${literal}`)((...args) => calls.push(args))
    assert.deepEqual(calls, [], literal)
    return text
  }
  const cases = [
    '.a{color:red}${pwn(2)}',
    'q::before{content:"\\201C"}',
    '\\${pwn(3)}',
    '\\\\${pwn(4)}',
    'a\\',
    'x`+pwn(5)+`y',
    '\\`${pwn(6)}`',
    '$${pwn(7)} $ {pwn(8)} \\u{41} \\x41 \\0 \\n',
    'line 1\n\tline 2 \\\n'
  ]
  for (const tag of ['style', 'script']) {
    for (const text of cases) assert.equal(evaluate(literalOf(`<${tag}>${text}</${tag}>`)), text, `${tag}: ${text}`)
  }
})

test('REQ-014: <style.x> and a <style> opening tag with a hostile attribute stay safe', async () => {
  for (const html of ['<style.x>.a{}</style>', '<style a="{...pwn()}>.a{}</style>', '<script {...pwn()}>a</script>', '<style\n>x</style\n>']) {
    await safe(html)
  }
  assert.equal(htmlToJsx('<style {...pwn()}>.a{}</style>'), "<style>{`.a{}`}</style>")
})

test('REQ-027: a tag name with a dot is dropped and its content kept', () => {
  const out = htmlToJsx('<window.alert>x</window.alert>')
  assert.ok(!out.includes('window.alert') && out.includes('x'), out)
  assert.equal(htmlToJsx('<p><window.alert><b>y</b></window.alert></p>'), '<p><b>y</b></p>')
  assert.equal(htmlToJsx('<p><a.b c="1"/>t<x:y:z>u</x:y:z></p>'), '<p>tu</p>')
  assert.equal(htmlToJsx('<a.b>1</a.b><i>2</i>'), '<>\n  1<i>2</i>\n</>')
})

// Every position of the output that carries input: names, values, styles, handlers, raw text, comments, text.
const HOSTILE = [
  '<path d="M0 0" {...pwn()}/>',
  '<div {...pwn(1)} class=a>x</div>',
  '<div {...{get a(){pwn(2)}}}>x</div>',
  '<div a.b="1" c(d)="2" [x]="3" @click="pwn(3)" :v="4" #r="5">x</div>',
  '<div ${pwn(4)}="1">x</div>',
  '<div a="1"{...pwn(5)}>x</div>',
  '<div {...pwn(6) >x</div>',
  `<div title='"}{pwn(7)}'>x</div>`,
  '<div title="{pwn(8)}">x</div>',
  '<div title="a\nb{pwn(9)}">x</div>',
  `<div title='\\"+pwn(10)+\\"'>x</div>`,
  '<div title="&quot;{pwn(11)}&quot; &#125;{pwn(11)}">x</div>',
  '<a href=javascript:pwn(12)>x</a>',
  '<window.alert>x</window.alert>',
  '<this.constructor.constructor>x</this.constructor.constructor>',
  '<a:b:c>x</a:b:c>',
  '<a.b/>',
  '<window.alert b="1"/>text',
  '<style.x>.a{}</style>',
  `<div style="a(){},[pwn('k')](){},b: red">x</div>`,
  '<div style="color: red; }}, pwn(13): {{">x</div>',
  `<div style="x: y'+pwn(14)+'">x</div>`,
  '<div style="x: y\\">x</div>',
  `<div style="a: b\nc: d'\n+pwn(15)+'">x</div>`,
  `<div style="background: url('\\')">x</div>`,
  '<div style="__proto__: x; constructor: y; [a]: 1; 1a: 2; a b: c">x</div>',
  '<div style="x: ${pwn(16)}">x</div>',
  '<div style="x: y\u2028z\u2029">x</div>',
  '<div style="x: 1; x: 2; -: 3; --: 4; --a b: 5">x</div>',
  '<a onclick="}} data-x={pwn(1)} y={() => {">x</a>',
  `<a onclick="go('">') ; pwn(18) ; ('<b style="a:b"></b></a>`,
  `<a onclick="go('">'}) ; pwn(18) ; ({'<b onclick="x('">y</b>`,
  '<a onclick="a`b">x</a>',
  '<a onclick="x//">x</a>',
  '<a onclick="x\nfoo">x</a>',
  '<a onclick="<!--">x</a>',
  `<a onclick='go("'>x</a>`,
  '<a onmouseover="y(\\">x</a>',
  '<a on-click="pwn(19)">x</a>',
  '<a onclick="/*">*/ pwn(19) /*</a>',
  '<style>.a{color:red}${pwn(2)}</style>',
  '<script>`${pwn(20)}`</script>',
  '<style>a\\</style>',
  '<style>\\${pwn(21)}</style>',
  '<script>`${pwn(22)}</script>',
  '<style\n>x</style\n>',
  '<!-- */ pwn(23) /* -->',
  '<!--*/}pwn(24){/*-->',
  '<!-- **/ -->',
  '<!---->',
  '<![CDATA[ }{pwn(25)}{ ]]>',
  '<p>{pwn(26)} }{ {{ }}</p>',
  '<?xml {pwn(27)} ?>',
  '<!DOCTYPE html {pwn(28)}>',
  '<p>a</p>{pwn(29)}',
  '<p>1 < 2 && 3 > 2 <3 </p>',
  '<p>\u2028${pwn(30)}\u2029</p>',
  '<Function>x</Function><Object>y</Object><eval>z</eval>',
  '</div></div>{pwn(31)}<div>',
  // Text outside every element, with and without a dropped tag around it.
  '<window.alert>pwn(1)</window.alert>',
  '<window.alert>pwn(document.cookie)</window.alert>',
  'pwn(1)',
  'x = pwn(1)',
  'style=<!-- /*/ -->',
  'style=<!-- /* -->',
  'onclick=pwn(1) <b>',
  '<',
  '>',
  'a < b > pwn(1)',
  '</a>pwn(1)',
  '<a>x</a></a>pwn(1)',
  '<p>a</p>pwn(2)<p>b</p>',
  '<div',
  '<div pwn(1)',
  '<a href="x',
  '<!-- c -->pwn(1)',
  '<![CDATA[x]]>pwn(1)',
  '<?x pwn(1) ?>pwn(1)',
  '<br>pwn(1)',
  '<br/>pwn(1)<br>',
  '<!DOCTYPE html>pwn(1)',
  // Round 3: a root comment, a stray closing tag and an unclosed tag are read by JavaScript as comparisons and regexes.
  '<!--x--><window>pwn(1)',
  '<br></a><i title="/,pwn(1),/"></i><br>',
  '<img src=a></p><!--pwn(1)--><b a=/><br>',
  '<!-- c --><a>pwn(1)',
  '<!---->\n<b>pwn(document.cookie)',
  '<!--x--><window>alert(1)',
  '<ul><li>a<li>b</ul>pwn(1)',
  '<a><b></a>pwn(1)</b>',
  '<p><!-- */ pwn(23) /* --></p>',
  '<p><!--*/}pwn(24){/*--></p>',
  '<p>x<!-- /*/ pwn(33) --></p>',
  '<style>a</</style>',
  '<script>x</ a</script>pwn(1)'
]

test('REQ-011..014, 027: hostile HTML never calls pwn or writes a global once compiled and rendered', async () => {
  assert.ok(HOSTILE.length >= 30)
  for (const html of HOSTILE) {
    await safe(html)
    await safe(html, { component: 'C' })
  }
  // The component name is code too.
  const { jsx } = await safe('<p>x</p>', { component: 'A(){}; pwn(32); function B' })
  assert.match(jsx, /^export default function [\w$]+\(\) \{/)
})

test('REQ-011..014: random hostile mixtures, text-only inputs and malformed tags never call pwn or throw', async () => {
  const parts = ['<a', '<b', '</a>', '</b>', '>', ' ', '"', "'", '`', '${', 'pwn(1)', '{', '}', '}}', '{{', '=', '/', '\\', '\n', '\r', ' onclick=', ' style=', 'style=', ' x:', 'y;', '(', ')', ';', '<!--', '-->', '<style>', '</style>', '<script>', '</script>', '*/', '/*', '...', '.', ':', '<a.b>', '</a.b>', ' on-click=', '[', ']', 'pwn(2)', '<', '</', '<br>', '<br/>', '<!DOCTYPE x>', '<![CDATA[', ']]>', '<?x', '?>', 'x = ', 'pwn', '\u2028', '<!---->', '<p>', '</p>', '<window.alert>', '</window.alert>', '<x:y>', 'a/*', '*/b']
  let seed = 20261103
  const next = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % n
  }
  let compiled = 0
  for (let i = 0; i < 1500; i++) {
    let html = ''
    // A third of the inputs are one to four parts: bare text and cut-off tags.
    for (let n = i % 3 === 0 ? 1 + next(4) : 4 + next(26); n > 0; n--) html += parts[next(parts.length)]
    // htmlToJsx itself must not throw, whatever the input.
    const result = await safe(html, i % 2 ? { component: 'C' } : undefined)
    if (!result.failed) compiled++
  }
  console.log(`random JSX oracle: 1500 cases, ${1500 - compiled} do not compile or stop at run time`)
  assert.ok(compiled > 300, `only ${compiled} of 1500 compiled`)
})

test('JSX: structured malformed markup (stray and unclosed tags, comments at every depth) is always one element or fragment', async () => {
  const names = ['a', 'b', 'p', 'br', 'img', 'ul', 'li', 'window', 'document', 'self', 'alert', 'fetch', 'pwn', 'Function', 'style', 'script', 'x.y', 'svg:rect']
  const attributes = ['', '', '', ' title="/,pwn(1),/"', ' a=/', ' b="<"', " c='>'", ' d', ' onclick="pwn(1)"', ' style="x:y"', ' {...pwn()}', ' x=">"', ' e=/>', ' f="a/b" g=\'/,pwn(2),/\'']
  const texts = ['pwn(1)', 'alert(1)', 'x', ' ', '{', '}', '<', '>', 'a/b/', '/,pwn(1),/', 'document.cookie', '\n', '${pwn(1)}', '`', 'fetch(1)']
  const comments = ['<!---->', '<!--c-->', '<!--pwn(1)-->', '<!-- */ pwn(1) /* -->', '<!--/*-->']
  let seed = 4112026
  const next = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % n
  }
  const pick = (list) => list[next(list.length)]
  const before = { ...unusable }
  let cases = 0
  for (let i = 0; i < 3000; i++) {
    let html = ''
    for (let n = 1 + next(9); n > 0; n--) {
      const kind = next(8)
      const name = pick(names)
      if (kind < 2) html += `<${name}${pick(attributes)}>`
      else if (kind === 2) html += `<${name}${pick(attributes)}/>`
      else if (kind < 5) html += `</${name}>`
      else if (kind === 5) html += pick(comments)
      else html += pick(texts)
    }
    await safe(html)
    await safe(html, { component: 'C' })
    cases += 2
  }
  const compile = unusable.compile - before.compile
  const run = unusable.run - before.run
  console.log(`structured JSX oracle: ${cases} cases, ${compile} do not compile, ${run} stop at run time`)
  assert.ok(compile < cases * 0.25, `${compile} of ${cases} do not compile`)
})

test('JSX: stray closing tags are dropped in linear time, however many tags are open', () => {
  for (const [open, stray, close] of [['<a>', '</b>', '</a>'], ['<div>', '</x>', '</div>']]) {
    const html = open.repeat(20000) + stray.repeat(20000)
    const start = performance.now()
    const out = htmlToJsx(html)
    const ms = performance.now() - start
    assert.ok(ms < 2000, `htmlToJsx() took ${Math.round(ms)} ms on ${html.length} characters`)
    assert.equal(out.split(close).length - 1, 20000)
    assert.ok(!out.includes(stray))
    assert.ok(out.startsWith(open.repeat(20000)))
  }
  // A closing tag that does match still closes what was opened inside it, and only that.
  assert.equal(htmlToJsx('<a>'.repeat(3) + '</b></a>x'), '<a><a><a></a>x</a></a>')
  assert.equal(htmlToJsx('<A><b><i>x</a>y'), '<>\n  <A><b><i>x</i></b></A>y\n</>')
  assert.equal(htmlToJsx('<a>x</A>y'), '<>\n  <a>x</a>y\n</>')
})

test('JSX: an input that reduces to nothing is an empty fragment, not an empty return', async () => {
  for (const html of ['', '   ', '</a>', '<a.b></a.b>', '<!DOCTYPE html>', '<!DOCTYPE html></x>']) {
    assert.equal(htmlToJsx(html), '<></>', JSON.stringify(html))
    assert.equal(htmlToJsx(html, { component: 'C' }), 'export default function C() {\n  return (\n    <></>\n  )\n}', JSON.stringify(html))
    const { failed, marker } = await render(htmlToJsx(html, { component: 'C' }))
    assert.equal(failed, undefined)
    assert.ok(marker)
  }
})

test('JSX: an attribute named like an Object.prototype member is an ordinary attribute', async () => {
  const out = htmlToJsx('<div constructor="x" __proto__ toString="y" hasOwnProperty valueOf="z">a</div>')
  assert.ok(!out.includes('native code') && !out.includes('[object'), out)
  assert.equal(out, '<div constructor="x" __proto__ toString="y" hasOwnProperty valueOf="z">a</div>')
  const { failed } = await render(out)
  assert.equal(failed, undefined)
})

test('JSX: ordinary markup still compiles and renders as before', async () => {
  const ordinary = [
    '<div class="card" style="padding: 8px; font-family: A,\n    B"><img src="a.png" alt=""><br></div>',
    '<svg viewBox="0 0 24 24" stroke-width="2"><path fill-rule="evenodd" d="M0 0h24v24H0z"/><g xlink:href="#a"/></svg>',
    '<ul><li>a</li><li>b &amp; c &lt; d</li></ul><p>2 &gt; 1</p>',
    '<button class="btn" onclick="save(1); close()" onmouseover="hover(\'a\')">Go</button>',
    '<input type="text" value="it\'s" disabled><label for="x">L</label>',
    '<style>.a > .b { content: "\\201C"; background: url("a.png") }</style><script>if (a && b) { go(`x${y}`) }</script>',
    '<p><!-- note --><b data-id="1" aria-label="x">{name}</b></p>',
    '<my-element some-attr="1">x</my-element><svg:rect/>'
  ]
  for (const html of ordinary) {
    const result = await safe(html)
    assert.equal(result.failed, undefined, `${html} => ${result.jsx}: ${result.failed}`)
  }
  const { tree } = await render(htmlToJsx('<div class="a" style="color: red; z-index: 2" onclick="go()">x</div>'))
  assert.equal(tree.props.className, 'a')
  assert.equal(JSON.stringify(tree.props.style), '{"color":"red","zIndex":2}')
  assert.equal(typeof tree.props.onClick, 'function')
  assert.deepEqual(elements(tree), ['div'])
})

test('REQ-015: a data URI and a name cannot leave the quotes, brackets or parentheses of a snippet', () => {
  const uri = 'data:image/svg+xml,<svg/><!--" onerror="alert(1)" x="-->'
  const [, css, html, markdown] = snippets(uri, { name: 'a" onload="x' })
  assert.ok(!html[1].includes('" onerror=') && !html[1].includes('" onload='), html[1])
  for (const needle of ['%22', '%3C', '%3E']) assert.ok(html[1].includes(needle), needle)
  assert.equal(snippets('data:image/png;base64,AAAA', { name: 'logo', width: 16, height: 16 })[2][1], '<img src="data:image/png;base64,AAAA" alt="logo" width="16" height="16" />')
  assert.deepEqual(snippets('data:image/png;base64,AAAA', { name: 'logo' }).map(([, value]) => value), [
    'data:image/png;base64,AAAA', 'background-image: url("data:image/png;base64,AAAA");', '<img src="data:image/png;base64,AAAA" alt="logo" />', '![logo](data:image/png;base64,AAAA)', 'AAAA'
  ])
  assert.ok(css[1].startsWith('background-image: url("') && css[1].endsWith('");') && !/"\)|\)"/.test(css[1].slice(23, -3)), css[1])
  assert.ok(/^!\[[^\]]*\]\([^()\s<>"']*\)$/.test(markdown[1]), markdown[1])
})

test('REQ-015: width and height are whole numbers, or left out', () => {
  const html = (size) => snippets('data:image/png;base64,AAAA', { name: 'a', ...size })[2][1]
  assert.ok(!html({ width: '1" onerror="x', height: 2 }).includes('onerror'))
  assert.ok(!html({ width: 1, height: '2" x="' }).includes('x='))
  for (const size of [{ width: 0, height: 2 }, { width: 10.5, height: 2 }, { width: -1, height: 2 }, { width: NaN, height: 2 }, { width: 3 }, {}]) {
    assert.equal(html(size), '<img src="data:image/png;base64,AAAA" alt="a" />', JSON.stringify(size))
  }
  assert.ok(html({ width: 3, height: 4 }).endsWith(' width="3" height="4" />'))
})

test('REQ-015: a name with line breaks stays on one line, so the Markdown is still one image', () => {
  for (const name of ['a\n\nb', 'a\r\n\r\nb', 'a\u2028b', 'a\tb']) {
    const [, , html, markdown] = snippets('data:image/png;base64,AAAA', { name })
    assert.ok(!/[\n\r\u2028\u2029\t]/.test(markdown[1]) && !/[\n\r\u2028\u2029\t]/.test(html[1]), JSON.stringify(name))
    assert.match(markdown[1], /^!\[a +b\]\(data:image\/png;base64,AAAA\)$/, JSON.stringify(name))
  }
})

test('REQ-015: every snippet keeps hostile data in its own slot', () => {
  const names = ['a" onload="x', '<b>', 'a]b[c', 'a&amp;b', 'a](javascript:alert(1))', 'x\\', 'a\nb', "it's", 'a`b', '']
  const uris = [
    'data:image/svg+xml,<svg/>")}</style><script>alert(1)</script>',
    "data:image/svg+xml,a'b\"c(d)e<f>g\\h i\nj\tk",
    'data:image/svg+xml,%3Csvg%3E',
    'data:image/png;base64,AAAA BBBB\nCCCC'
  ]
  for (const uri of uris) {
    for (const name of names) {
      const [, css, html, markdown] = snippets(uri, { name, width: 1, height: 2 })
      const url = /^background-image: url\("([^"]*)"\);$/.exec(css[1])
      assert.ok(url && !/[\s()\\'<>]/.test(url[1]), css[1])
      const attrs = /^<img src="([^"]*)" alt="([^"]*)" width="1" height="2" \/>$/.exec(html[1])
      assert.ok(attrs && !/[<>\s]/.test(attrs[1]) && !/[<>&]/.test(attrs[2]), html[1])
      const md = /^!\[([^\][\\`<>&"]*)\]\(([^()\s<>"'\\]*)\)$/.exec(markdown[1])
      assert.ok(md, markdown[1])
      if (!uri.includes('%')) assert.equal(decodeURIComponent(url[1]), uri)
    }
  }
})

test('REQ-016: SQL IN can double backslashes for MySQL, and by default only doubles quotes', () => {
  const input = 'bob\\\n) OR 1=1 #'
  assert.equal(transform(input, 'sqlIn', { mysql: true }), "('bob\\\\', ') OR 1=1 #')")
  assert.equal(transform(input, 'sqlIn'), "('bob\\', ') OR 1=1 #')")
  assert.equal(transform(input, 'sqlIn', { mysql: false }), "('bob\\', ') OR 1=1 #')")
  assert.equal(transform("O'Brien\\", 'sqlIn', { mysql: true }), "('O''Brien\\\\')")
  assert.equal(transform('a\\\\b', 'sqlIn', { mysql: true }), "('a\\\\\\\\b')")
  assert.equal(transform("O'Brien\nAnn", 'sqlIn'), "('O''Brien', 'Ann')")
})

test('REQ-016: only plain decimal numbers are written without quotes', () => {
  for (const value of ['0x1F', '0X1f', '1e5', '1E+5', '1 OR 1=1', '1;', '1; DROP TABLE t', '--', '--1', '1--', '１２３', '٣', '1_000', '.5', '5.', '+1', '-', '1,5', '00', '01', '-01', '1.2.3', 'Infinity', 'NaN', '1\u200b', '1/**/', '1)', '(1', '1\\', '0b1', '1n', '1.e3']) {
    assert.equal(transform(`${value}\n2`, 'sqlIn'), `('${value}', '2')`, JSON.stringify(value))
    assert.equal(transform(value, 'sqlIn'), `('${value}')`, JSON.stringify(value))
  }
  for (const value of ['0', '7', '-5', '3.14', '-0.5', '100', '10.0']) assert.equal(transform(`${value}\n 2 `, 'sqlIn'), `(${value}, 2)`)
})

const openTransform = async (frame) => {
  await frame.locator('#search').fill('Text Transform')
  await frame.locator('.tool-item[data-tool="transform"]').click()
  const view = frame.locator('[data-view="transform"]')
  await view.waitFor()
  return view
}

test('REQ-016: the MySQL checkbox shows only for Lines → SQL IN', async () => {
  const { page, frame, errors } = await openPanel(browser)
  const view = await openTransform(frame)
  const box = view.getByLabel('Escape backslashes (MySQL, MariaDB)')
  assert.equal(await box.count(), 1)
  assert.equal(await box.isVisible(), false)
  await view.locator('button[data-value="sqlIn"]').click()
  assert.equal(await box.isVisible(), true)
  for (const id of ['wrap', 'toList', 'jsonArray', 'slug']) {
    await view.locator(`button[data-value="${id}"]`).click()
    assert.equal(await box.isVisible(), false, id)
  }
  assert.deepEqual(errors, [])
  await page.close()
})

test('REQ-017: with the box off a backslash brings a MySQL hint; turning it on removes the hint and doubles the backslash', async () => {
  const { page, frame, errors } = await openPanel(browser)
  const view = await openTransform(frame)
  await view.locator('button[data-value="sqlIn"]').click()
  await view.locator('textarea').fill('x')
  assert.doesNotMatch(await view.locator('.hint').textContent(), /MySQL/)
  await view.locator('textarea').fill('bob\\')
  assert.match(await view.locator('.hint').textContent(), /MySQL/)
  assert.equal(await view.locator('.out').textContent(), "('bob\\')")
  await view.getByLabel('Escape backslashes (MySQL, MariaDB)').check()
  assert.doesNotMatch(await view.locator('.hint').textContent(), /MySQL/)
  assert.equal(await view.locator('.out').textContent(), "('bob\\\\')")
  await view.getByLabel('Escape backslashes (MySQL, MariaDB)').uncheck()
  assert.match(await view.locator('.hint').textContent(), /MySQL/)
  // Another transform has no such hint.
  await view.locator('button[data-value="slug"]').click()
  assert.doesNotMatch(await view.locator('.hint').textContent(), /MySQL/)
  assert.deepEqual(errors, [])
  await page.close()
})

test('REQ-013: the HTML to JSX view says that unsafe event handlers are dropped', async () => {
  const { page, frame, errors } = await openPanel(browser)
  await frame.locator('#search').fill('HTML to JSX')
  await frame.locator('.tool-item[data-tool="jsx"]').click()
  const view = frame.locator('[data-view="jsx"]')
  await view.waitFor()
  assert.match(await view.locator('.hint').textContent(), /unsafe.*handler.*dropped|handler.*unsafe.*dropped/i)
  await view.locator('textarea').fill('<a onclick="}} y={() => {" onfocus="go()">x</a>')
  assert.match(await view.locator('.hint').textContent(), /dropped/)
  const out = await view.locator('.out').textContent()
  assert.equal(out, '<a onFocus={() => { go() }}>x</a>')
  assert.deepEqual(errors, [])
  await page.close()
})

test('REQ-014: the HTML to JSX view shows the new result for an input that used to throw, never the old one', async () => {
  const { page, frame, errors } = await openPanel(browser)
  await frame.locator('#search').fill('HTML to JSX')
  await frame.locator('.tool-item[data-tool="jsx"]').click()
  const view = frame.locator('[data-view="jsx"]')
  await view.waitFor()
  await view.locator('textarea').fill('<p>old</p>')
  assert.equal(await view.locator('.out').textContent(), '<p>old</p>')
  for (const [html, expected] of [['<style>a</</style>', '<style>{`a</`}</style>'], ['pwn(1)', '<>\n  pwn(1)\n</>']]) {
    await view.locator('textarea').fill(html)
    assert.equal(await view.locator('.out').textContent(), expected)
  }
  assert.deepEqual(errors, [])
  await page.close()
})
