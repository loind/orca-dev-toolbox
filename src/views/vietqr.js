import { BANKS, bankName, buildVietQr, parseEmvQr } from '../tools/vietqr.js'
import { copyButton, errorText, field, h, hint, input, output, rows, segmented, set, textarea } from '../ui.js'
import { qrSvg } from './qr.js'

const money = (digits) => Number(digits).toLocaleString('vi-VN')

export default {
  id: 'vietqr',
  title: 'VietQR',
  group: 'Generate',
  icon: 'bank',
  color: '#dc2626',
  description: 'Bank-transfer QR codes for Vietnamese banks (NAPAS), and reading QR payloads',
  keywords: ['vietqr', 'napas', 'qr', 'bank', 'transfer', 'payment', 'emvco', 'chuyển khoản', 'ngân hàng', 'thanh toán', 'vietnam'],
  create() {
    const bank = h('select', { 'aria-label': 'Bank', onchange: () => update() },
      BANKS.map(([bin, name]) => h('option', { value: bin }, `${name} · ${bin}`)))
    const account = input({ placeholder: '0123456789', class: 'mono', inputmode: 'numeric', 'aria-label': 'Account number' })
    const amount = input({ placeholder: '150000 (optional)', class: 'mono', inputmode: 'numeric', 'aria-label': 'Amount in VND' })
    const note = input({ placeholder: 'Thanh toan don hang 1234', 'aria-label': 'Transfer note' })
    const payload = textarea({ rows: 4, placeholder: '000201010212385400…6304ABCD', class: 'mono' })
    const result = h('div', { class: 'result' })
    const out = output('Payload')
    const mode = segmented([['make', 'Create'], ['read', 'Read payload']], 'make', () => layout(), 'Mode')
    const makeFields = h('div', { class: 'stack' }, field('Bank', bank), field('Account or card number', account), h('div', { class: 'inline' }, field('Amount (VND)', amount), field('Note', note)))
    const readFields = field('QR payload', payload)
    function layout() {
      makeFields.hidden = mode.get() !== 'make'
      readFields.hidden = mode.get() !== 'read'
      update()
    }
    function update() {
      try {
        if (mode.get() === 'read') {
          if (!payload.value.trim()) return set(result, hint('Paste the text a QR scanner reads from a VietQR or other EMVCo payment code.'))
          const qr = parseEmvQr(payload.value)
          return set(result,
            rows([
              ['CRC', qr.crcValid === null ? 'missing' : qr.crcValid ? 'valid' : 'invalid', qr.crcValid ? { text: 'ok', kind: 'ok' } : { text: 'check', kind: 'bad' }],
              qr.vietqr ? ['Bank', `${qr.vietqr.bank?.name ?? 'Unknown bank'} (${qr.vietqr.bin})`] : null,
              qr.vietqr ? [qr.vietqr.service === 'card' ? 'Card' : 'Account', qr.vietqr.account] : null,
              qr.amount ? ['Amount', `${money(qr.amount)} ${qr.currency ?? ''}`.trim()] : null,
              qr.note ? ['Note', qr.note] : null,
              qr.merchant ? ['Merchant', qr.merchant] : null,
              ['Type', qr.dynamic ? 'Dynamic (one payment)' : 'Static (reusable)']
            ].filter(Boolean)),
            h('p', { class: 'subhead' }, 'Fields'),
            rows(qr.fields.map(([id, label, value]) => [`${id} ${label}`, value])))
        }
        if (!account.value.trim()) return set(result, hint('Most Vietnamese banking apps scan this. Accents are removed from the note, as many apps refuse them.'))
        const text = buildVietQr({ bin: bank.value, account: account.value, amount: amount.value, note: note.value })
        const { svg } = qrSvg(text, 'M')
        out.set(text)
        set(result,
          h('div', { class: 'qr-frame' }, h('img', { class: 'qr', alt: `VietQR for ${bankName(bank.value)} ${account.value}`, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` })),
          h('div', { class: 'bar' }, copyButton(() => svg, 'Copy as SVG', 'Copy SVG')),
          amount.value.trim() ? hint(`${money(amount.value.replace(/\D/g, ''))} ₫ to ${bankName(bank.value)} ${account.value.trim()}.`) : hint('No amount: the payer types it in.'),
          out.node,
          hint('Scan it with your own banking app before sharing; it shows the account holder’s name to confirm.'))
      } catch (error) {
        set(result, errorText(error.message))
      }
    }
    for (const node of [account, amount, note, payload]) node.addEventListener('input', update)
    layout()
    return {
      node: h('div', {}, h('div', { class: 'bar' }, mode.node), makeFields, readFields, result),
      focus: account,
      fill(value) {
        payload.value = value
        mode.set('read')
      }
    }
  }
}
