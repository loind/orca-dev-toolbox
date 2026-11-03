// XML pretty-printing and minifying, with a well-formedness check: SVG, plists, Maven POMs,
// Android layouts, RSS, SOAP.

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^>[]|\[[^\]]*\])*>|<\/?[A-Za-z_:][\w:.-]*(?:\s+(?:"[^"]*"|'[^']*'|[^'">\s/])+)*\s*\/?>|[^<]+|</g

function lineAt(text, offset) {
  return text.slice(0, offset).split('\n').length
}

/** Tokens: { type: 'open'|'close'|'self'|'text'|'comment'|'cdata'|'pi'|'doctype', text, name } */
export function tokenizeXml(text) {
  const tokens = []
  const stack = []
  let match
  TOKEN.lastIndex = 0
  while ((match = TOKEN.exec(text))) {
    const raw = match[0]
    const at = match.index
    let token
    if (raw === '<') throw new Error(`Line ${lineAt(text, at)}: a “<” that does not start a tag; write &lt; in text.`)
    if (raw.startsWith('<!--')) token = { type: 'comment', text: raw }
    else if (raw.startsWith('<![CDATA[')) token = { type: 'cdata', text: raw }
    else if (raw.startsWith('<?')) token = { type: 'pi', text: raw }
    else if (/^<!DOCTYPE/i.test(raw)) token = { type: 'doctype', text: raw }
    else if (raw.startsWith('</')) {
      const name = raw.slice(2, -1).trim()
      const open = stack.pop()
      if (open === undefined) throw new Error(`Line ${lineAt(text, at)}: </${name}> closes nothing.`)
      if (open !== name) throw new Error(`Line ${lineAt(text, at)}: </${name}> where </${open}> was expected.`)
      token = { type: 'close', text: raw, name }
    } else if (raw.startsWith('<')) {
      const name = /^<([^\s/>]+)/.exec(raw)[1]
      const self = raw.endsWith('/>')
      if (!self) stack.push(name)
      token = { type: self ? 'self' : 'open', text: raw.replace(/\s+/g, ' ').replace(/\s+(\/?)>$/, '$1>').replace(/ \/>$/, ' />'), name }
    } else token = { type: 'text', text: raw }
    tokens.push(token)
  }
  if (stack.length) throw new Error(`<${stack[stack.length - 1]}> is never closed.`)
  return tokens
}

export function formatXml(text, { indent = 2 } = {}) {
  const tokens = tokenizeXml(text.trim()).filter((t) => t.type !== 'text' || t.text.trim())
  const pad = typeof indent === 'string' ? indent : ' '.repeat(indent)
  const out = []
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    // <a>short text</a> stays on one line.
    if (token.type === 'open' && tokens[i + 1]?.type === 'text' && tokens[i + 2]?.type === 'close' && !tokens[i + 1].text.includes('\n')) {
      out.push(pad.repeat(depth) + token.text + tokens[i + 1].text.trim() + tokens[i + 2].text)
      i += 2
      continue
    }
    if (token.type === 'open' && tokens[i + 1]?.type === 'close') {
      out.push(pad.repeat(depth) + token.text + tokens[i + 1].text)
      i += 1
      continue
    }
    if (token.type === 'close') depth--
    const body = token.type === 'text' ? token.text.trim().replace(/\s*\n\s*/g, `\n${pad.repeat(depth)}`) : token.text
    out.push(pad.repeat(depth) + body)
    if (token.type === 'open') depth++
  }
  return out.join('\n')
}

export function minifyXml(text, { comments = false } = {}) {
  return tokenizeXml(text.trim())
    .filter((t) => (t.type !== 'text' || t.text.trim()) && (comments || t.type !== 'comment'))
    .map((t) => (t.type === 'text' ? t.text.trim().replace(/\s+/g, ' ') : t.text))
    .join('')
}

export function describeXml(text) {
  const tokens = tokenizeXml(text.trim())
  const root = tokens.find((t) => t.type === 'open' || t.type === 'self')
  return { root: root?.name ?? null, elements: tokens.filter((t) => t.type === 'open' || t.type === 'self').length }
}
