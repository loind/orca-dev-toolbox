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
  - REQ-030: Test. Một alias bomb (6 tầng, mỗi tầng 10 alias, khoảng 400 byte) đặt vào `command` của một service Compose và vào `data` của một ConfigMap: `composeToRun` và `readEnv` ném lỗi có message chứa "aliases" trong dưới 500 ms. Compose và ConfigMap bình thường (kể cả có anchor và alias nhỏ) cho đúng đầu ra hôm nay.
  - REQ-031: Test. `composeToRun` với `image: "--privileged"` và với `container_name: "--rm"` ném lỗi; với `container_name: x` và `image: nginx` đầu ra như hôm nay. Một nhãn có giá trị `=zsh` hoặc một lệnh có từ `=ls` ra từ đó đặt trong nháy đơn (`'=ls'`). Chạy đầu ra trong bash và zsh với một hàm `docker` giả in từng đối số: không canary, đối số đúng.
- **Gate:** `node --test test/security/env-docker.test.mjs`
- **Depends on:** none
- **Notes:**
  - gate red now: `Could not find 'test/security/env-docker.test.mjs'`.
  - Sửa `src/tools/env.js` và `src/tools/docker.js`, theo `design.md` D1, D2, D3; dùng lại `parseYaml` của `src/tools/yaml.js`.
  - Các test của upstream (`test/tools/env.test.mjs`, `test/tools/docker.test.mjs`) phải pass mà không bị sửa.
  - Build lại và commit `panel/index.html`; chạy tuần tự (file dùng chung).
  - Nhánh làm việc: `merge-upstream-0.6.1`. Engine không commit; orchestrator commit.

## Phase 2 - JSONPath không treo và không tràn ngăn xếp; semver và mock: sửa nhỏ
- **Requirements:** REQ-032, REQ-033, REQ-034, REQ-035
- **Acceptance:**
  - REQ-032: Test. Trong `test/security/jsonpath-small.test.mjs`, `queryJson({ a: [200000 object có id] }, '$..id')` trả đúng 200.000 kết quả; `queryJson({ a: Array(1000000).fill(1) }, '$.a[0:1000000000]')` trả 1.000.000 kết quả; `$.a[?(@.id==@.id)]` trên 200.000 phần tử trả 200.000 kết quả; không trường hợp nào ném `RangeError`. Kết quả cho các JSON nhỏ giữ y hệt (các test của upstream).
  - REQ-033: Test. Với `{ a: [{ v: 'a'.repeat(40) + '!' }] }`: `$.a[?(@.v=~/(a+)+$/)]`, `$.a[?(@.v=~/(a|aa)+$/)]`, `$.a[?(@.v=~/(a*)*b/)]`, `$.a[?(@.v=~/(.*a){20}/)]`, `$.a[?match(@.v, '(a+)+$')]` và `$.a[?search(@.v, '(a+)+$')]` ném lỗi (message nêu lý do) trong dưới 50 ms mỗi lệnh. Mẫu dài 201 ký tự bị từ chối. `$.a[?(@.v=~/^[A-Z]\w+$/)]`, `/^\d{3}-\d{4}$/`, `/^(png|jpg)$/` và `/^a+!$/` chạy và cho đúng kết quả. Chuỗi dài 10.001 ký tự không khớp với mẫu hợp lệ, không ném lỗi.
  - REQ-034: Test. `parseVersion('1.'.repeat(500000))` và `compareVersions` với chuỗi 1 MB ném lỗi có message dài tối đa 200 ký tự (120 ký tự đầu vào cộng thêm chữ của thông báo), kết thúc bằng `…` khi đầu vào bị cắt; đầu vào ngắn giữ message như hôm nay.
  - REQ-035: Test. `formatRows(rows, 'sql', { table: 'users; DROP TABLE x; --' })`, `{ table: '' }` không có (dùng `users`), `{ table: 'a b' }`, `{ table: '1abc' }` ném lỗi (trừ trường hợp rỗng); `users`, `public.users`, `_t1` cho đầu ra y hệt hôm nay.
- **Gate:** `node --test test/security/jsonpath-small.test.mjs`
- **Depends on:** Phase 1
- **Notes:**
  - gate red now: `Could not find 'test/security/jsonpath-small.test.mjs'`.
  - Sửa `src/tools/jsonpath.js` (dòng 290 và 327 là `push(...spread)`; `new RegExp` ở dòng 207 và 253), `src/tools/semver.js`, `src/tools/mock.js`, theo `design.md` D4, D5, D6.
  - Các test của upstream cho jsonpath, semver, mock phải pass mà không bị sửa.
  - Test thời gian dùng biên rộng (mã cũ mất hàng chục giây đến hàng trăm giây; ngưỡng 50 ms cho lệnh bị từ chối là so với 204 giây; test lớn dùng 2000 ms).
  - Build lại và commit `panel/index.html`. Chạy tuần tự sau Phase 1.
