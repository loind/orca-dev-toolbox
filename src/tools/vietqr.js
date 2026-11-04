// VietQR: the NAPAS bank-transfer QR built on EMVCo Merchant Presented Mode. Builds a payload for
// an account or card, and reads any EMVCo payload back into its fields.

/** NAPAS bank identification numbers (BIN) of common banks. */
export const BANKS = [
  ['970436', 'Vietcombank', 'VCB'],
  ['970415', 'VietinBank', 'CTG'],
  ['970418', 'BIDV', 'BIDV'],
  ['970405', 'Agribank', 'VBA'],
  ['970407', 'Techcombank', 'TCB'],
  ['970422', 'MB Bank', 'MB'],
  ['970416', 'ACB', 'ACB'],
  ['970432', 'VPBank', 'VPB'],
  ['970423', 'TPBank', 'TPB'],
  ['970403', 'Sacombank', 'STB'],
  ['970437', 'HDBank', 'HDB'],
  ['970441', 'VIB', 'VIB'],
  ['970443', 'SHB', 'SHB'],
  ['970431', 'Eximbank', 'EIB'],
  ['970426', 'MSB', 'MSB'],
  ['970448', 'OCB', 'OCB'],
  ['970440', 'SeABank', 'SEAB'],
  ['970449', 'LPBank', 'LPB'],
  ['970428', 'Nam A Bank', 'NAB'],
  ['970409', 'Bac A Bank', 'BAB'],
  ['970425', 'ABBANK', 'ABB'],
  ['970429', 'SCB', 'SCB'],
  ['970412', 'PVcomBank', 'PVCB'],
  ['970454', 'BVBank', 'BVB'],
  ['970452', 'KienlongBank', 'KLB'],
  ['970419', 'NCB', 'NCB'],
  ['970427', 'VietABank', 'VAB'],
  ['970438', 'BaoViet Bank', 'BVB'],
  ['970430', 'PGBank', 'PGB'],
  ['970400', 'Saigonbank', 'SGB'],
  ['970408', 'GPBank', 'GPB']
]
const BANK_BY_BIN = new Map(BANKS.map(([bin, name, code]) => [bin, { bin, name, code }]))

/** CRC-16/CCITT-FALSE, as EMVCo field 63 requires, as 4 uppercase hex digits. */
export function crc16(text) {
  let crc = 0xffff
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function tlv(id, value) {
  const length = [...value].length
  if (length > 99) throw new Error(`Field ${id} is longer than 99 characters.`)
  return `${id}${String(length).padStart(2, '0')}${value}`
}

/** Strips accents and characters most banking apps refuse in the transfer note. */
export function cleanNote(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9 .,_-]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function buildVietQr({ bin, account, amount = '', note = '', card = false }) {
  if (!/^\d{6}$/.test(bin)) throw new Error('The bank BIN is 6 digits, e.g. 970436 for Vietcombank.')
  const acct = String(account).replace(/\s/g, '')
  if (!/^[0-9A-Za-z]{1,19}$/.test(acct)) throw new Error('The account or card number is 1–19 letters or digits.')
  const sum = String(amount).replace(/[.,\s]/g, '')
  if (sum && !/^\d{1,13}$/.test(sum)) throw new Error('The amount is a whole number of đồng.')
  const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', acct)) + tlv('02', card ? 'QRIBFTTC' : 'QRIBFTTA')
  let payload = tlv('00', '01') + tlv('01', sum ? '12' : '11') + tlv('38', merchant) + tlv('53', '704')
  if (sum) payload += tlv('54', sum)
  payload += tlv('58', 'VN')
  const cleaned = cleanNote(note)
  if (cleaned) payload += tlv('62', tlv('08', cleaned))
  payload += '6304'
  return payload + crc16(payload)
}

function readTlv(text) {
  const out = []
  let i = 0
  while (i < text.length) {
    const id = text.slice(i, i + 2)
    const length = Number(text.slice(i + 2, i + 4))
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(text.slice(i + 2, i + 4)) || i + 4 + length > text.length) throw new Error(`Malformed field at position ${i + 1}.`)
    out.push([id, text.slice(i + 4, i + 4 + length)])
    i += 4 + length
  }
  return out
}

const TOP = { '00': 'Format', '01': 'Initiation', '52': 'Merchant category', '53': 'Currency', '54': 'Amount', '58': 'Country', '59': 'Merchant name', '60': 'City', '62': 'Additional data', '63': 'CRC' }

/** Any EMVCo QR payload: its fields, the CRC check and, for VietQR, the bank, account and note. */
export function parseEmvQr(payload) {
  const text = payload.trim()
  const fields = readTlv(text)
  const crcField = fields.find(([id]) => id === '63')
  const crcValid = crcField ? crc16(text.slice(0, text.length - 4)) === crcField[1].toUpperCase() : null
  const result = { fields: fields.map(([id, value]) => [id, TOP[id] ?? (Number(id) >= 26 && Number(id) <= 51 ? 'Merchant account' : `Field ${id}`), value]), crcValid, dynamic: fields.find(([id]) => id === '01')?.[1] === '12' }
  for (const [id, value] of fields) {
    if (id === '38' && value.includes('A000000727')) {
      const inner = Object.fromEntries(readTlv(value))
      const beneficiary = Object.fromEntries(readTlv(inner['01'] ?? ''))
      const bin = beneficiary['00']
      result.vietqr = { bin, bank: BANK_BY_BIN.get(bin) ?? null, account: beneficiary['01'], service: inner['02'] === 'QRIBFTTC' ? 'card' : 'account' }
    }
    if (id === '54') result.amount = value
    if (id === '53') result.currency = value === '704' ? 'VND' : value
    if (id === '62') {
      const extra = Object.fromEntries(readTlv(value))
      if (extra['08']) result.note = extra['08']
      if (extra['05']) result.reference = extra['05']
    }
    if (id === '59') result.merchant = value
  }
  return result
}

export const bankName = (bin) => BANK_BY_BIN.get(bin)?.name ?? null
