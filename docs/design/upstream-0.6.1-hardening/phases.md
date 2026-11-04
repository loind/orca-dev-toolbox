# Cứng hóa các tool lấy từ upstream 0.6.1 - Phases

**Goal:** Sửa các lỗi cùng loại với 5 phase trước trong các tool lấy từ upstream 0.6.1 (env, docker, JSONPath, semver, mock): tiêm lệnh qua khóa biến, alias bomb, tùy chọn bị chèn, ReDoS và tràn ngăn xếp. Đầu ra cho đầu vào bình thường không được đổi.

**Gate (every phase):**
```
npm run build
npm test
```

## Phase 1 - env và docker: không tiêm lệnh, không alias bomb, không tùy chọn bị chèn
- **Requirements:** REQ-028, REQ-029, REQ-030, REQ-031
- **Acceptance:**
  - REQ-028: Test. Trong `test/security/env-docker.test.mjs`:
    - `writeEnv([['a;touch /tmp/x', '1']], 'shell')` ném lỗi có message chứa `a;touch /tmp/x`; tương tự cho `b$(id)`, `c\nINJECTED`, `` d`id` ``, `1abc`, `a-b`, `a.b`, tên rỗng.
    - Test thực thi: chạy đầu ra `shell` của `[['FOO', 'x y'], ['BAR_1', "it's"]]` trong bash và trong zsh với một hàm `printenv` giả: giá trị đọc lại đúng từng ký tự; không file canary nào xuất hiện cho mọi tên độc hại.
    - Đầu ra cho tên hợp lệ giữ nguyên chuỗi hôm nay: `export FOO='x y'`.
  - REQ-029: Test. `writeEnv` với tên `c\nINJECTED`, `a=b`, `a b`, `a#b`, `a\u0000b` và `''` ném lỗi cho từng đích `dotenv`, `docker`, `compose`; tên `spring.datasource.url`, `my-key`, `A_1` vẫn cho đầu ra y hệt hôm nay ở cả ba đích; đích `json`, `secret`, `configmap` không đổi.
  - REQ-030: Test. Một alias bomb (6 tầng, mỗi tầng 10 alias, khoảng 400 byte) đặt vào `command` của một service Compose và vào `data` của một ConfigMap: `composeToRun` và `readEnv` ném lỗi có message chứa "aliases" trong dưới 500 ms. Compose và ConfigMap bình thường (kể cả có anchor và alias nhỏ) cho đúng đầu ra hôm nay. Một Compose hai document (`---`) và một Secret hai document ném lỗi có message chứa "one document". Lỗi YAML cú pháp có message bắt đầu bằng `Not valid YAML` đúng một lần (không lồng `Not valid YAML: Not valid YAML`). Compose không có `services` và ConfigMap không có `data` giữ message hôm nay.
  - REQ-031: Test. `composeToRun` với `image: "--privileged"`, với `container_name: "--rm"` và với service tên `-x` không có `container_name` ném lỗi; `image: 5` (số) được đổi sang chuỗi và không ném lỗi; `container_name: x` và `image: nginx` cho đầu ra như hôm nay. Từ nguyên vẹn bắt đầu bằng `=` (ví dụ phần tử `command: ["=ls", "a=b"]`, một đường `env_file` hay `volumes` là `=x`) ra trong nháy đơn (`'=ls'`); `a=b` và nhãn `k: "=zsh"` (ra `k==zsh`) giữ nguyên không nháy. Chạy đầu ra trong bash và (nếu có `zsh`) zsh với một hàm `docker` giả in từng đối số: không canary, đối số đúng. Canary chỉ được tạo trong thư mục tạm riêng (`mkdtemp`), không dùng đường dẫn cố định.
- **Gate:** `node --test test/security/env-docker.test.mjs`
- **Depends on:** none
- **Notes:**
  - gate red now: `Could not find 'test/security/env-docker.test.mjs'`.
  - Sửa `src/tools/env.js` và `src/tools/docker.js`, theo `design.md` D1, D2, D3; dùng lại `parseYaml` của `src/tools/yaml.js`.
  - Các test của upstream (`test/tools/env.test.mjs`, `test/tools/docker.test.mjs`) phải pass mà không bị sửa.
  - Engine build lại `panel/index.html` và `git add -A` (chỉ staging); không commit, không push. Orchestrator chạy gate rồi commit trên nhánh `merge-upstream-0.6.1`.
  - Phase xong khi cả gate phase lẫn gate chung xanh. Nếu `npm test` đỏ chỉ ở các test thời gian flaky đã biết của Phase 1 và 2 (REQ-002, REQ-003, REQ-004, REQ-006 của gói trước), orchestrator chạy lại; engine báo rõ tên test đỏ.
  - Test thực thi dùng `mkdtemp` cho canary; zsh có sẵn trên macOS, nếu thiếu thì phần zsh bị bỏ qua có ghi chú.

## Phase 2 - JSONPath không treo và không tràn ngăn xếp; semver và mock: sửa nhỏ
- **Requirements:** REQ-032, REQ-033, REQ-034, REQ-035
- **Acceptance:**
  - REQ-032: Test. Trong `test/security/jsonpath-small.test.mjs`, `queryJson({ a: [200000 object có id] }, '$..id')` trả đúng 200.000 kết quả; `queryJson({ a: Array(1000000).fill(1) }, '$.a[0:1000000000]')` trả 1.000.000 kết quả; `$.a[?(@.id==@.id)]` trên 200.000 phần tử trả 200.000 kết quả; `$..x` trên một JSON lồng 3.000 tầng (dựng bằng vòng lặp, không bằng `JSON.parse` nếu nó từ chối) trả đúng số kết quả; không trường hợp nào ném `RangeError`. Mỗi trường hợp lớn chạy dưới 10.000 ms (biên rộng, chỉ để bắt treo). Kết quả cho các JSON nhỏ giữ y hệt (các test của upstream).
  - REQ-033: Test. Với `{ a: [{ v: 'a'.repeat(40) + '!' }] }`: các mẫu `(a+)+$`, `(a|aa)+$`, `(a*)*b`, `(.*a){20}`, `(a?)+$` và `a*a*a*a*a*b` (năm lặp không giới hạn) dùng qua `=~` bị từ chối; `match(@.v, '(a+)+$')` và `search(@.v, '(a+)+$')` cũng ném lỗi; mỗi lệnh ném lỗi có message bắt đầu bằng `This regular expression is not allowed` trong dưới 50 ms (không chạy mẫu). Mẫu dài 201 ký tự bị từ chối. Các mẫu `^[A-Z]\w+$`, `^\d{3}-\d{4}$`, `^(png|jpg)$`, `^(\d{3}-){2}\d{4}$`, `^(\d{1,3}\.){3}\d{1,3}$`, `^a+!$`, `(a|b){3}` và `^[\w.+-]+@[\w-]+\.[\w.-]+$` chạy và cho đúng kết quả. Dấu `\(`, `\*`, `\|` và lớp ký tự `[+*|(]` không bị tính là lượng từ hay nhóm. Chuỗi dài 2.001 ký tự không khớp với mẫu hợp lệ và không ném lỗi. Mẫu `=~` literal sai quy tắc ném lỗi ngay khi phân tích đường dẫn (kể cả khi dữ liệu rỗng); mẫu của `match()`/`search()` kiểm tra khi chạy.
  - REQ-034: Test. `parseVersion('1.'.repeat(500000))`, `compareVersions('1.0.0', '1.'.repeat(500000))`, `satisfies('1.0.0', 'x'.repeat(1000000))` và `increment('1.'.repeat(500000), 'patch')` ném lỗi có message dài tối đa 200 ký tự, chứa đúng 120 đơn vị đầu của đầu vào đã `trim()` và kết thúc phần chép bằng `…`; một đầu vào có emoji đúng ở vị trí 120 không bị cắt đôi cặp surrogate. Đầu vào ngắn giữ message như hôm nay (so sánh với các test của upstream).
  - REQ-035: Test. `formatRows(rows, 'sql', { table: 'users; DROP TABLE x; --' })`, `{ table: 'a b' }` và `{ table: '1abc' }` ném lỗi; `{ table: '' }`, `{ table: null }` và không truyền `table` cho cùng đầu ra như `users`; `users`, `public.users`, `_t1` cho đầu ra y hệt hôm nay.
- **Gate:** `node --test test/security/jsonpath-small.test.mjs`
- **Depends on:** Phase 1
- **Notes:**
  - gate red now: `Could not find 'test/security/jsonpath-small.test.mjs'`.
  - Sửa `src/tools/jsonpath.js` (dòng 290 và 327 là `push(...spread)`; `new RegExp` ở dòng 207 và 253), `src/tools/semver.js`, `src/tools/mock.js`, theo `design.md` D4, D5, D6.
  - Các test của upstream cho jsonpath, semver, mock phải pass mà không bị sửa.
  - Test thời gian dùng biên rộng: mã cũ mất hàng chục đến hàng trăm giây hoặc ném lỗi ngay; ngưỡng 50 ms cho lệnh bị từ chối, 10.000 ms cho các ca lớn.
  - Engine build lại `panel/index.html` và `git add -A` (chỉ staging); không commit, không push. Chạy tuần tự sau Phase 1.
