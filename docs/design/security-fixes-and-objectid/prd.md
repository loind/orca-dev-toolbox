# Sửa lỗi bảo mật và thêm MongoDB ObjectId - PRD

## Problem

- Repo này là của bên thứ ba: upstream `thailoc-dev/orca-dev-toolbox`, tác giả Loc Nguyen. Bạn fork về
  (`loind/orca-dev-toolbox`) để tự phát triển tính năng, và có thể chia sẻ fork trong team. Trước khi phát
  triển tiếp, bạn muốn chắc repo không gài bẫy. Lần kiểm tra ngày 2026-11-03 không tìm thấy bẫy. Chi tiết
  từng phần ở `srs.md`, mục "Constraints & assumptions".
- Lần kiểm tra đó tìm ra các lỗi thật. Chúng là bug, không phải bẫy. Khi fork được chia sẻ, người trong team
  dán dữ liệu của người lạ vào tool, rồi chạy đầu ra mà tool sinh ra. Ví dụ: lệnh curl từ tài liệu API, đoạn
  SVG từ web, JSON từ webhook, danh sách email từ ticket. Hiện nay:
  - Bốn converter biến dữ liệu vô hại thành code chạy được:
    - cURL → HTTPie: chạy lệnh shell, và đọc file local rồi gửi đi.
    - HTML → JSX: chạy code khi component render.
    - JSON → Go/Rust: chèn code qua key JSON.
    - Lines → SQL IN: SQL injection trên MySQL.
  - Dán một chuỗi ngắn vào ô tìm kiếm làm panel treo:
    - XML DOCTYPE: 115 byte làm treo hàng giờ.
    - YAML alias bomb: 370 byte làm treo hơn 86 giây.
  - px → rem treo khi stylesheet có chuỗi số dài. bcrypt verify chạy hash cost 31, khoảng 47 giờ CPU.
    Dán private key vào ô tìm kiếm thì key hiện lại trên màn hình.
- Bạn cần tool MongoDB ObjectId ↔ Timestamp giống trang https://steveridout.com/mongo-object-time/,
  chạy ngay trong sidebar Orca và offline. Khi có ObjectId, câu lệnh mẫu phải tự thay bằng ObjectId đó.

## Users & stakeholders

- **Bạn (chủ fork):** phát triển và dùng hằng ngày.
- **Team của bạn:** có thể cài fork từ Git, và dán dữ liệu từ nhiều nguồn vào tool.
- **Không bị ảnh hưởng:** upstream và Orca catalog. Bạn không gửi PR và không publish.

## Success criteria

- 5 phase gate trong `phases.md` và shared gate (`npm run build`, `npm test`) đều xanh. `npm run check` xanh trên
  cây đã commit. Mỗi phase là một commit trên `main`, đã push lên fork `loind/orca-dev-toolbox`.
- Mỗi payload khai thác trong `srs.md` cho ra đầu ra an toàn hoặc thông báo lỗi, trong giới hạn thời gian
  nêu ở đó.
- Tool ObjectId hoạt động như sau:
  - Dán `507f191e810c19729de860ea` thì thấy `2012-10-17T20:46:22.000Z`.
  - Đặt giờ thì ra ObjectId có 16 số 0 ở cuối.
  - Câu lệnh mẫu luôn chứa ObjectId đang hiển thị.

## Out of scope

- Regex Tester: giới hạn thời gian chạy pattern. CSP chặn worker, nên việc này cần thiết kế riêng.
- Chậm khi input rất lớn ở SQL Formatter, Hash (SHA-384/512 dùng BigInt) và Number Base.
- Regex `LENGTH` ở `src/tools/cssunits.js:3`. Ô đó chỉ nhận một dòng.
- Formula injection ở JSON → CSV.
- Các trường hợp biên của JWT `alg`. Chúng không bao giờ làm JWT bị báo nhầm là "verified".
- `URIError` khi data URI chứa ký tự `%` đứng một mình.
- Tự khai báo CSP trong `panel/index.html`. Pin GitHub Actions theo SHA. `persist-credentials: false`.
- Đổi `publisher`/`id` trong `orca-plugin.json` cho fork. Tăng version, tạo tag hoặc release.
- Chọn time zone khác giờ local cho tool ObjectId. Trang gốc cũng chỉ dùng giờ local.
- Phần giải thích dài và đoạn hàm JavaScript của trang gốc.

## Anti-goals

- Đầu ra cho input bình thường bị thay đổi. Ví dụ: một SVG bình thường cho ra JSX khác trước, hoặc
  `curl -X POST` thành `'POST'`.
- Thêm runtime dependency, dùng network, hoặc xin thêm `capabilities` từ Orca.
- Panel chậm hơn với input bình thường. Có thanh cuộn ngang ở độ rộng sidebar.
- Code khó đọc hơn vì cách sửa lỗi, ví dụ thêm một lớp trừu tượng chỉ có một chỗ dùng.

## Open questions

- Bạn có muốn bật GitHub Actions trên fork không? Fork mặc định tắt Actions, nên CI hiện không chạy khi push.
  Chỉ bạn bật được (tab Actions trên GitHub). Câu hỏi này không chặn package: tiêu chí CI dùng lệnh chạy local.

- Khi chia sẻ trong team, fork có cần `publisher`/`id` riêng không? Nếu một người cài cả bản catalog lẫn
  fork, hai plugin sẽ trùng id. Người trả lời: bạn. Câu hỏi này không chặn package.
