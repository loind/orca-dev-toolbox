import { base32Decode, base32Encode, otpauthUri, parseOtpauth, totp } from '../tools/totp.js'
import { copyButton, errorText, field, h, hint, input, rows, set } from '../ui.js'

export default {
  id: 'totp',
  title: 'TOTP / 2FA',
  group: 'Generate',
  icon: 'timer',
  color: '#0ea5e9',
  description: 'Live one-time codes from a 2FA secret or otpauth:// URI, for testing sign-in',
  keywords: ['totp', 'otp', '2fa', 'mfa', 'two factor', 'authenticator', 'otpauth', 'hotp', 'google authenticator', 'base32'],
  create() {
    const secret = input({ placeholder: 'JBSWY3DPEHPK3PXP or otpauth://totp/…', class: 'mono', 'aria-label': 'Secret' })
    const digits = h('select', { 'aria-label': 'Digits', onchange: () => update() }, ['6', '8'].map((d) => h('option', { value: d }, `${d} digits`)))
    const period = h('select', { 'aria-label': 'Period', onchange: () => update() }, ['30', '60'].map((p) => h('option', { value: p }, `${p} s`)))
    const algorithm = h('select', { 'aria-label': 'Algorithm', onchange: () => update() }, ['SHA1', 'SHA256', 'SHA512'].map((a) => h('option', { value: a }, a)))
    const result = h('div', { class: 'result' })
    const generate = h('button', { type: 'button', class: 'secondary', onclick: () => {
      secret.value = base32Encode(crypto.getRandomValues(new Uint8Array(20)))
      update()
    } }, 'New secret')
    let timer = null
    let options = null
    function render() {
      if (!options) return
      const { key, label, ...opts } = options
      const now = totp(key, opts)
      const code = h('span', { class: 'otp' }, now.code.replace(/(\d{3})(?=\d)/g, '$1 '))
      set(result,
        h('div', { class: 'otp-box' }, code, copyButton(() => now.code, 'Copy code'),
          h('span', { class: 'otp-time', style: `--left:${now.remaining / opts.period}` }, `${now.remaining}s`)),
        rows([
          ['Next', now.next],
          ['Previous', now.previous],
          label ? ['Account', label] : null,
          ['URI', otpauthUri({ secret: base32Encode(key), digits: opts.digits, period: opts.period, algorithm: opts.algorithm, issuer: label?.split(':')[0] ?? '', account: label?.split(':').slice(1).join(':') || 'user@example.com' })]
        ].filter(Boolean)),
        hint('Servers usually accept the previous and next code too, to allow for clock drift.'))
    }
    function update() {
      clearInterval(timer)
      options = null
      const value = secret.value.trim()
      if (!value) return set(result, hint('Use test secrets only. Anyone with the secret can generate your codes.'))
      try {
        if (value.startsWith('otpauth://')) {
          const uri = parseOtpauth(value)
          digits.value = String(uri.digits)
          period.value = String(uri.period)
          algorithm.value = uri.algorithm
          options = { key: base32Decode(uri.secret), label: uri.label, digits: uri.digits, period: uri.period, algorithm: uri.algorithm }
        } else {
          options = { key: base32Decode(value), digits: Number(digits.value), period: Number(period.value), algorithm: algorithm.value }
        }
        render()
        timer = setInterval(render, 1000)
      } catch (error) {
        set(result, errorText(error.message))
      }
    }
    secret.addEventListener('input', update)
    update()
    return {
      node: h('div', {}, field('Secret (Base32) or otpauth URI', secret), h('div', { class: 'bar' }, digits, period, algorithm, generate), result),
      focus: secret,
      fill(value) {
        secret.value = value
        update()
      }
    }
  }
}
