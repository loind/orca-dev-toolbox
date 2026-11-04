import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compareVersions, describeRange, increment, satisfies, sortVersions } from '../../src/tools/semver.js'

test('precedence follows the SemVer 2.0.0 spec example', () => {
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0']
  assert.deepEqual(sortVersions([...ordered].reverse()).sorted, ordered)
  assert.equal(compareVersions('1.0.0+build.1', '1.0.0'), 0)
})

test('npm ranges', () => {
  const cases = [
    ['1.2.3', '^1.2.0', true], ['2.0.0', '^1.2.0', false], ['0.2.5', '^0.2.3', true], ['0.3.0', '^0.2.3', false],
    ['0.0.3', '^0.0.3', true], ['0.0.4', '^0.0.3', false], ['1.2.9', '~1.2.3', true], ['1.3.0', '~1.2.3', false],
    ['1.5.0', '1.x', true], ['2.0.0-beta.1', '^1.0.0', false], ['1.2.4-beta.1', '>=1.2.4-alpha <1.3.0', true],
    ['1.3.0-beta', '^1.2.0', false], ['2.3.9', '1.2.3 - 2.3', true], ['2.4.0', '1.2.3 - 2.3', false],
    ['3.0.0', '^1 || ^3', true], ['1.0.0', '>1', false], ['2.0.0', '>1', true], ['1.9.9', '<=1', true], ['5.0.0', '*', true]
  ]
  for (const [version, range, expected] of cases) assert.equal(satisfies(version, range), expected, `${version} ${range}`)
  assert.equal(describeRange('^1.2.3'), '>=1.2.3 <2.0.0-0')
  assert.equal(describeRange('~0.2 || 3.x'), '>=0.2.0 <0.3.0-0 || >=3.0.0 <4.0.0-0')
})

test('increments', () => {
  assert.deepEqual(['major', 'minor', 'patch', 'prerelease'].map((kind) => increment('1.2.3', kind)), ['2.0.0', '1.3.0', '1.2.4', '1.2.4-rc.0'])
  assert.equal(increment('1.2.3-rc.1', 'prerelease'), '1.2.3-rc.2')
  assert.equal(increment('1.2.3-rc.1', 'patch'), '1.2.3')
  assert.equal(increment('2.0.0-rc.1', 'major'), '2.0.0')
})
