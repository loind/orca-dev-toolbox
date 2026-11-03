// CSS lengths: px ↔ rem, em, pt, vw, vh, and Tailwind spacing steps.

const LENGTH = /^(-?\d*\.?\d+)\s*(px|rem|em|pt|vw|vh|%)?$/i

export function parseLength(input, defaultUnit = 'px') {
  const text = input.trim().toLowerCase()
  if (!text) return null
  const match = LENGTH.exec(text)
  if (!match) throw new Error('Not a CSS length. Try 24, 24px, 1.5rem, 12pt or 50vw.')
  return { value: Number(match[1]), unit: match[2] ?? defaultUnit }
}

const round = (n, digits = 4) => Number(n.toFixed(digits))

/** Pixels from a length, given the root font size and the viewport. */
export function toPx({ value, unit }, { root = 16, parent = root, width = 1440, height = 900 } = {}) {
  switch (unit) {
    case 'px': return value
    case 'rem': return value * root
    case 'em': return value * parent
    case 'pt': return (value * 4) / 3
    case 'vw': return (value * width) / 100
    case 'vh': return (value * height) / 100
    case '%': return (value * parent) / 100
    default: throw new Error(`Unknown unit ${unit}.`)
  }
}

export function lengthRows(px, { root = 16, parent = root, width = 1440, height = 900 } = {}) {
  const rows = [
    ['px', `${round(px, 2)}px`],
    ['rem', `${round(px / root)}rem`],
    ['em', `${round(px / parent)}em`],
    ['pt', `${round(px * 0.75, 2)}pt`],
    ['vw', `${round((px / width) * 100, 3)}vw`],
    ['vh', `${round((px / height) * 100, 3)}vh`]
  ]
  // Tailwind's spacing scale is 0.25rem a step: p-4 is 1rem.
  const step = px / root / 0.25
  if (Number.isInteger(step * 2) && step >= 0 && step <= 96) rows.push(['Tailwind', `${step} (p-${step}, gap-${step}…)`])
  return rows
}

/** Every px length in a CSS snippet as rem; 1px borders and 0 stay as they are. */
export function pxToRemInCss(css, root = 16, { keepOnePx = true } = {}) {
  let count = 0
  const out = css.replace(/(?<![\d.])(-?(?:\d+(?:\.\d+)?|\.\d+))px\b/g, (whole, number) => {
    const value = Number(number)
    if (value === 0 || (keepOnePx && Math.abs(value) === 1)) return whole
    count++
    return `${round(value / root)}rem`
  })
  return { css: out, count }
}
