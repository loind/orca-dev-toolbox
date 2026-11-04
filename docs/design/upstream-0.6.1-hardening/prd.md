# Cứng hóa các tool lấy từ upstream 0.6.1 - PRD

## Problem

- Fork đã merge upstream `thailoc-dev/orca-dev-toolbox` v0.6.1, thêm 8 tool: Docker run ↔ Compose, env, JSONPath,
  semver, SSH key, TOTP, mock data, VietQR (nhánh `merge-upstream-0.6.1`, commit merge `5e9f355`).
- Kiểm bẫy cho thấy upstream sạch (không dependency mới, bundle tái tạo được, không network). Nhưng các tool mới
  được viết mà không có phần cứng hóa mà fork đã làm ở 5 phase trước. Kiểm nhanh bằng thực thi tìm ra các lỗi cùng
  loại với những lỗi đã sửa:
  - **env**: khóa biến từ JSON hoặc `docker -e` không được kiểm. Ghi ra `export` rồi chạy trong bash hoặc zsh thì
    tạo file canary (tiêm lệnh).
  - **docker Compose → run** và **env** (đầu vào Secret hoặc ConfigMap): gọi thẳng `load` của js-yaml, bỏ qua giới
    hạn alias bomb. Compose 437 byte ra 40 triệu ký tự.
  - **JSONPath**: bộ lọc regex bị ReDoS (41 ký tự mất 204 giây). `push(...spread)` làm JSON lớn hợp lệ báo "Maximum
    call stack size exceeded".
  - **docker**: `image: "--privileged"` biến thành cờ của `docker run`.
  - **mock**: tên bảng trong đầu ra SQL không được kiểm. **semver**: thông báo lỗi lặp lại cả chuỗi đầu vào 1 MB.

## Users & stakeholders

- Bạn (chủ fork) và team của bạn, những người dán dữ liệu từ nguồn lạ vào tool rồi chạy đầu ra.
- Không ảnh hưởng: tác giả upstream. Bạn không báo lỗi và không gửi PR lên upstream.

## Success criteria

- 2 gate phase và gate chung (`npm run build`, `npm test`) xanh trên nhánh merge. Gate chung hiện xanh: 165/165 (Sửa sau khi build: sau hai phase 218/218; sau khi hợp nhất tool resume token 248/248).
- Mỗi payload khai thác trong `srs.md` cho ra đầu ra an toàn hoặc thông báo lỗi trong giới hạn thời gian nêu ở đó.
- Đầu ra cho đầu vào bình thường của 8 tool không đổi.
- Sau cùng: nhánh được hợp nhất vào `main` và push lên fork. Tôi tự chạy lại các phép thử khai thác làm kiểm tra cuối.

## Out of scope

- Báo lỗi cho tác giả upstream, gửi PR lên upstream.
- Tool sshkey, totp, vietqr: kiểm nhanh không thấy lỗi, không sửa gì.
- Giá trị trong đầu ra `.env` có `$(...)` khi người dùng `source` file (cú pháp dotenv không có cách escape thống nhất giữa
  các parser): chỉ ghi nhận, không đổi.
- Hai lỗi treo khi dán có sẵn từ trước (`decodePem` trong `cert.js`, regex TOKEN của HTML to JSX) và test thời gian flaky
  của Phase 1, 2: bạn đã chọn bỏ qua Phase 6 cũ.
- Đổi `publisher`/`id` của plugin, tăng version, README và CHANGELOG (documenter làm ở cuối).

## Anti-goals

- Đầu ra cho đầu vào bình thường của 8 tool bị đổi.
- Thêm runtime dependency, dùng network, xin thêm `capabilities`.
- Mất tính năng hợp lệ: ví dụ từ chối mọi regex trong JSONPath, hay từ chối mọi tên biến có dấu chấm.

## Open questions

- Footer hai liên kết đã được đổi sang fork `loind/orca-dev-toolbox` (quyết định của tôi). Bạn có thể đổi lại.
