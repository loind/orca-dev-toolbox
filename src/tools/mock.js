// Fake records for fixtures and demos, in English or Vietnamese, as JSON, CSV or SQL. Seeded, so
// the same seed gives the same rows.
import { removeAccents } from './transform.js'

/** mulberry32: small, fast and good enough for test data. */
export function seededRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DATA = {
  en: {
    first: ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen', 'Daniel', 'Emma', 'Matthew', 'Olivia', 'Anthony', 'Sophia', 'Mark', 'Ava', 'Paul', 'Mia'],
    last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Walker', 'Hall', 'Allen', 'Young', 'King'],
    streets: ['Main St', 'Oak Ave', 'Maple Dr', 'Cedar Ln', 'Pine St', 'Elm St', 'Washington Ave', 'Lake Rd', 'Hill St', 'Park Ave', 'Sunset Blvd', 'River Rd'],
    cities: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Seattle', 'Denver', 'Boston', 'Austin', 'Portland', 'San Diego', 'Atlanta'],
    country: 'United States',
    companies: ['Acme Corp', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark Industries', 'Wayne Enterprises', 'Soylent', 'Vandelay Industries', 'Wonka Industries'],
    domains: ['example.com', 'example.org', 'example.net'],
    jobs: ['Software Engineer', 'Product Manager', 'Designer', 'Data Analyst', 'QA Engineer', 'DevOps Engineer', 'Support Specialist', 'Marketing Manager'],
    phone: (r) => `+1 ${digits(r, 3, 2)}-555-${digits(r, 4)}`,
    zip: (r) => digits(r, 5)
  },
  vi: {
    first: ['An', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hà', 'Hải', 'Hiếu', 'Hùng', 'Hương', 'Khánh', 'Lan', 'Linh', 'Long', 'Mai', 'Minh', 'Nam', 'Ngọc', 'Nhung', 'Phong', 'Phương', 'Quân', 'Quỳnh', 'Sơn', 'Tâm', 'Thảo', 'Trang', 'Tuấn', 'Vy', 'Yến'],
    middle: ['Văn', 'Thị', 'Minh', 'Ngọc', 'Thanh', 'Đức', 'Hoàng', 'Quang', 'Thu', 'Gia', 'Anh', 'Bảo'],
    last: ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'],
    streets: ['Lê Lợi', 'Nguyễn Huệ', 'Trần Hưng Đạo', 'Hai Bà Trưng', 'Lý Thường Kiệt', 'Điện Biên Phủ', 'Nguyễn Trãi', 'Phan Chu Trinh', 'Pasteur', 'Võ Văn Tần', 'Lê Duẩn', 'Cách Mạng Tháng Tám'],
    cities: ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ', 'Huế', 'Nha Trang', 'Đà Lạt', 'Vũng Tàu', 'Quy Nhơn', 'Biên Hòa', 'Buôn Ma Thuột'],
    country: 'Việt Nam',
    companies: ['Công ty TNHH Sao Mai', 'Công ty CP Hoàng Long', 'Công ty TNHH Minh Phát', 'Công ty CP Thiên An', 'Công ty TNHH Phú Thịnh', 'Công ty CP Đại Việt', 'Công ty TNHH An Khang', 'Công ty CP Bình Minh'],
    domains: ['example.vn', 'example.com', 'example.com.vn'],
    jobs: ['Lập trình viên', 'Quản lý sản phẩm', 'Thiết kế UI/UX', 'Phân tích dữ liệu', 'Kiểm thử phần mềm', 'Kỹ sư DevOps', 'Chăm sóc khách hàng', 'Kế toán'],
    // Mobile prefixes in use since the 2018 renumbering.
    phone: (r) => `${pick(r, ['032', '033', '034', '035', '036', '037', '038', '039', '070', '076', '077', '078', '079', '081', '082', '083', '084', '085', '086', '088', '089', '090', '091', '093', '094', '096', '097', '098'])}${digits(r, 7)}`,
    zip: (r) => digits(r, 6)
  }
}

const pick = (r, list) => list[Math.floor(r() * list.length)]
const int = (r, min, max) => min + Math.floor(r() * (max - min + 1))
function digits(r, count, firstMin = 0) {
  let out = String(int(r, Math.max(firstMin, count > 1 ? 1 : 0), 9))
  for (let i = 1; i < count; i++) out += String(int(r, 0, 9))
  return out
}
const slug = (text) => removeAccents(text).toLowerCase().replace(/[^a-z0-9]+/g, '')

function person(r, locale) {
  const d = DATA[locale]
  const first = pick(r, d.first)
  const last = pick(r, d.last)
  if (locale === 'vi') {
    const middle = pick(r, d.middle)
    return { first, last, full: `${last} ${middle} ${first}`, handle: `${slug(first)}.${slug(last)}` }
  }
  return { first, last, full: `${first} ${last}`, handle: `${slug(first)}.${slug(last)}` }
}

function uuid(r) {
  const h = Array.from({ length: 32 }, () => int(r, 0, 15).toString(16))
  h[12] = '4'
  h[16] = '89ab'[int(r, 0, 3)]
  const s = h.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

function pastDate(r, years = 3) {
  const now = Date.UTC(2026, 0, 1)
  return new Date(now - Math.floor(r() * years * 365 * 864e5))
}

/** Field name → generator(r, ctx). ctx carries the row's person so name and email agree. */
export const FIELDS = {
  id: { label: 'id (1, 2, 3…)', make: (r, c) => c.index + 1 },
  uuid: { label: 'uuid', make: (r) => uuid(r) },
  name: { label: 'full name', make: (r, c) => c.person.full },
  firstName: { label: 'first name', make: (r, c) => c.person.first },
  lastName: { label: 'last name', make: (r, c) => c.person.last },
  username: { label: 'username', make: (r, c) => `${c.person.handle.replace('.', '_')}${int(r, 1, 99)}` },
  email: { label: 'email', make: (r, c) => `${c.person.handle}${int(r, 1, 99)}@${pick(r, DATA[c.locale].domains)}` },
  phone: { label: 'phone', make: (r, c) => DATA[c.locale].phone(r) },
  company: { label: 'company', make: (r, c) => pick(r, DATA[c.locale].companies) },
  jobTitle: { label: 'job title', make: (r, c) => pick(r, DATA[c.locale].jobs) },
  address: { label: 'street address', make: (r, c) => (c.locale === 'vi' ? `${int(r, 1, 300)} ${pick(r, DATA.vi.streets)}` : `${int(r, 100, 9999)} ${pick(r, DATA.en.streets)}`) },
  city: { label: 'city', make: (r, c) => pick(r, DATA[c.locale].cities) },
  zip: { label: 'postal code', make: (r, c) => DATA[c.locale].zip(r) },
  country: { label: 'country', make: (r, c) => DATA[c.locale].country },
  birthDate: { label: 'birth date', make: (r) => new Date(Date.UTC(int(r, 1960, 2006), int(r, 0, 11), int(r, 1, 28))).toISOString().slice(0, 10) },
  createdAt: { label: 'created at', make: (r) => pastDate(r).toISOString().replace(/\.\d+Z$/, 'Z') },
  age: { label: 'age', make: (r) => int(r, 18, 70) },
  price: { label: 'price', make: (r, c) => (c.locale === 'vi' ? int(r, 10, 5000) * 1000 : Math.round(int(r, 100, 99999)) / 100) },
  quantity: { label: 'quantity', make: (r) => int(r, 1, 20) },
  active: { label: 'active (boolean)', make: (r) => r() < 0.8 },
  status: { label: 'status', make: (r) => pick(r, ['active', 'pending', 'suspended', 'deleted']) },
  ip: { label: 'IPv4', make: (r) => `${int(r, 11, 223)}.${int(r, 0, 255)}.${int(r, 0, 255)}.${int(r, 1, 254)}` },
  url: { label: 'website', make: (r, c) => `https://${slug(c.person.last)}${int(r, 1, 99)}.${pick(r, DATA[c.locale].domains)}` },
  avatar: { label: 'avatar URL', make: (r, c) => `https://i.pravatar.cc/150?u=${c.person.handle}` }
}

export const DEFAULT_FIELDS = ['id', 'name', 'email', 'phone', 'city', 'createdAt']

export function mockRows({ count = 10, fields = DEFAULT_FIELDS, locale = 'en', seed = 1 } = {}) {
  const r = seededRandom(seed)
  const rows = []
  for (let index = 0; index < count; index++) {
    const ctx = { index, locale, person: person(r, locale) }
    rows.push(Object.fromEntries(fields.map((field) => [field, FIELDS[field].make(r, ctx)])))
  }
  return rows
}

const csvCell = (value) => {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const sqlValue = (value) => (typeof value === 'number' ? String(value) : typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : `'${String(value).replace(/'/g, "''")}'`)
const snake = (name) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

export function formatRows(rows, format, { table = 'users' } = {}) {
  if (!rows.length) return ''
  const fields = Object.keys(rows[0])
  switch (format) {
    case 'json':
      return JSON.stringify(rows, null, 2)
    case 'ndjson':
      return rows.map((row) => JSON.stringify(row)).join('\n')
    case 'csv':
      return [fields.join(','), ...rows.map((row) => fields.map((f) => csvCell(row[f])).join(','))].join('\n')
    case 'sql':
      return `INSERT INTO ${table} (${fields.map(snake).join(', ')}) VALUES\n${rows.map((row) => `  (${fields.map((f) => sqlValue(row[f])).join(', ')})`).join(',\n')};`
  }
  throw new Error(`Unknown format ${format}`)
}
