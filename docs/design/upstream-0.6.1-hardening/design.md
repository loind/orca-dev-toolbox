# Cứng hóa các tool lấy từ upstream 0.6.1 - Design

## Containers (C4 L2)

```mermaid
C4Container
  Person(dev, "Developer", "Bạn và team")
  System_Boundary(toolbox, "Dev Toolbox (fork)") {
    Container(shell, "Panel shell", "JS: src/panel.js, src/detect.js", "Không đổi trong đợt này")
    Container(views, "Tool views", "JS: src/views/*.js", "docker, env, jsonpath, mock, semver: chỉ hiện lỗi mới qua errorText có sẵn")
    Container(logic, "Tool logic", "JS: src/tools/*.js", "env.js, docker.js, jsonpath.js, semver.js, mock.js")
    Container(yaml, "YAML có giới hạn", "src/tools/yaml.js: parseYaml + jsonLength", "Đã có từ gói trước; docker và env dùng lại")
    Container(bundle, "panel/index.html", "esbuild IIFE, commit vào repo", "Build lại sau mỗi phase")
    Container(tests, "Tests", "node:test, Chromium", "Thêm test/security/env-docker.test.mjs và jsonpath-small.test.mjs")
  }
  Rel(dev, shell, "Dán, tìm kiếm")
  Rel(shell, views, "open(id, value)")
  Rel(views, logic, "Gọi hàm thuần")
  Rel(logic, yaml, "docker.js và env.js gọi parseYaml")
```

- **Tool logic**: phase 6 sửa `src/tools/env.js` và `src/tools/docker.js`; phase 7 sửa `src/tools/jsonpath.js`,
  `src/tools/semver.js` và `src/tools/mock.js`. Không đụng view trừ khi một thông báo lỗi cần hiện.
- **Tests**: 2 file mới trong `test/security/`; các test của 8 tool do upstream viết phải pass mà không bị sửa.

## Decisions

### D1 - Tên biến: từ chối ở đầu ra thay vì quote hay đổi tên
**Chosen:** `writeEnv` kiểm tên theo mẫu của từng đích (POSIX cho `shell`; mẫu của `parseDotenv` cho `dotenv`, `docker`,
`compose`) và ném lỗi nêu tên sai. `json`, `secret`, `configmap` giữ nguyên (đã an toàn: JSON và `dump`, `k8sKey`).
**Because:** shell không có cách `export` một tên không hợp lệ, nên quote không giúp được; đổi tên âm thầm làm đổi dữ liệu.
**Rejected:** thay ký tự lạ bằng `_` (như `k8sKey`): đổi tên biến mà người dùng không biết. Cắt khóa tại ký tự lạ: mất dữ liệu.
**Trade-off:** JSON có khóa như `spring.datasource.url` vẫn dùng được cho `dotenv`, `docker`, `compose` nhưng không `export`.

### D2 - YAML: dùng lại `parseYaml` của gói trước
**Chosen:** `docker.js` và `env.js` gọi `parseYaml` thay cho `load`. Nếu `documents > 1` thì ném lỗi "one document".
Thông báo lỗi YAML giữ dạng `Not valid YAML: …` như hôm nay.
**Because:** `parseYaml` đã có `jsonLength` (giới hạn 12 triệu ký tự in ra, tính cả alias) và đã được hai reviewer kiểm.
**Rejected:** viết giới hạn riêng cho hai tool: lặp lại logic đã kiểm.

### D3 - Option bị chèn trong `docker run`: từ chối `image` và `container_name` bắt đầu bằng `-`
**Chosen:** ném lỗi. Tên image và container hợp lệ của Docker không bắt đầu bằng `-`. Không dùng `--` trước image vì
các tham số sau image là lệnh của container và `docker run -- IMAGE` đổi cách đọc cờ.
**Rejected:** bỏ im giá trị: người dùng không biết nó mất.

### D4 - Regex trong JSONPath: kiểm tra bảo thủ chứ không chạy với timeout
**Chosen:** `safeRegExp(source, flags)` từ chối mẫu dài hơn 200 ký tự và mọi nhóm bị lượng từ bao khi nhóm đó chứa lượng từ
hoặc `|`; chuỗi so sánh dài hơn 10.000 ký tự coi là không khớp. Dùng chung cho `=~`, `match()`, `search()`.
**Because:** JavaScript không hủy được một regex đang chạy; panel không có worker (CSP). Giới hạn bảo thủ chặn các dạng backtracking
phổ biến mà vẫn giữ được các mẫu thông thường. Giới hạn đã biết: một số mẫu tuyến tính hợp lệ như `(a|b)*` cũng bị từ chối.
**Rejected:** Web Worker với timeout (CSP chặn). Viết bộ khớp regex riêng: quá lớn cho phạm vi này.

### D5 - `push(...spread)`: thay bằng vòng `for`
**Chosen:** như đã làm ở `checkSize` của gói trước.

### D6 - Mock và semver: sửa nhỏ nhất
**Chosen:** `mock`: tên bảng phải là định danh SQL (một hoặc hai đoạn). `semver`: cắt phần đầu vào trong thông báo lỗi.

## Agent's calls

- Footer hai liên kết trỏ về fork `loind/orca-dev-toolbox` thay vì upstream (bạn chưa nói). Test footer của upstream đã đổi theo.
- Quy trình giống gói trước: engine, hai reviewer độc lập, gate do tôi chạy, tôi commit trên nhánh `merge-upstream-0.6.1`.
  Chỉ khi cả hai phase xong và kiểm tra cuối đạt thì tôi hợp nhất vào `main` và push.
- Đầu ra `.env` có `$(...)` khi `source` file: chỉ ghi nhận (xem Out of scope).
- Phép thử khai thác của tôi chạy lại ở cuối làm kiểm tra cuối (verifier), thay cho một phiên agent riêng.
- Documenter chạy ở cuối: README, CHANGELOG, mô tả manifest (44 tool), và hai gói thiết kế.

## Design problems

1. **`panel/index.html` dùng chung**: hai phase chạy tuần tự, như trước.
2. **Regex bảo thủ có thể từ chối mẫu hợp lệ**: người dùng JSONPath thường viết `^...$` đơn giản, nên ít ảnh hưởng. Đã ghi rõ trong thông báo lỗi.
3. **Nhánh dài hạn**: lần merge upstream sau sẽ xung đột cùng chỗ và có thể xung đột với các sửa ở `docker.js`, `env.js`,
   `jsonpath.js`. Công thức giải quyết xung đột nằm trong memory.
4. **Test thời gian**: gate chung chứa vài test thời gian flaky đã biết của Phase 1 và 2 (không sửa trong đợt này);
   gate phase mới không dựa vào thời gian chặt (biên rộng).
