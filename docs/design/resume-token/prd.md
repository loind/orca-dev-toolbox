# PRD - Tool giải mã MongoDB change stream resume token

## Vấn đề
Khi debug change stream của MongoDB, resume token chỉ là một chuỗi hex dài (`_id._data`, ví dụ `8261…`). Người dùng không đọc được
nó chứa thời điểm nào, collection nào, document nào. Gói npm `mongodb-resumetoken-decoder` làm được việc này nhưng dùng giấy phép SSPL,
không gộp được vào plugin MIT.

## Mục tiêu
- Dán một resume token (hex, `{"_data": "…"}` hoặc cả change event có `_id._data`) và thấy ngay các trường đã giải mã:
  thời điểm (Timestamp và giờ UTC/địa phương), version, token type, txnOpIndex, fromInvalidate, UUID của collection, documentKey
  (hoặc eventIdentifier ở version 2).
- Code tự viết, MIT, không dependency mới trong bản build.

## Anti-goal
- Không đổi đầu ra của tool nào khác. Không mã hóa token, không kết nối MongoDB.
- Không cần hiển thị chính xác Decimal128 (hiện bằng số double gần nhất, có ghi chú).

## Người dùng
Bạn (chủ fork). Yêu cầu: "tôi chỉ cần có thể giải mã được kết quả".
