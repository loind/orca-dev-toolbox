// Images as data URIs, and data URIs back to their type and size.

/** "data:image/png;base64,iVBOR…" → { mime, base64, bytes } or null when it is not a data URI. */
export function parseDataUri(text) {
  const match = /^data:([\w.+-]+\/[\w.+-]+)?((?:;[\w-]+=[^;,]*)*)(;base64)?,([\s\S]*)$/i.exec(text.trim())
  if (!match) return null
  const mime = match[1] ?? 'text/plain'
  const isBase64 = Boolean(match[3])
  const payload = match[4]
  const bytes = isBase64 ? Math.floor((payload.replace(/[\s=]/g, '').length * 3) / 4) : decodeURIComponent(payload).length
  return { mime, isBase64, payload, bytes }
}

/** Snippets for using a data URI in CSS, HTML and Markdown. */
export function snippets(dataUri, { name = 'image', width, height } = {}) {
  // A data URI may be percent-encoded, so quotes, brackets, backslashes and spaces cannot end a url("…"), an
  // attribute or a Markdown link early. A base64 PNG has none of them and stays as it is.
  const uri = dataUri.replace(/["'()<>\\\s]/g, (c) => (c.charCodeAt(0) < 128 ? `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}` : encodeURIComponent(c)))
  // The name sits in an attribute and in […]: no quote, angle bracket, ampersand, bracket, backslash or line break.
  const label = name.replace(/["<>&[\]\\`]/g, '').replace(/\s/g, ' ')
  const size = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? ` width="${width}" height="${height}"` : ''
  return [
    ['Data URI', dataUri],
    ['CSS', `background-image: url("${uri}");`],
    ['HTML', `<img src="${uri}" alt="${label}"${size} />`],
    ['Markdown', `![${label}](${uri})`],
    ['Base64 only', dataUri.slice(dataUri.indexOf(',') + 1)]
  ]
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 ** 2).toFixed(2)} MB`
}

/** Base64 is 4 characters for every 3 bytes. */
export const base64Overhead = (bytes) => Math.ceil(bytes / 3) * 4
