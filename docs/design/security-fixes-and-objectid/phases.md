# Sửa lỗi bảo mật và thêm MongoDB ObjectId - Phases

**Goal:** Sửa các lỗi bảo mật đã xác nhận trong fork Dev Toolbox: đầu ra sinh code chạy được, và panel treo khi dán dữ liệu được chế tạo sẵn. Thêm tool MongoDB ObjectId ↔ Timestamp. Đầu ra cho input bình thường không được đổi.

**Gate (every phase):**
```
npm run build
npm test
```

## Phase 1 - Dán vào ô tìm kiếm không làm treo panel và không hiện lại private key
- **Requirements:** REQ-001, REQ-002, REQ-003
- **Acceptance:**
  - REQ-001: Test. Trong `test/security/paste-detection.test.mjs`:
    - Với `"<?xml version='1.0'?><!DOCTYPE x " + "[]".repeat(30) + "[>"`, `detect()` và `tokenizeXml()` mỗi lệnh trả về dưới 100 ms. Code cũ mất khoảng 9 s.
    - `tokenizeXml('<!DOCTYPE note [<!ENTITY a "b">]><note>x</note>')[0]` vẫn bằng `{ type: 'doctype', text: '<!DOCTYPE note [<!ENTITY a "b">]>' }`.
  - REQ-002: Test. `detect()` với từng chuỗi `'ab:'.repeat(33334)`, `'1'.repeat(100000) + 'x'` và `'<' + 'a'.repeat(100000)` trả về dưới 200 ms. Mọi case trong `test/detect.test.mjs` giữ nguyên kết quả.
  - REQ-003: Test. Panel test, dùng `test/harness.mjs`:
    - Dán `-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMG\n-----END PRIVATE KEY-----` vào `#search`.
    - Sau đó `#search` vẫn rỗng, không view nào mở, và trang hiện một phần tử `role="alert"` chứa "private key".
    - `MIGHAgEAMBMG` không xuất hiện trong text của trang.
    - Làm lại với khối PGP `-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBF\n-----END PGP PRIVATE KEY BLOCK-----`: kết quả giống hệt, và `lQOYBF` không xuất hiện.
    - Mảng `errors` rỗng.
- **Gate:** `node --test test/security/paste-detection.test.mjs`
- **Depends on:** none
- **Notes:**
  - gate red now: `Could not find 'test/security/paste-detection.test.mjs'`.
  - Sửa `src/tools/xml.js`, `src/detect.js`, `src/panel.js`, theo regex trong `design.md` D2 và D10.
  - Build lại và commit `panel/index.html`.
  - Không tăng kích thước payload: với code cũ, mỗi case 100 KB đã mất 5–16 s.
  - Cần Chromium headless shell. Chạy tuần tự, vì mọi phase đều build lại `panel/index.html`.
  - Trước phase này: commit `docs/design/security-fixes-and-objectid/` thành một commit riêng, và đặt push URL qua SSH (xem `design.md` D13).
  - Sau khi gate xanh: một commit cho phase, rồi `git push origin main` (D13).

## Phase 2 - Tool không treo với YAML alias bomb, stylesheet có chuỗi số dài, hoặc hash bcrypt cost cao
- **Requirements:** REQ-004, REQ-005, REQ-006
- **Acceptance:**
  - REQ-004: Test. Trong `test/security/input-freeze.test.mjs`:
    - Bomb 6 tầng: `a0: &a0 ["lol"` ×10 `]`, rồi `a1` đến `a6`, mỗi tầng là mảng 10 alias của tầng trước. Tổng khoảng 370 byte.
    - `parseYaml()` với bomb đó ném lỗi có message chứa "aliases", trong dưới 500 ms.
    - `parseYaml('base: &b {x: 1}\nuse: *b').value` vẫn bằng (deep equal) `{ base: { x: 1 }, use: { x: 1 } }`.
  - REQ-005: Test. `pxToRemInCss('a{content:"' + '1'.repeat(2000) + '"}')` trả về dưới 200 ms (code cũ mất khoảng 4 s). Các test hiện có trong `test/tools/cssunits.test.mjs` vẫn pass.
  - REQ-006: Test.
    - `verifyPassword('x', '$2b$31$' + 'a'.repeat(53))` và `verifyPassword('x', '$2b$16$' + 'a'.repeat(53))` reject trong dưới 100 ms, với message chứa "cost".
    - Hash cost 4 vẫn verify được (test hiện có trong `test/tools/bcrypt.test.mjs`).
    - Test cost 31 phải có `{ timeout: 2000 }`, vì code cũ chạy khoảng 47 giờ.
- **Gate:** `node --test test/security/input-freeze.test.mjs`
- **Depends on:** Phase 1
- **Notes:**
  - gate red now: `Could not find 'test/security/input-freeze.test.mjs'`.
  - Sửa `src/tools/yaml.js`, `src/tools/cssunits.js`, `src/tools/bcrypt.js`, theo `design.md` D2, D3 và D4.
  - "Depends on" ở đây chỉ để chạy tuần tự (`panel/index.html` dùng chung), không phụ thuộc về code.
  - Sau khi gate xanh: một commit cho phase, rồi `git push origin main` (D13).

## Phase 3 - Lệnh HTTPie và code Go/Rust sinh ra không chạy thứ người dùng không viết
- **Requirements:** REQ-007, REQ-008, REQ-009, REQ-010
- **Acceptance:**
  - REQ-007: Test. Trong `test/security/generated-commands.test.mjs`:
    - `convertCurl("curl -X '$(id)' https://api.example.com/items", 'httpie')` ném lỗi có message chứa "letters".
    - `convertCurl('curl -X evil.com https://api.internal/items -u u:p', 'httpie')` ném lỗi có message chứa "letters".
    - `convertCurl('curl -X POST https://x.dev', 'httpie').code` vẫn bằng `http POST https://x.dev`.
    - `convertCurl('curl -X patch https://x.dev', 'httpie').code` bằng `http PATCH https://x.dev`.
    - Với `-X '$(id)'`, target `fetch` và `python` vẫn sinh code như hôm nay (method là một chuỗi đã quote).
    - Panel test hiện có của tool cURL vẫn pass. Trong view, lỗi hiện qua `errorText` như các lỗi parse khác.
  - REQ-008: Test.
    - `curl https://x.example/c -H 'X-Trace: @.env'` cho ra `http GET https://x.example/c 'X-Trace:\@.env'`.
    - `curl https://x.example/c -d 'note=@/etc/passwd'` cho ra `http --form POST https://x.example/c 'note=\@/etc/passwd'`.
    - `curl https://x.example/c --json '{"note":"@/path"}'` cho ra `http POST https://x.example/c 'note=\@/path'`.
    - `curl https://x.example/c -H 'X-Trace: =@secret.json'` cho ra `http GET https://x.example/c 'X-Trace:\=@secret.json'`.
    - `curl https://x.example/c -d 'note==@/etc/passwd'` cho ra `http --form POST https://x.example/c 'note=\=@/etc/passwd'`. Giá trị là phần sau dấu `=` đầu tiên của cặp form. Hôm nay code cắt mất phần này và cho ra `note=`.
    - `curl https://x.example/c --json '{"note":"=@/etc/passwd"}'` cho ra `http POST https://x.example/c 'note=\=@/etc/passwd'`.
    - `curl https://x.example/c -F 'n==@x'` cho ra một item `'n=\=@x'`.
    - `curl https://x.example/c -F 'file=@a.png'` vẫn cho ra `http --multipart POST https://x.example/c file@a.png`.
  - REQ-009: Test.
    - Với JSON có key (viết dạng chuỗi JS) ``id`\n}\nfunc init() { println("x") }\ntype Z struct {\n\tB int `json:"b`` và key `user_id`, `jsonToTypes(…, 'go')` không có dòng nào bắt đầu bằng `func` hoặc `type Z`.
    - Tag của key lạ là `JSON.stringify('json:' + JSON.stringify(key))`.
    - Tag của `user_id` vẫn là `` `json:"user_id"` ``.
  - REQ-010: Test. Với JSON `{"a\"b\\c": 1, "x\ny": 2}`, `jsonToTypes(…, 'rust')` chứa `rename = "a\"b\\c"` và `rename = "x\u{a}y"`.
- **Gate:** `node --test test/security/generated-commands.test.mjs`
- **Depends on:** Phase 2
- **Notes:**
  - gate red now: `Could not find 'test/security/generated-commands.test.mjs'`.
  - Sửa `src/tools/curl.js` và `src/tools/types.js`, theo `design.md` D5 và D6.
  - Các test hiện có trong `test/tools/curl.test.mjs` và `test/tools/types.test.mjs` phải pass mà không bị sửa.
  - Chạy tuần tự (`panel/index.html` dùng chung).
  - Sau khi gate xanh: một commit cho phase, rồi `git push origin main` (D13).

## Phase 4 - JSX, snippet ảnh và SQL IN sinh ra an toàn
- **Requirements:** REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-017, REQ-027
- **Acceptance:**
  - REQ-011: Test. Trong `test/security/generated-markup-sql.test.mjs`, `htmlToJsx('<path d="M0 0" {...pwn()}/>')` bằng `<path d="M0 0" />`.
  - REQ-012: Test.
    - `htmlToJsx(`<div style="a(){},[pwn('k')](){},b: red">x</div>`)` không chứa `pwn`.
    - `htmlToJsx('<div style="color: red; --gap: 4px">x</div>')` vẫn bằng `<div style={{ color: 'red', '--gap': '4px' }}>x</div>`.
  - REQ-013: Test.
    - `htmlToJsx('<a onclick="}} data-x={pwn(1)} y={() => {">x</a>')` không chứa `pwn` và không chứa `onClick`.
    - `htmlToJsx('<button onclick="go()">x</button>')` vẫn bằng `<button onClick={() => { go() }}>x</button>`.
    - Hint của view `jsx` nói handler không an toàn bị bỏ.
  - REQ-014: Test.
    - Với `<style>.a{color:red}\${pwn(2)}</style>`, template literal trong đầu ra (đánh giá bằng `new Function`, với một `pwn` giả) trả về đúng text `.a{color:red}\${pwn(2)}`, và `pwn` không được gọi.
    - Với `<style>q::before{content:"\201C"}</style>`, template literal đánh giá ra đúng text gốc.
  - REQ-015: Test.
    - Snippet HTML của `snippets('data:image/svg+xml,<svg/><!--" onerror="alert(1)" x="-->', { name: 'a" onload="x' })` không chứa `" onerror=` hoặc `" onload=`, và chứa `%22`, `%3C`, `%3E`.
    - `snippets('data:image/png;base64,AAAA', { name: 'logo', width: 16, height: 16 })` vẫn cho ra các snippet như test hiện có trong `test/tools/image.test.mjs`.
  - REQ-016: Test.
    - Input là 2 dòng: `bob\` và `) OR 1=1 #`. `transform(input, 'sqlIn', { mysql: true })` trả về text `('bob\\', ') OR 1=1 #')`, tức hai backslash sau `bob`.
    - Không truyền `mysql`, đầu ra giống hôm nay (chỉ nhân đôi `'`).
    - Panel test: checkbox "Escape backslashes (MySQL, MariaDB)" chỉ hiện khi chọn Lines → SQL IN.
  - REQ-017: Test. Panel test: chọn Lines → SQL IN, checkbox tắt, nhập `bob\`. View hiện hint chứa "MySQL". Bật checkbox thì hint biến mất, và kết quả có `bob\\`.
  - REQ-027: Test.
    - `htmlToJsx('<window.alert>x</window.alert>')` không chứa `window.alert` và vẫn chứa `x`.
    - `htmlToJsx('<p><window.alert><b>y</b></window.alert></p>')` bằng `<p><b>y</b></p>`.
- **Gate:** `node --test test/security/generated-markup-sql.test.mjs`
- **Depends on:** Phase 3
- **Notes:**
  - gate red now: `Could not find 'test/security/generated-markup-sql.test.mjs'`.
  - Sửa `src/tools/jsx.js`, `src/tools/image.js`, `src/tools/transform.js`, `src/views/transform.js`, `src/views/jsx.js`, theo `design.md` D7, D8 và D9.
  - REQ-016 và REQ-017 cần Chromium (`test/harness.mjs`).
  - Test hiện có trong `test/tools/jsx.test.mjs`, `image.test.mjs` và `transform.test.mjs` phải pass mà không bị sửa.
  - Sau khi gate xanh: một commit cho phase, rồi `git push origin main` (D13).

## Phase 5 - Tool MongoDB ObjectId ↔ Timestamp
- **Requirements:** REQ-018, REQ-019, REQ-020, REQ-021, REQ-022, REQ-023, REQ-024, REQ-025, REQ-026
- **Acceptance:**
  - REQ-018: Test. Trong `test/tools/objectid.test.mjs`:
    - `parseObjectId` trả về `6ae8c1900000000000000000` cho `6ae8c1900000000000000000`, ` 6AE8C1900000000000000000 `, `ObjectId("6ae8c1900000000000000000")`, `ObjectId('6ae8c1900000000000000000')`, `new ObjectId('6ae8c1900000000000000000')`, `ObjectID("6ae8c1900000000000000000")` và `{"$oid": "6ae8c1900000000000000000"}`.
    - Trả về `null` cho `'   '`.
    - Ném lỗi chứa "24 hex" cho: 22 hex, 24 ký tự có chữ `g`, và `ObjectId("…')` có nháy không khớp.
  - REQ-019: Test.
    - `objectIdTime('507f191e810c19729de860ea').toISOString()` bằng `2012-10-17T20:46:22.000Z` (ví dụ `getTimestamp()` trong tài liệu MongoDB).
    - `objectIdTime('6ae8c1900000000000000000')` bằng `2026-11-02T17:00:00.000Z`.
    - Panel test: nhập `507f191e810c19729de860ea` vào ô ObjectId thì ô Year = `2012`, ô Second = `22`.
  - REQ-020: Test.
    - `objectIdFromTime(new Date('2026-11-02T17:00:00.999Z'))` bằng `6ae8c1900000000000000000`.
    - Panel test: sau bước của REQ-019, đổi ô Second thành `23` thì ô ObjectId = `507f191f0000000000000000`.
  - REQ-021: Test.
    - `new Date(0)` cho ra `000000000000000000000000`. `2106-02-07T06:28:15Z` cho ra `ffffffff0000000000000000`.
    - `2106-02-07T06:28:16Z`, `1969-12-31T23:59:59Z` và `new Date(NaN)` ném lỗi chứa "1970" và "2106".
  - REQ-022: Test.
    - Ô Year 2026, Month 2, Day 30 cho ra lỗi chứa "no day 30".
    - Month 13, Hour 24, Second 1.5, hoặc một ô trống cho ra lỗi nêu tên ô đó.
    - Panel test: Month = `2`, Day = `30` thì có phần tử `.error` chứa "no day 30".
  - REQ-023: Test. Panel test:
    - Sau khi nhập ObjectId, kết quả chứa `db.collection.find({ _id: { $gt: ObjectId("507f191e810c19729de860ea") } })`.
    - Sau khi đổi Second thành `23`, kết quả chứa `db.collection.find({ _id: { $gt: ObjectId("507f191f0000000000000000") } })`.
    - Dòng này có nút Copy.
  - REQ-024: Test. Panel test: kết quả chứa `ObjectId("507f191e810c19729de860ea")`, `2012-10-17T20:46:22.000Z`, `1350506782`, và một chuỗi khớp `GMT[+-]\d{2}:\d{2}`. Nhãn của các ô giờ chứa cùng chuỗi offset đó.
  - REQ-025: Test.
    - `detect()` trả về `objectid` cho `6ae8c1900000000000000000`, `ObjectId("672f7b4e9d1c2a0012345678")`, `new ObjectId('672f7b4e9d1c2a0012345678')` và `{ "$oid": "672f7b4e9d1c2a0012345678" }`.
    - `detect()` trả về `null` cho `6ae8c19000000000000000` (22 hex) và `ObjectId("6ae8")`.
    - Panel test: dán `ObjectId("507f191e810c19729de860ea")` vào `#search` thì `[data-view="objectid"]` mở và hiện `2012-10-17T20:46:22.000Z`.
  - REQ-026: Test.
    - `TOOLS` trong `src/registry.js` có `objectid` ngay sau `time`, với `group: 'Inspect'`.
    - Map `inputs` trong `test/panel.test.mjs` có case `objectid`.
    - Các panel test hiện có (danh sách tool đủ, không cuộn ngang ở 360 px, hai theme, `errors` rỗng) pass.
- **Gate:** `node --test test/tools/objectid.test.mjs`
- **Depends on:** Phase 1
- **Notes:**
  - gate red now: `Could not find 'test/tools/objectid.test.mjs'`.
  - Làm theo `design.md` D11 và D12, và các mục ObjectId trong "Agent's calls".
  - Phase này sửa `src/detect.js` và `src/panel.js`, giống phase 1, nên phải chạy sau phase 1. Vì `panel/index.html` dùng chung, nên chạy sau cả phase 4.
  - Panel test dùng `getByLabel(…, { exact: true })`, vì nhãn "Second" cũng khớp nút "Copy Unix seconds".
  - Test giờ local chỉ so sánh giây và năm, nên không phụ thuộc time zone. Chạy thử với `TZ=UTC`, `TZ=America/New_York` và `TZ=Asia/Kolkata`.
  - Sau khi gate xanh: một commit cho phase, rồi `git push origin main` (D13).
