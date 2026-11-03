# Sửa lỗi bảo mật và thêm MongoDB ObjectId - Design

## Containers (C4 L2)

```mermaid
C4Container
  Person(dev, "Developer", "Bạn và team")
  System_Boundary(toolbox, "Dev Toolbox (fork)") {
    Container(shell, "Panel shell", "JS: src/panel.js, src/detect.js", "Ô tìm kiếm, nhận dạng giá trị dán, mở tool")
    Container(views, "Tool views", "JS: src/views/*.js, src/registry.js", "UI của từng tool")
    Container(logic, "Tool logic", "JS: src/tools/*.js", "Logic thuần, không DOM")
    Container(bundle, "panel/index.html", "esbuild IIFE, commit vào repo", "File duy nhất Orca nạp")
    Container(tests, "Tests", "node:test, Chromium headless", "Unit test và panel test dưới CSP của Orca")
  }
  System_Ext(orca, "Orca", "Frame sandbox, CSP")
  Rel(dev, shell, "Dán, tìm kiếm")
  Rel(shell, views, "open(id, value)")
  Rel(views, logic, "Gọi hàm thuần")
  Rel(orca, bundle, "Nạp")
  Rel(tests, bundle, "Mở trong Chromium")
  Rel(tests, logic, "Import trực tiếp")
```

- **Panel shell.** Nhận giá trị dán và chọn tool.
  - Phase 1: sửa regex trong `detect.js`, và chặn private key trong paste handler của `panel.js`.
  - Phase 5: thêm luật nhận dạng ObjectId và nhãn `LOOKS_LIKE` cho nó.
- **Tool views.**
  - Phase 4: `src/views/transform.js` thêm checkbox MySQL và cảnh báo. `src/views/jsx.js` sửa câu hint để nói
    handler không an toàn sẽ bị bỏ.
  - Phase 5: thêm `src/views/objectid.js` và đăng ký trong `registry.js`.
- **Tool logic.**
  - Phase 1: `xml.js`.
  - Phase 2: `yaml.js`, `cssunits.js`, `bcrypt.js`.
  - Phase 3: `curl.js`, `types.js`.
  - Phase 4: `jsx.js`, `image.js`, `transform.js`.
  - Phase 5: thêm `objectid.js`.
- **panel/index.html.** Phải build lại và commit trong mọi phase.
- **Tests.**
  - Thêm 4 file trong `test/security/` (phase 1–4) và `test/tools/objectid.test.mjs` (phase 5).
  - Thêm case vào `test/detect.test.mjs` và `test/panel.test.mjs`.
  - Glob `test/**/*.test.mjs` của `npm test` tự nhận các file mới.

## Decisions

### D1 - Test hồi quy security nằm trong `test/security/`, mỗi phase một file
**Chosen:** `test/security/paste-detection.test.mjs`, `input-freeze.test.mjs`, `generated-commands.test.mjs`,
`generated-markup-sql.test.mjs`. **Because:** gate của mỗi phase phải đỏ trước khi làm. Mỗi file cũng ghi lại
payload khai thác ở một chỗ, và `npm test` đã tự nhận các file này.
**Rejected:** thêm case vào `test/tools/<tool>.test.mjs` hiện có. Các file đó đang xanh, nên gate sẽ xanh
trước khi phase bắt đầu và không chứng minh được gì.
**Trade-off:** test của một tool nằm ở hai chỗ.

### D2 - Thay regex bằng bản tuyến tính, không giới hạn độ dài input
**Chosen:**
- `xml.js:4`, phần DOCTYPE: `<!DOCTYPE(?:[^>[]|\[[^\]]*\])*>`
- `detect.js` `CSS_LENGTH`: `/^-?(\d+(\.\d+)?|\.\d+)(px|rem|em|pt|vw|vh)$/i`
- `detect.js` `IPV6_CIDR`: `/^(?=[^/]*:)[0-9a-f:]+\/\d{1,3}$/i`
- `detect.js` `XML`: `/^<(\?xml|[A-Za-z_])[\s\S]*>$/`
- `cssunits.js:47`: `/(?<![\d.])(-?(?:\d+(?:\.\d+)?|\.\d+))px\b/g`

**Because:** agent review đã fuzz ba regex của `detect.js` với 200.000 chuỗi ngắn ngẫu nhiên, so với bản cũ: 0
khác biệt về những gì được nhận. Regex DOCTYPE và regex của `cssunits.js` cho cùng kết quả trên input mẫu. Mỗi
bản chạy dưới 4 ms với 100 KB.
**Rejected:**
- Chỉ giới hạn độ dài: vẫn chậm dưới ngưỡng, và che vấn đề đi.
- Chạy detect trong worker: CSP chặn worker.

**Trade-off:** DOCTYPE có internal subset mà trong giá trị entity có `]` sẽ bị cắt token sớm. Bố cục bị lệch
nhưng không báo lỗi. Trường hợp này hiếm.

### D3 - YAML: đếm giá trị sau `loadAll`, giới hạn 1.000.000
**Chosen:** duyệt kết quả của `loadAll` bằng một stack, đếm cả các alias dùng chung. Vượt 1.000.000 thì ném
lỗi, và `parseYaml` bọc lỗi đó thành `Not valid YAML: … aliases …`. Lỗi được ném trong `parseYaml`, nên mọi nơi
gọi đều được bảo vệ: view, `yamlToJson`, `sortKeys`, và `isYaml` trong `detect`.
**Rejected:**
- `maxAliases` của js-yaml: chỉ 70 alias đã nở ra 10^7 giá trị.
- Chỉ giới hạn độ dài đầu ra: lúc đó `JSON.stringify` đã chạy xong rồi.

### D4 - bcrypt: verify từ chối cost lớn hơn 15
**Chosen:** `verifyPassword` đọc cost và reject khi cost > 15, trước khi gọi bcryptjs. 15 cũng là mức tối đa
khi hash. **Rejected:**
- Debounce hoặc hủy: bcryptjs không hủy được việc đang chạy.
- Thêm nút "Verify" bấm tay: đổi UI nhiều hơn.

**Trade-off:** không verify được hash thật có cost 16–31. Những hash này hiếm, và mỗi lần verify mất hơn 5 s.

### D5 - HTTPie: từ chối method lạ; escape `@`, `=` và ký tự phân cách
**Chosen:**
- Target HTTPie ném lỗi khi method không khớp `^[A-Za-z]+$`: "HTTPie only takes letters in a method". HTTPie
  chỉ coi từ đầu tiên là method khi nó gồm toàn chữ cái. Nếu không, HTTPie coi từ đó là URL, nên request và
  credential đi tới host khác. Target `fetch` và `python` không đổi, vì ở đó method đã là chuỗi được quote.
- Mỗi request item: thêm backslash trước `\ : = @ ;` trong tên, và trước `@` hoặc `=` ở đầu giá trị. Cách này
  chặn mọi separator đọc file của HTTPie 3.x: `:@`, `=@`, `:=@`, `==@`. Đã kiểm với HTTPie 3.2.4: `X:\=@f` và
  `note=\=@f` gửi đúng text, không đọc file.
- Cặp form `-d 'k=v'` được tách theo dấu `=` đầu tiên. Hôm nay phần sau dấu `=` thứ hai bị mất.
- `-F name=@file` giữ nguyên là upload file, như curl.

**Rejected:**
- `shellQuote(request.method)`: hết chạy lệnh shell, nhưng HTTPie vẫn gửi request tới host lạ.
- Escape mọi separator trong giá trị: đổi đầu ra cho input bình thường.
- Bỏ target HTTPie: mất tính năng.

### D6 - Go/Rust: escape key, không bỏ key
**Chosen:**
- Go: key không có ký tự đặc biệt thì giữ tag raw như cũ (`` `json:"user_id"` ``). Key có ký tự đặc biệt thì
  dùng interpreted string: `JSON.stringify('json:' + JSON.stringify(key))`.
- Rust: escape `\`, `"`, và ký tự điều khiển thành `\u{..}`.

**Rejected:** bỏ key lạ. Như vậy mất dữ liệu, và người dùng không biết.

### D7 - HTML → JSX: bỏ thứ không an toàn, không comment lại
**Chosen:**
- Bỏ attribute có tên sai.
- Bỏ khai báo style có tên thuộc tính sai.
- Chỉ đưa handler vào arrow function khi giá trị an toàn (REQ-013). Nếu không, bỏ handler.
- Escape `\` trước khi escape backtick và `${`.
- Bỏ thẻ có tên chứa `.` (thẻ mở và thẻ đóng), giữ nội dung bên trong (REQ-027).

**Rejected:**
- Đổi `.` thành `-`: đổi tên thẻ, và tạo một custom element không ai viết.
- Đổi thành comment `{/* … */}`: một `*/` trong giá trị sẽ phá comment.
- Đổi handler thành chuỗi: đổi nghĩa, React không chấp nhận handler là chuỗi.

### D8 - Snippet ảnh: percent-encode trong data URI, bỏ ký tự trong tên
**Chosen:** như REQ-015. Data URI cho phép percent-encoding, nên ảnh vẫn hiển thị đúng. Data URI base64 của PNG
không chứa ký tự nào bị encode, nên không đổi.

### D9 - SQL IN: checkbox MySQL, mặc định tắt, kèm cảnh báo
**Chosen:**
- Thêm option `{ mysql: true }` cho transform `sqlIn`. View có checkbox "Escape backslashes (MySQL, MariaDB)",
  chỉ hiện khi chọn Lines → SQL IN.
- Khi checkbox tắt và có giá trị chứa `\`, view hiện hint cảnh báo.

**Rejected:**
- Luôn nhân đôi `\`: sai dữ liệu trên PostgreSQL, SQLite và SQL Server.
- Chỉ cảnh báo: vẫn không an toàn nếu người dùng bỏ qua.
- Từ chối giá trị có `\`: chặn cả trường hợp hợp lệ.

### D10 - Private key: chặn ngay trong paste handler
**Chosen:** trong handler `paste` của `#search`, nếu text khớp `/-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----/` thì
`preventDefault()`. Sau đó hiện, trong vùng suggestion (role=alert), câu mà tool Certificate đang dùng:
"That is a private key. Keep it out of tools and chats; …".
**Rejected:** mở tool Certificate để báo lỗi. Cách đó đưa key vào một ô khác.

### D11 - ObjectId là một tool mới, giờ local, câu lệnh mẫu dùng `$gt`
**Chosen:**
- Tool `objectid`: logic ở `src/tools/objectid.js`, view ở `src/views/objectid.js`.
- Nhóm Inspect, ngay sau Timestamp. Title "MongoDB ObjectId". Icon mới `leaf`, màu `#13aa52`.
- Bố cục: ô ObjectId; dòng nhãn `Local time (GMT±hh:mm)` có nút Now; lưới 6 ô số (3 cột); rồi các dòng kết quả
  dùng `rows()`.
- Các dòng kết quả: `ObjectId("…")`; câu lệnh mẫu; rồi `timeRows(date)` từ `src/tools/time.js` (Local, UTC,
  ISO 8601, Relative, Unix seconds, Unix milliseconds).

**Rejected:**
- Gộp vào tool Timestamp hoặc UUID & Random: trộn hai khái niệm, và khó nói giá trị dán sẽ mở tool nào.
- Một ô `datetime-local`: khác trang gốc. Bạn yêu cầu "giống như ảnh".

### D12 - Timestamp ObjectId là 32 bit không dấu
**Chosen:** khoảng 1970–2106, giống BSON spec, driver Node (`readUInt32BE`) và trang gốc.
**Rejected:** 32 bit có dấu (1901–2038). Bản này sai với các driver hiện nay.

### D13 - Commit mỗi phase lên `main` và push lên fork qua SSH
Đây là quyết định có tác động ra ngoài: team của bạn cài từ fork. Bạn đã đồng ý "commit và push lên fork".
Việc push thẳng lên `main` là cách tôi hiểu câu đó. Bạn xác nhận khi duyệt package.
**Chosen:**
- Commit đầu tiên chỉ chứa `docs/design/security-fixes-and-objectid/`. Sau đó mỗi phase một commit, gồm code,
  test và `panel/index.html` đã build lại.
- Chỉ push khi gate chung và gate của phase đều xanh: `git push origin main`.
- Đặt push URL qua SSH một lần: `git remote set-url --push origin git@github.com:loind/orca-dev-toolbox.git`.
  HTTPS không có credential; SSH đã được kiểm bằng `git push --dry-run`.
- "CI xanh" nghĩa là `npm run check` và `npm test` chạy local trên cây đã commit. Đây cũng là các lệnh CI chạy.
  GitHub Actions đang tắt trên fork. Nếu bạn bật nó, mỗi lần push sẽ có thêm một lần chạy CI trên Ubuntu.

**Rejected:**
- Branch riêng rồi mở PR: thêm một bước bạn không yêu cầu. CI cũng chỉ chạy trên `main` hoặc PR, mà Actions đang tắt.
- Chỉ push một lần ở cuối: team chờ lâu hơn, và mỗi lần push to hơn.

**Trade-off:** người trong team cài từ `main` giữa chừng sẽ có một phần bản sửa. Mỗi commit đều đã qua gate.

## Agent's calls

- Phạm vi sửa lỗi: bạn trả lời "đồng ý fix các lỗi". Tôi hiểu là phương án 1: 6 lỗi Medium cộng các lỗi Low dễ sửa.
- Code ObjectId viết trước khi có thiết kế là bản thử nghiệm. Tôi đã xóa nó khỏi working tree; bản sao lưu ở
  `/tmp/objectid-spike/`. Package chỉ dùng những gì tôi học được từ nó.
- Câu lệnh mẫu dùng `db.collection`, người dùng tự sửa tên collection sau khi copy. Dùng `$gt` như trang gốc.
  Với ObjectId có đuôi toàn số 0, `$gt` và `$gte` cho cùng kết quả.
- Giá trị lúc mở tool là "bây giờ", làm tròn xuống giây. Trang gốc dùng 00:00 hôm nay.
- Ngày không tồn tại thì báo lỗi. Trang gốc âm thầm tự đổi.
- Nhận thêm `ObjectId('…')`, `new ObjectId(…)`, `ObjectID(…)` và `{"$oid": "…"}`. Từ khóa không phân biệt hoa thường.
  Hex đầu ra luôn là chữ thường.
- Chặn cả khối PGP private key (`-----BEGIN PGP PRIVATE KEY BLOCK-----`) trong REQ-003, không chỉ PEM.
- Nếu một test thời gian fail trên máy chậm hơn (ví dụ CI Ubuntu), được nâng ngưỡng lên tối đa 1 s. Không được
  xóa test. Với mọi payload, bản lỗi vẫn mất ít nhất 4 s.
- Thêm các dòng Local, UTC, Relative, Unix ms (dùng lại `timeRows`). Bạn có thể bỏ.
- Không đưa phần giải thích dài và đoạn hàm JavaScript của trang gốc vào. Chỉ có một dòng hint.
- Handler JSX không an toàn bị bỏ. Hint của tool HTML to JSX nói điều này.
- Giới hạn YAML là 1.000.000 giá trị. Cost tối đa của bcrypt verify là 15.
- Ngưỡng thời gian: XML DOCTYPE dưới 100 ms; `detect()` 100 KB dưới 200 ms; YAML bomb dưới 500 ms;
  `pxToRemInCss` dưới 200 ms; bcrypt từ chối dưới 100 ms.
- Sau phase cuối, documenter cập nhật README (danh sách tool, số tool 35 → 36), số tool trong `orca-plugin.json`,
  và `CHANGELOG.md` (mục Unreleased).
- Các file test hiện có (`test/tools/*.test.mjs`, `test/detect.test.mjs`, `test/panel.test.mjs`) không gắn với REQ
  nào. Chúng giữ cho hành vi hiện tại không đổi qua shared gate `npm test`, tức là chúng bảo vệ anti-goal "đầu ra
  cho input bình thường bị thay đổi". Nếu một phase phải sửa một test hiện có, reviewer phải hỏi lý do.

## Design problems

1. **`panel/index.html` là file build ra và được commit.** Mọi phase đều build lại nó. File này là một dòng
   minified khoảng 260 KB, nên hai phase chạy song song sẽ conflict không gộp được. Các phase phải chạy tuần tự.
2. **`src/detect.js` và `src/panel.js` bị phase 1 và phase 5 cùng sửa.** Phase 5 phụ thuộc phase 1.
3. **Test chứa payload có thể treo khi code cũ còn đó.** Nếu engine viết test trước khi sửa (TDD), payload quá
   lớn sẽ treo hàng giờ. Kích thước payload trong `phases.md` được chọn để code cũ mất vài giây, không phải vài
   giờ. Test bcrypt cost 31 phải có `{ timeout: 2000 }`, vì code cũ chạy khoảng 47 giờ.
4. **Test dựa trên thời gian có thể không ổn định trên CI chậm.** Ngưỡng được đặt khoảng 10–50 lần thời gian của
   bản đã sửa, và vẫn thấp hơn rất nhiều so với bản lỗi.
5. **Giả định HTTPie `\@` chỉ được xác nhận bằng tay** (HTTPie 3.2.4). Test chỉ kiểm tra dạng chuỗi.
6. **Regex Tester vẫn còn khả năng treo.** Nó nằm ngoài phạm vi và đã được ghi vào `prd.md`.
7. **Panel test cần Chromium headless shell.** Gate của phase 1, phase 4 và shared gate đều cần nó.
8. **Push lên `main` tới tay team ngay.** Chỉ push khi gate xanh (D13). Nếu một phase phải làm lại sau khi đã
   push, sửa bằng một commit mới, không force-push.
9. **GitHub Actions tắt trên fork.** Tiêu chí "CI xanh" vì vậy dựa trên lệnh chạy local (D13). Ngưỡng thời gian
   chưa được đo trên Ubuntu.
