# PRD - Tool giải mã MongoDB change stream resume token

## Vấn đề
Khi debug change stream của MongoDB, resume token chỉ là một chuỗi hex dài (`_id._data`, ví dụ `8261…`). Người dùng không đọc được
nó chứa thời điểm nào, collection nào, document nào. Gói npm `mongodb-resumetoken-decoder` làm được việc này nhưng dùng giấy phép SSPL,
không gộp được vào plugin MIT.

## Mục tiêu
- Dán một resume token (hex, hex trong dấu nháy, `{"_data": "…"}`, cả change event có `_id._data`, hoặc dạng mongosh `{ _data: '…' }`) và thấy ngay các trường đã giải mã:
  thời điểm (Timestamp và giờ UTC/địa phương), version, token type, txnOpIndex, fromInvalidate, UUID của collection, documentKey
  (hoặc eventIdentifier ở version 2).
  *Sửa sau khi build: đã thêm dạng mongosh `{ _data: '8261…' }` (khóa không nháy, nháy đơn) và hex trong một cặp nháy; token version 2 hiện khối `eventIdentifier` (`{operationType, documentKey}`) thay cho `documentKey`.*
- Code tự viết, MIT, không dependency mới trong bản build.

## Anti-goal
- Không đổi đầu ra của tool nào khác. Không mã hóa token, không kết nối MongoDB.
- Không cần hiển thị chính xác Decimal128 (hiện bằng số double gần nhất). *Sửa sau khi build: giao diện không có ghi chú về điều này (bản đầu ghi "có ghi chú"), đúng như D3.*
- Token quá lớn bị từ chối bằng lỗi rõ ràng (trần 1.048.576 chữ số hex, 20.000 giá trị tính theo độ sâu) thay vì làm treo panel. *Sửa sau khi build: giới hạn này do reviewer đề nghị sau vòng review 1; xem REQ-042.*

## Người dùng
Bạn (chủ fork). Yêu cầu: "tôi chỉ cần có thể giải mã được kết quả".
