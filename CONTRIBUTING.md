# Contributing

Bug reports and tool ideas are welcome in [issues](https://github.com/loind/orca-dev-toolbox/issues).
For a new tool, open an issue first so we can agree on scope before you write code.

## Setup

Node 20.11 or later.

```sh
npm ci --ignore-scripts
npm run build    # writes panel/index.html
npm test
```

To try your changes in Orca: Settings → Plugins → **Development folders…** and add this folder.
Orca reloads the panel when `panel/index.html` changes, so keep `npm run build` running after edits.

The panel tests run headless Chromium through `playwright-core`. If the browser is missing:
`npx playwright-core install chromium-headless-shell`.

## How it fits together

Orca runs the panel in a sandboxed frame whose CSP allows only inline scripts and styles, and no
network. The build therefore bundles everything into a single `panel/index.html`, which is
committed. CI fails if it is out of date, so run `npm run build` before committing.

```
src/
  panel.js      list, search and paste detection; opens tool views
  registry.js   the tools and their groups
  detect.js     recognises a pasted value and picks a tool for it
  ui.js         DOM helpers: fields, segmented buttons, outputs, copy
  icons.js      tile icons
  panel.css     styles, using Orca's --orca-* tokens
  tools/        pure logic, no DOM
  views/        one file per tool: metadata and UI
test/
  tools/        unit tests for src/tools, one file per tool
  detect.test.mjs
  panel.test.mjs   every tool opened in Chromium under Orca's CSP
```

## Adding a tool

1. Write the logic in `src/tools/<name>.js` and its tests in `test/tools/<name>.test.mjs`.
2. Add `src/views/<id>.js`:

   ```js
   export default {
     id: 'color',
     title: 'Color',
     group: 'Convert',            // one of GROUPS in registry.js
     icon: 'droplet',             // from icons.js
     color: '#ec4899',
     description: 'HEX, RGB, HSL and OKLCH',
     keywords: ['hex', 'rgb'],
     create() {
       return { node, focus, fill(value) {} }
     }
   }
   ```

3. Register it in `src/registry.js`.
4. If a pasted value can be recognised, add a rule to `src/detect.js` and a case to
   `test/detect.test.mjs`.
5. `npm run build && npm test`. The panel test opens every tool and fails on script errors, CSP
   violations or horizontal scrolling at sidebar width.

No network calls, analytics or new runtime dependencies without discussing it in an issue first.
