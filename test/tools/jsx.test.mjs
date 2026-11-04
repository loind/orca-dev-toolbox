import assert from 'node:assert/strict'
import { test } from 'node:test'

import { htmlToJsx, styleObject } from '../../src/tools/jsx.js'

test('HTML and SVG become JSX', () => {
  assert.equal(htmlToJsx('<label class="a" for="x" tabindex="1">Hi {name}</label>'), '<label className="a" htmlFor="x" tabIndex="1">Hi {\'{\'}name{\'}\'}</label>')
  assert.equal(htmlToJsx('<input value="v" checked disabled><br>'), '<>\n  <input defaultValue="v" defaultChecked disabled /><br />\n</>')
  assert.equal(htmlToJsx('<svg viewBox="0 0 1 1" stroke-width="2"><path fill-rule="evenodd" xlink:href="#a"/></svg>'), '<svg viewBox="0 0 1 1" strokeWidth="2"><path fillRule="evenodd" xlinkHref="#a" /></svg>')
  assert.equal(htmlToJsx('<button onclick="go()" ondblclick="x()" onmouseover="y()">a</button>'), '<button onClick={() => { go() }} onDoubleClick={() => { x() }} onMouseOver={() => { y() }}>a</button>')
  assert.equal(htmlToJsx('<!-- c --><p data-id="1" aria-label="x">t</p>'), '<>\n  {/* c */}<p data-id="1" aria-label="x">t</p>\n</>')
  assert.equal(htmlToJsx('<p>a</p><p>b</p>'), '<>\n  <p>a</p><p>b</p>\n</>')
  assert.equal(htmlToJsx('<i></i>', { component: 'Icon' }), 'export default function Icon() {\n  return (\n    <i></i>\n  )\n}')
  assert.equal(styleObject('color: red; -webkit-transition: all 1s; -ms-flex: 1; z-index: 2; --gap: 4px; background: url(a;b)'), "{{ color: 'red', WebkitTransition: 'all 1s', msFlex: '1', zIndex: 2, '--gap': '4px', background: 'url(a;b)' }}")
})
