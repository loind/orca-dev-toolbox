import { parseSshKeys } from '../tools/sshkey.js'
import { errorText, field, h, hint, rows, set, textarea } from '../ui.js'

export default {
  id: 'sshkey',
  title: 'SSH Key',
  group: 'Inspect',
  icon: 'fingerprint',
  color: '#64748b',
  description: 'Type, size and fingerprints of SSH public keys',
  keywords: ['ssh', 'key', 'public key', 'pub', 'fingerprint', 'authorized_keys', 'ed25519', 'rsa', 'ecdsa', 'github', 'deploy key'],
  create() {
    const source = textarea({ rows: 5, placeholder: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA… you@laptop\n\nA whole authorized_keys file works too.' })
    const result = h('div', { class: 'result' })
    function update() {
      if (!source.value.trim()) return set(result, hint('Compare the SHA256 fingerprint with the one GitHub or ssh shows. Paste public keys only (.pub).'))
      try {
        const { keys, errors } = parseSshKeys(source.value)
        set(result,
          keys.map((key, i) => h('div', { class: 'stack' },
            keys.length > 1 ? h('p', { class: 'subhead' }, `Key ${i + 1}${key.comment ? ` · ${key.comment}` : ''}`) : null,
            rows([
              ['Type', key.label, key.weak ? { text: 'weak', kind: 'bad' } : null],
              key.bits ? ['Size', `${key.bits} bits`] : null,
              ['SHA256', key.sha256],
              ['MD5', key.md5],
              key.comment ? ['Comment', key.comment] : null,
              key.options ? ['Options', key.options] : null
            ].filter(Boolean)))),
          errors.map((message) => errorText(message)),
          keys.some((key) => key.weak) ? hint('RSA keys under 2048 bits and DSA keys are refused by current OpenSSH. Prefer Ed25519.') : null)
      } catch (error) {
        set(result, errorText(error.message))
      }
    }
    source.addEventListener('input', update)
    update()
    return {
      node: h('div', {}, field('Public key', source), result),
      focus: source,
      fill(value) {
        source.value = value
        update()
      }
    }
  }
}
