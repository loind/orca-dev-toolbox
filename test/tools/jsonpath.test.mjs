import assert from 'node:assert/strict'
import { test } from 'node:test'

import { queryJson } from '../../src/tools/jsonpath.js'

const data = { store: { book: [{ title: 'A', price: 8, tags: ['x', 'y'] }, { title: 'B', price: 12 }, { title: 'C', price: 9, isbn: '1' }], bicycle: { price: 19 } } }
const values = (path) => queryJson(data, path).map((m) => m.value)

test('names, wildcards, indexes, slices and unions', () => {
  assert.deepEqual(values('$.store.book[*].title'), ['A', 'B', 'C'])
  assert.deepEqual(values("$['store']['bicycle'].price"), [19])
  assert.deepEqual(values('$.store.book[-1].title'), ['C'])
  assert.deepEqual(values('$.store.book[0:2].title'), ['A', 'B'])
  assert.deepEqual(values('$.store.book[::-1].title'), ['C', 'B', 'A'])
  assert.deepEqual(values('store.book[0,2].title'), ['A', 'C'])
  assert.deepEqual(values('$..price'), [8, 12, 9, 19])
})

test('filters with comparisons, logic, existence, regex and functions', () => {
  assert.deepEqual(values('$.store.book[?(@.price < 10)].title'), ['A', 'C'])
  assert.deepEqual(values('$.store.book[?@.price > 8 && !@.isbn].title'), ['B'])
  assert.deepEqual(values('$.store.book[?(@.isbn)].title'), ['C'])
  assert.deepEqual(values("$.store.book[?(@.title == 'B' || @.price == 9)].title"), ['B', 'C'])
  assert.deepEqual(values('$.store.book[?(@.title =~ /^[AB]$/)].title'), ['A', 'B'])
  assert.deepEqual(values('$..book[?(length(@.tags) > 1)].title'), ['A'])
  assert.deepEqual(values("$.store.book[?(match(@.title, '[BC]'))].title"), ['B', 'C'])
})

test('paths of matches, and errors', () => {
  assert.deepEqual(queryJson(data, '$..bicycle.price').map((m) => m.path), ['$.store.bicycle.price'])
  assert.deepEqual(queryJson({ 'a b': 1 }, '$.*').map((m) => m.path), ['$["a b"]'])
  assert.throws(() => queryJson(data, '$.store[?(@.price <'), /never closed|ends early/)
})
