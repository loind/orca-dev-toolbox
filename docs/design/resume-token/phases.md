# Phases - Resume token decoder

## Phase 1 - Bộ giải mã và tool
- **Requirements:** REQ-040, REQ-041, REQ-042, REQ-043, REQ-044
- **Acceptance:**
  - REQ-040: Test. Trong `test/tools/resumetoken.test.mjs`: token README cho đúng các giá trị của REQ-040; cùng token viết thường, có khoảng trắng, trong `{"_data": …}` và trong `{"_id": {"_data": …}, "operationType": "insert"}` cho cùng kết quả.
  - REQ-041: Test. (a) Fixture `test/fixtures/resumetoken-oracle.json` gồm token README và ít nhất 2.000 token sinh ngẫu nhiên có seed (bằng một bộ mã hóa KeyString viết riêng trong thư mục test, phủ mọi kiểu của D1, object/array lồng, chuỗi có NUL và UTF-8, BinData dài hơn 255 byte, số âm/dương mọi độ dài, phân số, small/large magnitude, NaN, ±Infinity, version 0/1/2), mỗi mục có hex và kết quả mong đợi do gói `mongodb-resumetoken-decoder@1.1.2` giải mã (đã chuẩn hóa về Extended JSON; DBRef theo D3); test so từng mục. (b) Test thuộc tính: giải mã(mã hóa(x)) = x trên ít nhất 5.000 giá trị ngẫu nhiên. (c) Nếu có Docker và image MongoDB (không bắt buộc): vài token thật từ change stream với `_id` là ObjectId, chuỗi, số, object, được oracle xác nhận và thêm vào fixture.
  - REQ-042: Test. Hex lẻ, ký tự `zz`, token cắt ở mọi vị trí của token README (mọi tiền tố), byte kiểu 7, JSON thiếu `_data`, 10.000 chuỗi byte ngẫu nhiên: mỗi ca ném `Error` có message tiếng Anh (không phải `RangeError`/`TypeError`), dài tối đa 200 ký tự. 1 MB hex hợp lệ hoặc không, và object lồng 100.000 tầng, xong dưới 1.000 ms trong một tiến trình con có timeout.
  - REQ-043: Test. `test/panel.test.mjs` (Chromium, 300 px): tool `resumetoken` có trong danh sách ngay sau `objectid`; dán token README hiện dòng `2021-08-31T19:37:55.000Z`, UUID và `"_id": "___x"`; dán `{"_data":"82612E…"}` vào ô tìm kiếm chung mở tool này; lỗi hiện trong khung lỗi, không cuộn ngang.
  - REQ-044: Inspection. `git diff` không đổi `dependencies`/`devDependencies`; không file nào trong `src/` hay `test/` import `mongodb-resumetoken-decoder` hay `bson`; reviewer đọc so sánh không có đoạn nào chép từ gói.
- **Gate:** `node --test test/tools/resumetoken.test.mjs`
