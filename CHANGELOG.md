# Changelog

## 0.7.0 – 2026-11-04

### Added
- MongoDB ObjectId: shows the creation time held in an ObjectId, and builds the smallest ObjectId for a local date and time, ready for `db.collection.find({ _id: { $gt: ObjectId("…") } })` with a Copy button. Pasting 24 hex digits, `ObjectId("…")` or `{"$oid": "…"}` opens it.
- Resume token: decodes a MongoDB change stream resume token into its timestamp, version, token type, collection UUID and document key (or event identifier for version 2 tokens). Pasting `{"_data": "8261…"}`, a whole change event with `_id._data`, or the `{ _data: '8261…' }` that mongosh prints opens it. Bare hex does not open it, but you can paste it into the tool.

### Security
- Pasting a private key (PEM or PGP) into the search box is refused: the text is not kept in the box or shown on the page.
- Pasting a crafted XML, CSS length or IPv6 value no longer freezes the panel.
- YAML ↔ JSON refuses a document that would print as more than 12,000,000 characters of JSON, so a small YAML alias bomb no longer freezes the panel. Env Variables and Docker run ↔ Compose read YAML the same way.
- px ↔ rem no longer freezes on a stylesheet with a very long number.
- bcrypt & Basic Auth refuses to verify a hash with a cost above 15 instead of running for hours.
- cURL to HTTPie: a method that is not all letters is refused, and values and names that start with `@` or `=` are written so that HTTPie sends them as text and does not read a local file. An item that starts with `-` can no longer pass as an HTTPie option.
- JSON to Go and Rust: keys with quotes, backslashes or control characters can no longer add code to the generated struct.
- HTML to JSX: attribute names, style names, tag names, `on*` handlers, stray closing tags and text outside any tag can no longer turn into code that runs when React renders the result.
- Image to Base64: the HTML, CSS and Markdown snippets encode the characters that could close the attribute or add a handler.
- Lines → SQL `IN`: a new option doubles backslashes for MySQL and MariaDB, and a warning shows when a value holds a backslash and the option is off.
- Env Variables: variable names that could run commands in the `export` output, add a line to `.env` or add an option to `docker -e` are refused. A value that starts with `=` is quoted for zsh.
- Docker run ↔ Compose: an image or container name that starts with `-` is refused, so Docker cannot read it as an option. A word that starts with `=` is quoted for zsh.
- JSON Query: regex filters no longer run on the JavaScript engine, so a pattern such as `(a+)+$` cannot freeze the panel. Large results and deeply nested JSON no longer end in "Maximum call stack size exceeded".
- Env Variables and Docker run ↔ Compose: pasting a long run of spaces, an unclosed quote on thousands of lines or thousands of `docker run` lines no longer freezes the panel.
- Semver: error messages repeat at most the first 120 characters of the input, and a very long input no longer freezes the panel.
- Mock Data: a table name that is not a SQL identifier is refused.

### Changed
- JSON Query: regex filters (`=~`, `match()`, `search()`) run on a built-in matcher. Back references, lookahead, lookbehind, `\p{…}` and inline flags such as `(?i:…)` are refused with "This regular expression is not allowed". A pattern is at most 200 characters.
- JSON Query: `match()` and `search()` no longer use the `u` flag, so a character outside the Basic Multilingual Plane (an emoji) counts as two units.
- JSON Query: a value longer than 10,000 characters never matches a regex.
- JSON Query: a query that does too much regex work stops with "This query does too much regular expression work".
- YAML ↔ JSON: the error for a document that would print too large is wrapped as "Not valid YAML: …", even when the document uses no alias.
- Env Variables and Docker run ↔ Compose: a name that is not a valid variable name for the chosen target is an error instead of a bad line: `export` takes letters, digits and `_` and no leading digit; `.env`, `docker -e` and Compose also take `.` and `-`. A Secret, ConfigMap or Compose file with several documents is an error.
- cURL to HTTPie: a form field or `-d 'k=v'` is split at the first `=`, so `k=v=w` keeps `=w` (it was lost before). When an item starts with `-`, the command writes `--` before the method.
- HTML to JSX: markup with more than one root, or text, comments or a stray `<` at the root, is wrapped in a fragment `<>…</>`. Unclosed tags are closed, a closing tag that matches nothing is dropped, and `<style>` and `<script>` are never self-closing. `<ul><li>a<li>b</ul>` now gives nested `<li>` elements.
- Semver: long error messages end with `…`.
- Long error messages wrap instead of scrolling the panel sideways.

### Known limits
- JSON Query: with the `g` or `y` flag, `lastIndex` can differ from JavaScript when a loop can match an empty string; the yes or no answer is the same.
- JSON Query: one regex match is not bounded tightly, and a query stops when its total work passes a fixed budget. A pattern that needs thousands of steps per character, such as `(?:a?){990}$`, stops with an error even on data JavaScript would handle.
- YAML ↔ JSON: a legitimate document that would print as more than 12,000,000 characters is refused. A document just under the limit can still take several seconds to show.
- bcrypt & Basic Auth: a hash with cost 16 to 31 cannot be verified. Verifying cost 15 takes about 2 seconds for each key pressed.
- cURL to HTTPie: a name with a backslash before `:`, `;`, `=` or `@` is refused, because HTTPie has no spelling for it.
- HTML to JSX: HTML that leaves out end tags (`<li>`, `<p>`, `<td>`) gives nested elements, which are valid JSX but not what a browser builds. A `<style>` or `<script>` closing tag is copied as written, so `<STYLE>a</style>` does not compile. Pasting a very long run of `<a b` (tens of thousands) can still freeze the panel for seconds.
- XML Formatter: a DOCTYPE with an internal subset that holds `]` inside an entity value is cut short.
- Resume token: at most 20,000 values in one token (fewer when deeply nested), nesting up to 200 levels, and 1 MiB of hex. Decimal128 values show as the nearest double.
- Certificate & CSR: pasting a very long run of `-----BEGIN A ` (tens of thousands) can still freeze the panel for seconds, as before.

## 0.6.1 – 2026-11-03

### Added
- Star on GitHub and Request a tool links under the tool list, and a request link when a search finds nothing. Orca 1.4.246 and later opens them in the browser; older versions copy the address.

## 0.6.0 – 2026-11-03

### Added
- Docker run ↔ Compose: `docker run` commands to a `compose.yaml`, and services back to `docker run`.
- Env Variables: `.env` ↔ JSON, Kubernetes Secret or ConfigMap, `docker -e` flags, Compose and `export`.
- JSON Query: JSONPath with filters, slices, recursive descent and `length()` / `match()`.
- Semver: check a version against npm ranges, compare, sort and bump versions.
- SSH Key: type, size and SHA256/MD5 fingerprints of public keys and `authorized_keys` files.
- TOTP / 2FA: live codes from a Base32 secret or `otpauth://` URI.
- Mock Data: fake records in English or Vietnamese as JSON, CSV, SQL or NDJSON.
- VietQR: NAPAS bank-transfer QR codes, and reading any EMVCo payment payload.
- Pasting a docker run command, `.env` lines, an SSH key, an `otpauth://` URI, a payment QR payload or a version range opens its tool.

### Changed
- Source, tests and build script moved from `build/` to the repository root; tests split per tool.
- CI builds the panel, checks the committed `panel/index.html` is current, and runs the tests.

## 0.5.0 – 2026-10-31

### Added
- Certificate Decoder: PEM certificates, chains and CSRs. Private keys are refused.
- Image to Base64: drop, pick or paste an image; data URI, CSS, `<img>` and Markdown.
- HTML to JSX, including SVG attributes and inline styles.
- px ↔ rem, with Tailwind spacing steps and whole-stylesheet conversion.
- Password Generator.
- bcrypt & Basic Auth: hash, verify, htpasswd line, `Authorization` header.

## 0.4.0 – 2026-10-31

### Added
- Text Transform: remove accents, slugify, lines to SQL `IN` / JSON array and back, Markdown tables.
- SQL Formatter and XML Formatter, grouped with JSON under Format.
- Size & Duration.
- Character Inspector: hidden characters, look-alike letters, NFC/NFD.

### Changed
- Case Converter can strip accents when building identifiers.

## 0.3.0 – 2026-10-31

### Added
- YAML ↔ JSON, CSV ↔ JSON, JSON to Types (TypeScript, Go, Rust, Python).
- cURL to Code (fetch, requests, HTTPie).
- Subnet / CIDR for IPv4 and IPv6, HTTP Status, QR Code.
- JWT signature check and signing (HS256/384/512); SHA-384; ULID and Nano ID; time zones in Timestamp.

### Fixed
- Pressing Enter in the search box no longer types a line break into the tool it opens.

## 0.2.0 – 2026-10-31

### Added
- Escape, Color, Number Base, Chmod, Text Diff, Case Converter, Line Tools, Text Stats.
- An icon for each tool.

## 0.1.0 – 2026-10-31

First release: JWT, Timestamp, Cron, Base64, URL, UUID, Hash & HMAC, JSON Formatter, Regex Tester.
