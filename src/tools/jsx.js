// HTML and SVG markup as JSX for React: attribute names, inline styles, void tags, comments and
// braces, with the markup's own layout kept.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

const RENAMED = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength',
  minlength: 'minLength', colspan: 'colSpan', rowspan: 'rowSpan', cellpadding: 'cellPadding', cellspacing: 'cellSpacing',
  contenteditable: 'contentEditable', crossorigin: 'crossOrigin', autocomplete: 'autoComplete', autofocus: 'autoFocus',
  autoplay: 'autoPlay', enctype: 'encType', srcset: 'srcSet', srcdoc: 'srcDoc', usemap: 'useMap', frameborder: 'frameBorder',
  allowfullscreen: 'allowFullScreen', novalidate: 'noValidate', accesskey: 'accessKey', spellcheck: 'spellCheck',
  'http-equiv': 'httpEquiv', 'accept-charset': 'acceptCharset', datetime: 'dateTime', playsinline: 'playsInline',
  inputmode: 'inputMode', formaction: 'formAction', formmethod: 'formMethod', formnovalidate: 'formNoValidate',
  hreflang: 'hrefLang', referrerpolicy: 'referrerPolicy', marginwidth: 'marginWidth', marginheight: 'marginHeight',
  enterkeyhint: 'enterKeyHint', fetchpriority: 'fetchPriority', charset: 'charSet', 'xlink:href': 'xlinkHref',
  'xml:space': 'xmlSpace', 'xml:lang': 'xmlLang', 'xmlns:xlink': 'xmlnsXlink', viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform',
  patternunits: 'patternUnits', clippathunits: 'clipPathUnits', markerwidth: 'markerWidth', markerheight: 'markerHeight',
  refx: 'refX', refy: 'refY', stddeviation: 'stdDeviation', textlength: 'textLength', lengthadjust: 'lengthAdjust'
}

// Event names whose second word needs a capital: onmouseover → onMouseOver.
const EVENT_WORDS = ['down', 'up', 'over', 'out', 'enter', 'leave', 'move', 'press', 'start', 'end', 'menu', 'click', 'change', 'select', 'load', 'error', 'play', 'through', 'update', 'drop', 'drag', 'cancel', 'iteration', 'resize']

function eventName(name) {
  let rest = name.slice(2)
  let out = rest[0].toUpperCase()
  rest = rest.slice(1)
  while (rest) {
    const word = EVENT_WORDS.find((w) => rest.startsWith(w) && rest.length >= w.length)
    if (word && out.length > 1) {
      out += word[0].toUpperCase() + word.slice(1)
      rest = rest.slice(word.length)
    } else {
      out += rest[0]
      rest = rest.slice(1)
    }
  }
  return `on${out}`
}

const camel = (name) => name.replace(/[-:]([a-z])/g, (_, c) => c.toUpperCase())

// Names that are valid in JSX and cannot carry code. Anything else (spreads, dots, brackets) is dropped.
const TAG_NAME = /^[A-Za-z][\w-]*(?::[A-Za-z_][\w-]*)?$/
const ATTRIBUTE_NAME = /^[A-Za-z_][\w-]*(?::[A-Za-z_][\w-]*)?$/
const CSS_NAME = /^(?:--[\w-]+|-?[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)*)$/
// A handler goes into `() => { … }`. Braces, backticks, slashes (comments, regexes), `<` and line breaks could
// leave it or hide the closing braces; a quote that is never closed would swallow them.
const SAFE_HANDLER = /^[^{}`/<\n\r\u2028\u2029]*$/

function closesItsQuotes(code) {
  let quote = ''
  for (let i = 0; i < code.length; i++) {
    if (quote) {
      if (code[i] === '\\') i++
      else if (code[i] === quote) quote = ''
    } else if (code[i] === "'" || code[i] === '"') quote = code[i]
  }
  return !quote
}

const ESCAPES = { '\\': '\\\\', "'": "\\'", '\n': '\\n', '\r': '\\r', '\u2028': '\\u2028', '\u2029': '\\u2029' }

function attributeName(raw, tag) {
  const name = raw.toLowerCase()
  if (name.startsWith('data-') || name.startsWith('aria-')) return name
  if (Object.hasOwn(RENAMED, name)) return RENAMED[name]
  if (name === 'ondblclick') return 'onDoubleClick'
  if (/^on[a-z]+$/.test(name)) return eventName(name)
  if ((tag === 'input' || tag === 'textarea' || tag === 'select') && name === 'value') return 'defaultValue'
  if (tag === 'input' && name === 'checked') return 'defaultChecked'
  if (name.includes('-') || name.includes(':')) return camel(name)
  return raw.includes('-') ? camel(raw) : raw
}

const UNITLESS = new Set(['zIndex', 'opacity', 'flex', 'flexGrow', 'flexShrink', 'order', 'fontWeight', 'lineHeight', 'zoom', 'gridRow', 'gridColumn', 'tabSize', 'orphans', 'widows'])

/** -webkit-transition → WebkitTransition, -ms-flex → msFlex, font-size → fontSize */
function styleKey(property) {
  let name = property.toLowerCase()
  let capital = false
  if (name.startsWith('-ms-')) name = name.slice(1)
  else if (name.startsWith('-')) {
    name = name.slice(1)
    capital = true
  }
  const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  return capital ? key[0].toUpperCase() + key.slice(1) : key
}

/** "color: red; font-size: 12px" → {{ color: 'red', fontSize: '12px' }} */
export function styleObject(css) {
  const entries = []
  for (const declaration of css.split(/;(?![^(]*\))/)) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const property = declaration.slice(0, colon).trim()
    const value = declaration.slice(colon + 1).trim()
    if (!property || !value || !CSS_NAME.test(property)) continue
    const key = property.startsWith('--') ? `'${property}'` : styleKey(property)
    // Unitless properties take numbers; everything else stays a string, as written.
    const number = /^-?\d+(\.\d+)?$/.test(value) && UNITLESS.has(key) ? value : null
    entries.push(`${key}: ${number ?? `'${value.replace(/[\\'\n\r\u2028\u2029]/g, (c) => ESCAPES[c])}'`}`)
  }
  return `{{ ${entries.join(', ')} }}`
}

const TOKEN = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<(script|style)(?![\w:.-])[^>]*>[\s\S]*?<\/\1\s*>|<\/?[A-Za-z][\w:.-]*(?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|[^<]+|</gi
const ATTRIBUTE = /([^\s"'>\/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g

function convertTag(raw) {
  const closing = raw.startsWith('</')
  const name = /^<\/?([A-Za-z][\w:.-]*)/.exec(raw)[1]
  // A dotted name is a member expression in JSX (<window.alert> calls window.alert), so the tag goes and its content stays.
  if (!TAG_NAME.test(name)) return { text: '', name, dropped: true }
  if (closing) return { text: `</${name}>`, name, closing: true }
  const tag = name.toLowerCase()
  const body = raw.slice(name.length + 1).replace(/\/?>$/, '')
  const attributes = []
  for (const [, rawName, rawValue] of body.matchAll(ATTRIBUTE)) {
    if (!ATTRIBUTE_NAME.test(rawName)) continue
    const jsxName = attributeName(rawName, tag)
    if (rawValue === undefined) {
      attributes.push(jsxName)
      continue
    }
    const value = rawValue.replace(/^["']|["']$/g, '')
    if (jsxName === 'style') attributes.push(`style=${styleObject(value)}`)
    else if (/^on[A-Z]/.test(jsxName)) {
      const code = value.trim().replace(/;$/, '')
      if (SAFE_HANDLER.test(code) && closesItsQuotes(code)) attributes.push(`${jsxName}={() => { ${code} }}`)
    } else attributes.push(`${jsxName}=${value.includes('"') ? `{${JSON.stringify(value)}}` : `"${value}"`}`)
  }
  const selfClosing = raw.endsWith('/>') || VOID.has(tag)
  const attrs = attributes.length ? ` ${attributes.join(' ')}` : ''
  return { text: `<${name}${attrs}${selfClosing ? ' />' : '>'}`, name, selfClosing }
}

/**
 * Converts markup to JSX. The output is balanced whatever the input: a closing tag that matches nothing is dropped,
 * a closing tag first closes the tags opened inside it, and tags still open at the end are closed. Anything at the
 * root but one element (text, a comment, several elements) goes inside a fragment, because bare text or a bare
 * comment in `return ( … )` is JavaScript, and JavaScript reads `<a>` after it as a comparison.
 */
export function htmlToJsx(html, { component = null } = {}) {
  if (component !== null && !/^[A-Za-z_$][\w$]*$/.test(component)) component = 'Component'
  let out = ''
  // The open tags, and how many of each name are open (lower case), so a stray closing tag is dropped without a scan.
  const open = []
  const openCount = new Map()
  let roots = 0
  let bareRoot = false
  const root = (element) => {
    if (open.length) return
    roots++
    if (!element) bareRoot = true
  }
  for (const [raw, rawTag] of html.trim().matchAll(TOKEN)) {
    if (raw === '<') {
      root(false)
      out += "{'<'}"
      continue
    }
    if (/^<!DOCTYPE/i.test(raw)) continue
    if (raw.startsWith('<!--')) {
      root(false)
      out += `{/* ${raw.slice(4, -3).trim().replace(/\*\//g, '* /')} */}`
      continue
    }
    if (rawTag) {
      // The text may hold `</` too, so the closing tag is the last one. `<style/>` is not self-closing in HTML.
      const start = /^<[^>]*>/.exec(raw)[0]
      const close = raw.slice(raw.lastIndexOf('</'))
      const inner = raw.slice(start.length, raw.length - close.length)
      root(true)
      // Backslash first: `\${x}` must not become a real interpolation, and "\201C" must not become an octal escape.
      out += `${convertTag(start).text.replace(/ \/>$/, '>')}{\`${inner.replace(/[\\`]|\$\{/g, (c) => `\\${c}`)}\`}${convertTag(close).text}`
      continue
    }
    if (raw.startsWith('<')) {
      const tag = convertTag(raw)
      if (tag.dropped) continue
      if (tag.closing) {
        const lower = tag.name.toLowerCase()
        if (!openCount.get(lower)) continue
        const index = open.findLastIndex((entry) => entry.lower === lower)
        while (open.length > index) {
          const entry = open.pop()
          openCount.set(entry.lower, openCount.get(entry.lower) - 1)
          out += `</${entry.name}>`
        }
        continue
      }
      root(true)
      out += tag.text
      if (!tag.selfClosing) {
        const lower = tag.name.toLowerCase()
        open.push({ name: tag.name, lower })
        openCount.set(lower, (openCount.get(lower) ?? 0) + 1)
      }
      continue
    }
    // Text: braces would start expressions in JSX.
    if (raw.trim()) root(false)
    out += raw.replace(/[{}]/g, (c) => `{'${c}'}`)
  }
  while (open.length) out += `</${open.pop().name}>`
  let jsx = out.trim() || '<></>'
  if (roots > 1 || bareRoot) jsx = `<>\n${indent(jsx, '  ')}\n</>`
  if (!component) return jsx
  return `export default function ${component}() {\n  return (\n${indent(jsx, '    ')}\n  )\n}`
}

function indent(text, pad) {
  return text.split('\n').map((line) => (line ? pad + line : line)).join('\n')
}
