// cURL commands as fetch, Python requests or HTTPie code.

/** Splits a shell command the way sh would: quotes, escapes and backslash-newline continuations. */
export function shellWords(text) {
  const words = []
  let word = null
  let i = 0
  const src = text.replace(/\\\r?\n/g, ' ')
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      if (word !== null) words.push(word), (word = null)
      i++
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1)
      if (end === -1) throw new Error('A single quote is never closed.')
      word = (word ?? '') + src.slice(i + 1, end)
      i = end + 1
    } else if (c === '$' && src[i + 1] === "'") {
      // ANSI-C quoting: $'line\nbreak'
      let j = i + 2
      let out = ''
      while (j < src.length && src[j] !== "'") {
        if (src[j] === '\\' && j + 1 < src.length) {
          const next = src[j + 1]
          out += { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' }[next] ?? next
          j += 2
        } else out += src[j++]
      }
      word = (word ?? '') + out
      i = j + 1
    } else if (c === '"') {
      let j = i + 1
      let out = ''
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && '"\\$`'.includes(src[j + 1])) {
          out += src[j + 1]
          j += 2
        } else out += src[j++]
      }
      if (j >= src.length) throw new Error('A double quote is never closed.')
      word = (word ?? '') + out
      i = j + 1
    } else if (c === '\\' && i + 1 < src.length) {
      word = (word ?? '') + src[i + 1]
      i += 2
    } else {
      word = (word ?? '') + c
      i++
    }
  }
  if (word !== null) words.push(word)
  return words
}

const VALUE_FLAGS = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode', '--json', '-u', '--user', '-F', '--form', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '--url', '-o', '--output', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '-w', '--write-out', '--retry', '-c', '--cookie-jar', '--cacert', '--cert', '--key', '-E', '--resolve', '--limit-rate', '-T', '--upload-file'])

/** { method, url, headers: [[name, value]], body, form, auth, insecure, followRedirects, ignored } */
export function parseCurl(text) {
  const words = shellWords(text.trim())
  if (words[0] !== 'curl') throw new Error('Paste a command that starts with curl.')
  const request = { method: null, url: null, headers: [], body: null, form: [], auth: null, insecure: false, followRedirects: false, ignored: [], get: false }
  const data = []
  for (let i = 1; i < words.length; i++) {
    let flag = words[i]
    let value
    if (flag.startsWith('--') && flag.includes('=')) [flag, value] = [flag.slice(0, flag.indexOf('=')), flag.slice(flag.indexOf('=') + 1)]
    else if (/^-[A-Za-z]./.test(flag) && VALUE_FLAGS.has(flag.slice(0, 2))) [flag, value] = [flag.slice(0, 2), flag.slice(2)]
    if (VALUE_FLAGS.has(flag) && value === undefined) value = words[++i]
    switch (flag) {
      case '-X': case '--request': request.method = value.toUpperCase(); break
      case '-H': case '--header': {
        const colon = value.indexOf(':')
        if (colon > 0) request.headers.push([value.slice(0, colon).trim(), value.slice(colon + 1).trim()])
        break
      }
      case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-ascii': data.push(value); break
      case '--data-urlencode': {
        const eq = value.indexOf('=')
        data.push(eq === -1 ? encodeURIComponent(value) : `${value.slice(0, eq + 1)}${encodeURIComponent(value.slice(eq + 1))}`)
        break
      }
      case '--json':
        data.push(value)
        if (!request.headers.some(([n]) => n.toLowerCase() === 'content-type')) request.headers.push(['Content-Type', 'application/json'])
        if (!request.headers.some(([n]) => n.toLowerCase() === 'accept')) request.headers.push(['Accept', 'application/json'])
        break
      case '-F': case '--form': {
        const eq = value.indexOf('=')
        request.form.push([value.slice(0, eq), value.slice(eq + 1)])
        break
      }
      case '-u': case '--user': request.auth = value; break
      case '-A': case '--user-agent': request.headers.push(['User-Agent', value]); break
      case '-e': case '--referer': request.headers.push(['Referer', value]); break
      case '-b': case '--cookie': request.headers.push(['Cookie', value]); break
      case '--url': request.url = value; break
      case '-k': case '--insecure': request.insecure = true; break
      case '-L': case '--location': request.followRedirects = true; break
      case '-G': case '--get': request.get = true; break
      case '-I': case '--head': request.method = 'HEAD'; break
      case '--compressed': case '-s': case '--silent': case '-S': case '--show-error': case '-v': case '--verbose': case '-i': case '--include': case '-f': case '--fail': case '-sS': case '-fsSL': case '-sL': case '-fsS': break
      default:
        if (flag.startsWith('-')) {
          if (/^-[a-zA-Z]{2,}$/.test(flag)) {
            for (const letter of flag.slice(1)) {
              if (letter === 'k') request.insecure = true
              else if (letter === 'L') request.followRedirects = true
              else if (letter === 'I') request.method = 'HEAD'
              else if (letter === 'G') request.get = true
            }
          } else request.ignored.push(value === undefined ? flag : `${flag} ${value}`)
        } else if (!request.url) request.url = flag
    }
  }
  if (!request.url) throw new Error('The command has no URL.')
  if (!/^[a-z]+:\/\//i.test(request.url)) request.url = `http://${request.url}`
  if (data.length) {
    if (request.get) {
      request.url += (request.url.includes('?') ? '&' : '?') + data.join('&')
    } else {
      request.body = data.join('&')
      if (!request.headers.some(([n]) => n.toLowerCase() === 'content-type')) request.headers.push(['Content-Type', 'application/x-www-form-urlencoded'])
    }
  }
  if (request.auth) {
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(request.auth.includes(':') ? request.auth : `${request.auth}:`)))
    request.headers.push(['Authorization', `Basic ${encoded}`])
  }
  request.method ??= request.body !== null || request.form.length ? 'POST' : 'GET'
  return request
}

const quote = (text) => JSON.stringify(text)
const pyQuote = (text) => (text.includes("'") && !text.includes('"') ? JSON.stringify(text) : `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`)
const isJson = (request) => request.headers.some(([n, v]) => n.toLowerCase() === 'content-type' && /json/i.test(v))

function jsonBody(request) {
  if (request.body === null || !isJson(request)) return undefined
  try {
    return JSON.parse(request.body)
  } catch {
    return undefined
  }
}

function indent(text, spaces) {
  return text.replace(/\n/g, `\n${' '.repeat(spaces)}`)
}

function toFetch(request) {
  const options = []
  if (request.method !== 'GET') options.push(`method: ${quote(request.method)}`)
  if (request.headers.length) {
    options.push(`headers: {\n${request.headers.map(([n, v]) => `    ${quote(n)}: ${quote(v)}`).join(',\n')}\n  }`)
  }
  const json = jsonBody(request)
  if (json !== undefined) options.push(`body: JSON.stringify(${indent(JSON.stringify(json, null, 2), 2)})`)
  else if (request.body !== null) options.push(`body: ${quote(request.body)}`)
  else if (request.form.length) {
    const lines = ['const form = new FormData()', ...request.form.map(([n, v]) => (v.startsWith('@') ? `form.append(${quote(n)}, /* file */ ${quote(v.slice(1))})` : `form.append(${quote(n)}, ${quote(v)})`)), '']
    options.push('body: form')
    return `${lines.join('\n')}${fetchCall(request, options)}`
  }
  return fetchCall(request, options)
}

function fetchCall(request, options) {
  const call = options.length ? `fetch(${quote(request.url)}, {\n  ${options.join(',\n  ')}\n})` : `fetch(${quote(request.url)})`
  return `const response = await ${call}\nconst data = await response.${/json/i.test(request.headers.find(([n]) => n.toLowerCase() === 'accept')?.[1] ?? '') ? 'json' : 'text'}()`
}

function pyValue(value, depth = 0) {
  if (value === null) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (typeof value === 'string') return pyQuote(value)
  if (typeof value === 'number') return String(value)
  const pad = '    '.repeat(depth + 1)
  const end = '    '.repeat(depth)
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => pad + pyValue(v, depth + 1)).join(',\n')},\n${end}]` : '[]'
  const entries = Object.entries(value)
  return entries.length ? `{\n${entries.map(([k, v]) => `${pad}${pyQuote(k)}: ${pyValue(v, depth + 1)}`).join(',\n')},\n${end}}` : '{}'
}

function toPython(request) {
  const lines = ['import requests', '']
  const args = [pyQuote(request.url)]
  const headers = request.headers.filter(([n]) => !(n.toLowerCase() === 'authorization' && request.auth))
  const json = jsonBody(request)
  const sendHeaders = json !== undefined ? headers.filter(([n]) => n.toLowerCase() !== 'content-type') : headers
  if (sendHeaders.length) {
    lines.push(`headers = ${pyValue(Object.fromEntries(sendHeaders))}`, '')
    args.push('headers=headers')
  }
  if (json !== undefined) {
    lines.push(`payload = ${pyValue(json)}`, '')
    args.push('json=payload')
  } else if (request.body !== null) {
    lines.push(`data = ${pyQuote(request.body)}`, '')
    args.push('data=data')
  } else if (request.form.length) {
    const files = request.form.filter(([, v]) => v.startsWith('@'))
    const fields = request.form.filter(([, v]) => !v.startsWith('@'))
    if (fields.length) lines.push(`data = ${pyValue(Object.fromEntries(fields))}`), args.push('data=data')
    if (files.length) lines.push(`files = {${files.map(([n, v]) => `${pyQuote(n)}: open(${pyQuote(v.slice(1))}, 'rb')`).join(', ')}}`), args.push('files=files')
    lines.push('')
  }
  if (request.auth) {
    const [user, ...rest] = request.auth.split(':')
    args.push(`auth=(${pyQuote(user)}, ${pyQuote(rest.join(':'))})`)
  }
  if (request.insecure) args.push('verify=False')
  const method = request.method.toLowerCase()
  const fn = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method) ? `requests.${method}` : 'requests.request'
  if (fn === 'requests.request') args.unshift(pyQuote(request.method))
  const flat = `response = ${fn}(${args.join(', ')})`
  lines.push(flat.length > 88 ? `response = ${fn}(\n    ${args.join(',\n    ')},\n)` : flat)
  lines.push('response.raise_for_status()')
  return lines.join('\n')
}

function shellQuote(text) {
  return /^(?!=)[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`
}

// HTTPie reads `name:value`, `name=value`, `name:=json`, `name==query`, `name@file` and `name;`, and
// `:@`, `=@`, `:=@`, `==@` read a local file. A backslash before `: ; = @` makes that character plain,
// so the separators in a name and a leading `@` or `=` in a value are escaped and text from the curl
// command stays text. What HTTPie 3.2.4 does with backslashes (checked by running it):
// - In a name, a backslash before `: ; = @` or at the end of the name cannot be written: `\\` stays
//   two backslashes, so `\\:` still ends the name. Such a name is an error here, not a wrong item.
// - In a name of a JSON body, HTTPie also merges two backslashes into one (nested-key syntax).
// - In a value, a backslash before `: ; = @` is dropped by HTTPie (`a\@b` is sent as `a@b`). The
//   value cannot start another item, so this is left as it was.
function itemName(text) {
  if (/\\([:;=@]|$)/.test(text)) throw new Error('HTTPie cannot send a backslash before : ; = or @ in a name.')
  return text.replace(/[:;=@]/g, '\\$&')
}
const itemValue = (text) => text.replace(/^[=@]/, '\\$&')
const item = (name, separator, value) => itemName(name) + separator + itemValue(value)

function toHttpie(request) {
  // HTTPie takes the first word as a method only when it is all letters; any other word is the URL.
  if (!/^[A-Za-z]+$/.test(request.method)) throw new Error('HTTPie only takes letters in a method, like GET or PATCH.')
  const options = ['http']
  if (request.followRedirects) options.push('--follow')
  if (request.insecure) options.push('--verify=no')
  if (request.form.length) options.push('--multipart')
  const json = jsonBody(request)
  const raw = json === undefined && request.body !== null
  const formEncoded = raw && request.headers.some(([n, v]) => n.toLowerCase() === 'content-type' && /x-www-form-urlencoded/i.test(v))
  if (formEncoded) options.push('--form')
  // `--auth -x:y` makes HTTPie read -x:y as an option, so a value that starts with `-` is attached.
  if (request.auth) options.push(request.auth.startsWith('-') ? `--auth=${shellQuote(request.auth)}` : `--auth ${shellQuote(request.auth)}`)
  const items = []
  for (const [n, v] of request.headers) {
    const lower = n.toLowerCase()
    if (lower === 'authorization' && request.auth) continue
    if (lower === 'content-type' && (json !== undefined || formEncoded)) continue
    if (lower === 'accept' && v === 'application/json' && json !== undefined) continue
    items.push(item(n, ':', v))
  }
  let body = null
  let bodyAt = 0
  if (json !== undefined) {
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      for (const [k, v] of Object.entries(json)) items.push(typeof v === 'string' ? item(k, '=', v) : item(k, ':=', JSON.stringify(v)))
    } else {
      body = `--raw=${shellQuote(JSON.stringify(json))}`
      bodyAt = items.length
    }
  } else if (formEncoded) {
    for (const pair of request.body.split('&')) {
      const eq = pair.indexOf('=')
      const [k, v] = (eq === -1 ? [pair, ''] : [pair.slice(0, eq), pair.slice(eq + 1)]).map((s) => decodeURIComponent(s.replace(/\+/g, ' ')))
      items.push(item(k, '=', v))
    }
  } else if (raw) {
    body = `--raw=${shellQuote(request.body)}`
    bodyAt = items.length
  }
  for (const [n, v] of request.form) items.push(v.startsWith('@') ? item(n, '@', v.slice(1)) : item(n, '=', v))
  const words = items.map(shellQuote)
  // An item that starts with `-` would be an HTTPie option (`--output=file` writes a file), so
  // everything after `--` is read as METHOD, URL and items; --raw is an option and goes before it.
  if (items.some((text) => text.startsWith('-'))) return [...options, ...(body ? [body] : []), '--', request.method, shellQuote(request.url), ...words].join(' ')
  if (body) words.splice(bodyAt, 0, body)
  return [...options, request.method, shellQuote(request.url), ...words].join(' ')
}

export const CURL_TARGETS = [['fetch', 'JavaScript fetch', toFetch], ['python', 'Python requests', toPython], ['httpie', 'HTTPie', toHttpie]]

export function convertCurl(text, target = 'fetch') {
  const request = parseCurl(text)
  const [, , convert] = CURL_TARGETS.find(([id]) => id === target)
  return { code: convert(request), request }
}
