import { decodeResumeToken, toExtendedJson } from '../tools/resumetoken.js'
import { localString } from '../tools/time.js'
import { errorText, field, h, hint, output, rows, set, textarea } from '../ui.js'

const TOKEN_TYPES = { 128: 'event', 0: 'high water mark' }

export default {
  id: 'resumetoken',
  title: 'Resume token',
  group: 'Inspect',
  icon: 'bookmark',
  color: '#13aa52',
  description: 'MongoDB change stream resume token: time, UUID, document key',
  keywords: ['mongo', 'mongodb', 'change stream', 'resume token', 'resumeafter', 'startafter', '_data', 'keystring', 'oplog', 'decode'],
  create() {
    const source = textarea({ class: 'mono', rows: 4, placeholder: '8261… or {"_data": "8261…"}' })
    const result = h('div', { class: 'result' })

    function show() {
      try {
        if (source.value.trim() === '') return set(result, hint('Paste a resume token (the hex in _data) to see its time, collection UUID and document key.'))
        const token = decodeResumeToken(source.value)
        const seconds = new Date(token.timestamp.t * 1000)
        const entries = [
          ['Timestamp', `{ t: ${token.timestamp.t}, i: ${token.timestamp.i} }`],
          ['Time (UTC)', seconds.toISOString()],
          ['Local time', localString(seconds)],
          ['Version', String(token.version)]
        ]
        if (token.tokenType !== undefined) {
          const kind = TOKEN_TYPES[token.tokenType]
          entries.push(['Token type', String(token.tokenType), kind ? { text: kind } : undefined])
        }
        entries.push(['Txn op index', String(token.txnOpIndex)])
        if (token.fromInvalidate !== undefined) entries.push(['From invalidate', String(token.fromInvalidate)])
        if (token.uuid !== undefined) entries.push(['Collection UUID', token.uuid])
        const blocks = []
        for (const name of ['documentKey', 'eventIdentifier']) {
          if (name in token) {
            const block = output(name)
            block.set(toExtendedJson(token[name]))
            blocks.push(block.node)
          }
        }
        set(result, rows(entries), ...blocks)
      } catch (error) {
        set(result, errorText(error.message))
      }
    }
    source.addEventListener('input', show)
    show()
    return {
      node: h('div', {}, field('Resume token', source), result),
      focus: source,
      fill(value) {
        source.value = value
        show()
      }
    }
  }
}
