import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildVietQr, cleanNote, crc16, parseEmvQr } from '../../src/tools/vietqr.js'

test('CRC-16/CCITT-FALSE check value', () => {
  assert.equal(crc16('123456789'), '29B1')
})

test('builds a dynamic VietQR payload and reads it back', () => {
  const payload = buildVietQr({ bin: '970436', account: '0123456789', amount: '150.000', note: 'Thanh toán đơn #A12' })
  assert.equal(payload, '00020101021238540010A00000072701240006970436011001234567890208QRIBFTTA530370454061500005802VN62220818Thanh toan don A126304C28D')
  const read = parseEmvQr(payload)
  assert.equal(read.crcValid, true)
  assert.equal(read.dynamic, true)
  assert.deepEqual(read.vietqr, { bin: '970436', bank: { bin: '970436', name: 'Vietcombank', code: 'VCB' }, account: '0123456789', service: 'account' })
  assert.deepEqual([read.amount, read.currency, read.note], ['150000', 'VND', 'Thanh toan don A12'])
})

test('static codes, cards, bad input and a broken CRC', () => {
  const staticCode = buildVietQr({ bin: '970422', account: '9704 2200 1234 5678', card: true })
  assert.match(staticCode, /^000201010211/)
  assert.equal(parseEmvQr(staticCode).vietqr.service, 'card')
  assert.throws(() => buildVietQr({ bin: '97', account: '1' }), /BIN/)
  assert.throws(() => buildVietQr({ bin: '970436', account: '1', amount: '1.5k' }), /whole number/)
  assert.equal(parseEmvQr(staticCode.slice(0, -1) + (staticCode.endsWith('0') ? '1' : '0')).crcValid, false)
  assert.equal(cleanNote('Đặt cọc: 50% <ngay>'), 'Dat coc 50 ngay')
})
