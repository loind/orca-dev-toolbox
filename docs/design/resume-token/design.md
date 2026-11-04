# Design - Resume token decoder

## Định dạng (viết lại bằng lời của chúng tôi, để engine tự cài đặt)

### D1 - KeyString v1
Token là các byte (từ hex) chứa một dãy giá trị KeyString ở mức trên cùng. Vòng đọc mức trên cùng: đọc một byte `b`; nếu `b` là `0x01` hoặc `0xFE`
(byte thứ tự) thì đọc byte kế tiếp làm `b`; nếu `b` là `0x04` (kết thúc) hoặc hết dữ liệu thì dừng; còn lại `b` là **byte kiểu** của giá trị tiếp theo.
Mọi số nhiều byte là big-endian.

| Byte kiểu | Giá trị | Phần dữ liệu |
|---|---|---|
| 10 / 240 | MinKey / MaxKey | không có |
| 15 / 20 | undefined / null | không có |
| 110 / 111 | false / true | không có |
| 120 | Date | 8 byte không dấu, đảo bit cao nhất → số mili giây có dấu kể từ epoch |
| 130 | Timestamp | 4 byte `t` (giây), 4 byte `i` |
| 100 | ObjectId | 12 byte |
| 60 / 160 | String / Code | UTF-8 tới byte `0x00`; nếu ngay sau `0x00` là `0xFF` thì đó là một ký tự NUL trong chuỗi: bỏ `0xFF`, thêm `\0`, đọc tiếp |
| 170 | CodeWithScope | một chuỗi như trên, rồi thân một object (như kiểu 70) |
| 90 | BinData | 1 byte độ dài (nếu là `0xFF` thì 4 byte độ dài), 1 byte subtype, rồi các byte dữ liệu |
| 140 | RegEx | pattern (chuỗi kết thúc `0x00`), rồi flags (chuỗi kết thúc `0x00`) |
| 150 | DBRef | 4 byte độ dài, namespace UTF-8, 12 byte ObjectId |
| 70 | Object | lặp: byte kiểu của trường (`0x00` = hết object; `0x01`/`0xFE` được bỏ qua như ở mức trên cùng; `0x04` cũng kết thúc), tên trường (chuỗi kết thúc `0x00`), byte kiểu lần nữa, rồi giá trị |
| 80 | Array | lặp: byte kiểu rồi giá trị, tới byte `0x00` |
| 30 | NaN | không có |
| 41 | 0 | không có |
| 43..50 | số dương, phần nguyên 1..8 byte | xem dưới |
| 40..33 | số âm, phần nguyên 1..8 byte (40 = 1 byte, 33 = 8 byte) | xem dưới; **mọi byte dữ liệu của số âm bị đảo bit** (kể cả các byte đọc thêm) |
| 42 / 31 | số dương / âm nhỏ (small magnitude) | 8 byte |
| 51 / 32 | số dương / âm lớn (large magnitude) | 8 byte |

**Số nguyên (43..50, 40..33):** đọc N byte thành số E. Bit thấp nhất của E cho biết có phần thập phân; phần nguyên = E >> 1.
Không có phần thập phân: giá trị là ±phần nguyên (BigInt nếu vượt `Number.MAX_SAFE_INTEGER`). Có phần thập phân: đọc thêm `8 − N` byte, ghép sau
phần nguyên thành F (F = (phần nguyên << 8·(8−N)) | các byte đó); giá trị = (F với 2 bit thấp xóa về 0) × 2^(−8·(8−N)), lấy dấu; 2 bit thấp của F
(khi `8 − N` = 0 thì coi là 3) là dấu hiệu Decimal128: nếu nó không phải 0 và không phải 2 thì bỏ qua thêm 8 byte.
**Large magnitude (51/32):** 8 byte E (đảo bit nếu âm). Nếu bit cao nhất của E là 0: có-tiếp = E & 1; các bit double = (E >> 1) | (1 << 62);
giá trị = ±double đó; nếu có-tiếp thì bỏ qua 8 byte. Nếu E toàn bit 1: ±Infinity. Còn lại (Decimal128 vượt khoảng double): bỏ qua 8 byte, ±Infinity.
**Small magnitude (42/31):** 8 byte E (đảo bit nếu âm); xét 2 bit cao nhất: 0 → bỏ qua 8 byte, giá trị 0; 1 hoặc 2 → có-tiếp = E & 1,
bits = (E − 2^62) >> 1, giá trị = ±double(bits) × 2^(−256), bỏ qua 8 byte nếu có-tiếp; 3 → bits = E >> 2, giá trị = ±double(bits).
Engine dùng `BigInt` và `DataView` cho phép chuyển bit sang double.

### D2 - Các trường của resume token
Giá trị mức trên cùng lần lượt là: `timestamp` (Timestamp), `version` (số), `tokenType` (chỉ khi version ≥ 1), `txnOpIndex`, `fromInvalidate`
(chỉ khi version ≥ 1), `uuid` (BinData subtype 4 → chuỗi UUID có gạch; nếu không có hoặc null thì bỏ trống), rồi `eventIdentifier` khi version = 2,
ngược lại `documentKey`. Các giá trị dư sau đó bỏ qua.

### D3 - Khác biệt chủ ý với gói npm
- DBRef: namespace giải mã UTF-8 (gói in danh sách số `1,2,3`, một lỗi của gói). Test fixture so phần này bằng giá trị đúng.
- Decimal128 hiện bằng double gần nhất (như gói); ghi chú trong giao diện không cần.
- Đầu ra là đối tượng JavaScript thuần cho phần giao diện (ObjectId là chuỗi hex có đánh dấu kiểu, v.v.), không dùng lớp của thư viện `bson`;
  phần giao diện in bằng Extended JSON relaxed (`{"$oid"}`, `{"$date"}`, `{"$binary"}`/`{"$uuid"}`, `{"$timestamp"}`, `{"$numberLong"}` cho số vượt
  an toàn, `{"$numberDouble": "NaN"|"Infinity"|"-Infinity"}`, `{"$minKey": 1}`, `{"$maxKey": 1}`, `{"$undefined": true}`,
  `{"$regularExpression"}`, `{"$code"}`, `{"$ref", "$id"}`).

### D4 - An toàn
Đọc lặp chứ không đệ quy (hoặc đệ quy có giới hạn độ sâu 200, vượt thì lỗi rõ ràng); mọi lần đọc kiểm tra còn đủ byte; đầu vào tối đa 1 MB hex
(vượt thì lỗi). Thông báo lỗi chép đầu vào qua cách cắt 120 ký tự (dùng lại `shown` của semver nếu hợp, hoặc hàm riêng tương đương).

## Agent's calls
- Tự viết theo D1-D2 (bạn chọn); gói npm chỉ là oracle sinh fixture, cài trong `/tmp`, không vào `package.json`.
- Tool đặt ngay sau `objectid`; detect chỉ nhận dạng JSON có `_data` là hex bắt đầu bằng `82` (hex trần quá dễ nhầm với tool khác).
- Làm trên nhánh riêng `resume-token` tách từ `merge-upstream-0.6.1`, trong một worktree riêng, để không đụng phần Phase 2 đang chờ.
