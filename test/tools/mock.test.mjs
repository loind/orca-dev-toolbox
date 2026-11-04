import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FIELDS, formatRows, mockRows } from '../../src/tools/mock.js'

test('rows are reproducible from a seed and fields agree with each other', () => {
  const a = mockRows({ count: 5, fields: ['id', 'name', 'email'], locale: 'vi', seed: 7 })
  assert.deepEqual(a, mockRows({ count: 5, fields: ['id', 'name', 'email'], locale: 'vi', seed: 7 }))
  assert.notDeepEqual(a, mockRows({ count: 5, fields: ['id', 'name', 'email'], locale: 'vi', seed: 8 }))
  assert.deepEqual(a.map((r) => r.id), [1, 2, 3, 4, 5])
  for (const row of a) {
    const given = row.name.split(' ').pop().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
    assert.ok(row.email.startsWith(`${given}.`), `${row.name} / ${row.email}`)
  }
})

test('Vietnamese phones are 10-digit mobile numbers; every field generates', () => {
  for (const { phone } of mockRows({ count: 50, fields: ['phone'], locale: 'vi', seed: 3 })) assert.match(phone, /^0[35789]\d{8}$/)
  const row = mockRows({ count: 1, fields: Object.keys(FIELDS), locale: 'en' })[0]
  assert.equal(Object.keys(row).length, Object.keys(FIELDS).length)
})

test('JSON, CSV and SQL output', () => {
  const rows = [{ id: 1, name: "O'Brien, Pat", active: true }]
  assert.equal(formatRows(rows, 'csv'), 'id,name,active\n1,"O\'Brien, Pat",true')
  assert.equal(formatRows(rows, 'sql', { table: 'people' }), "INSERT INTO people (id, name, active) VALUES\n  (1, 'O''Brien, Pat', TRUE);")
  assert.deepEqual(JSON.parse(formatRows(rows, 'json')), rows)
  assert.equal(formatRows([{ createdAt: 'x' }], 'sql'), "INSERT INTO users (created_at) VALUES\n  ('x');")
})
