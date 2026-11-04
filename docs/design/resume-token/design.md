# Design - Resume token decoder

## Định dạng (viết lại bằng lời của chúng tôi, để engine tự cài đặt)

### D1 - KeyString v1
Token là các byte (từ hex) chứa một dãy giá trị KeyString ở mức trên cùng. Vòng đọc mức trên cùng: đọc một byte `b`; nếu `b` là `0x01` hoặc `0xFE`
(byte thứ tự) thì đọc byte kế tiếp làm `b`; nếu `b` là `0x04` (kết thúc) thì dừng; còn lại `b` là **byte kiểu** của giá trị tiếp theo.
*Sửa sau khi build: hết dữ liệu không còn là điều kiện dừng. Mỗi lần đọc byte kiểu đều kiểm tra còn byte, nên token cạn dữ liệu ở chỗ cần byte kiểu là lỗi `The token is cut off: …`. Hệ quả: một token phải kết thúc bằng ít nhất một byte sau giá trị cuối (thường là `0x04`).*
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
| 39..32 | số âm, phần nguyên 1..8 byte (39 = 1 byte, 32 = 8 byte) | xem dưới; **mọi byte dữ liệu của số âm bị đảo bit** (kể cả các byte đọc thêm) |
| 42 / 40 | số dương / âm nhỏ (small magnitude) | 8 byte |
| 51 / 31 | số dương / âm lớn (large magnitude) | 8 byte |

**Số nguyên (43..50, 39..32):** đọc N byte thành số E. Bit thấp nhất của E cho biết có phần thập phân; phần nguyên = E >> 1.
Không có phần thập phân: giá trị là ±phần nguyên (BigInt nếu vượt `Number.MAX_SAFE_INTEGER`; *sửa sau khi build: kết quả ra ngoài là `{"$numberLong": "…"}`, không phải BigInt*). Có phần thập phân: đọc thêm `8 − N` byte, ghép sau
phần nguyên thành F (F = (phần nguyên << 8·(8−N)) | các byte đó); giá trị = (F với 2 bit thấp xóa về 0) × 2^(−8·(8−N)), lấy dấu; 2 bit thấp của F
(khi `8 − N` = 0 thì coi là 3) là dấu hiệu Decimal128: nếu nó không phải 0 và không phải 2 thì bỏ qua thêm 8 byte.
**Large magnitude (51/31):** 8 byte E (đảo bit nếu âm). Nếu bit cao nhất của E là 0: có-tiếp = E & 1; các bit double = (E >> 1) | (1 << 62);
giá trị = ±double đó; nếu có-tiếp thì bỏ qua 8 byte. Nếu E toàn bit 1: ±Infinity. Còn lại (Decimal128 vượt khoảng double): bỏ qua 8 byte, ±Infinity.
**Small magnitude (42/40):** 8 byte E (đảo bit nếu âm); xét 2 bit cao nhất: 0 → bỏ qua 8 byte, giá trị 0; 1 hoặc 2 → có-tiếp = E & 1,
bits = (E − 2^62) >> 1, giá trị = ±double(bits) × 2^(−256), bỏ qua 8 byte nếu có-tiếp; 3 → bits = E >> 2, giá trị = ±double(bits).
Engine dùng `BigInt` và `DataView` cho phép chuyển bit sang double.

### D2 - Các trường của resume token
Giá trị mức trên cùng lần lượt là: `timestamp` (Timestamp), `version` (số), `tokenType` (chỉ khi version ≥ 1), `txnOpIndex`, `fromInvalidate`
(chỉ khi version ≥ 1), `uuid` (BinData subtype 4 → chuỗi UUID có gạch; nếu không có hoặc null thì bỏ trống), rồi `eventIdentifier` khi version = 2,
ngược lại `documentKey`. Các giá trị dư sau đó bỏ qua.

*Sửa sau khi build (đọc `decodeBytes` trong `src/tools/resumetoken.js`):*
- `timestamp` phải là giá trị đầu tiên (byte kiểu 130), nếu không lỗi `A resume token starts with a Timestamp`.
- `version`, `tokenType`, `txnOpIndex` là kiểu số (byte kiểu 30..51) và phải ra số JavaScript an toàn; NaN, ±Infinity hoặc số vượt 53 bit là lỗi `must be a number that fits in 53 bits`. Byte `0x04` xuất hiện trước các trường này là lỗi `The token ends before the …`.
- `fromInvalidate` phải là `true`/`false` (byte kiểu 111/110), nếu không lỗi.
- Sau `txnOpIndex` (hoặc `fromInvalidate`), nếu gặp `0x04` thì token dừng ở đó (không có `uuid`, `documentKey`). `uuid` phải là BinData subtype 4 đúng 16 byte hoặc `null`; kiểu khác hoặc BinData không phải UUID là lỗi (chặt hơn bản đầu, vốn chỉ nói "nếu không có hoặc null thì bỏ trống"). `uuid` là `null` thì kết quả không có khóa `uuid`.
- Khóa `documentKey`/`eventIdentifier` chỉ có khi sau uuid còn một giá trị, và sau giá trị đó phải còn ít nhất một byte (xem D1), nếu không lỗi `the end byte 0x04 is missing`.
- Version 2 trả khối `eventIdentifier`; token thật của MongoDB 7 là version 2 với `eventIdentifier = {operationType, documentKey}` (D1 số âm cũng được sửa nhờ các token thật này).

### D3 - Khác biệt chủ ý với gói npm
- (Sửa 21:2x theo phát hiện của engine, kiểm bằng MongoDB thật và oracle: bảng số âm ở D1 trước đây ghi sai số byte kiểu.)
- Gói npm có lỗi riêng ở `__proto__` làm tên trường, BOM đầu chuỗi, ngày trước 1970 và timestamp ≥ 2^31: bộ giải mã của chúng ta giải đúng các ca này (kiểm bằng test mã hóa-giải mã ngược); fixture oracle tránh chúng.
- DBRef: namespace giải mã UTF-8 (gói in danh sách số `1,2,3`, một lỗi của gói). Test fixture so phần này bằng giá trị đúng.
- Decimal128 hiện bằng double gần nhất (như gói); ghi chú trong giao diện không cần. *Sửa sau khi build: đúng như vậy, giao diện không có ghi chú; `-0` hiện là `0`.*
- Tên trường của object giữ thứ tự trong token. Một object JavaScript đưa tên số nguyên lên đầu và gộp tên trùng, nên mỗi object giải mã ghi thêm danh sách `[tên, giá trị]` vào một `WeakMap` (`ORDER`), và `toExtendedJson` in từ danh sách đó (object không có trong `ORDER`, ví dụ do người gọi tự tạo, in bằng `Object.entries`). Tên `__proto__` được gán bằng `Object.defineProperty` nên là khóa thường. *Sửa sau khi build: reviewer vòng 1 tìm ra lỗi đảo thứ tự `{b:1,'10':2}`.*
- Date từ 1970-01-01 đến 9999-12-31 ra chuỗi ISO; ngoài khoảng đó ra `{"$date": {"$numberLong": "…"}}` (đúng relaxed Extended JSON).
- Đầu ra là đối tượng JavaScript thuần cho phần giao diện (ObjectId là chuỗi hex có đánh dấu kiểu, v.v.), không dùng lớp của thư viện `bson`;
  phần giao diện in bằng Extended JSON relaxed (`{"$oid"}`, `{"$date"}`, `{"$binary"}`/`{"$uuid"}`, `{"$timestamp"}`, `{"$numberLong"}` cho số vượt
  an toàn, `{"$numberDouble": "NaN"|"Infinity"|"-Infinity"}`, `{"$minKey": 1}`, `{"$maxKey": 1}`, `{"$undefined": true}`,
  `{"$regularExpression"}`, `{"$code"}`, `{"$ref", "$id"}`).

### D4 - An toàn
Đọc lặp chứ không đệ quy (hoặc đệ quy có giới hạn độ sâu 200, vượt thì lỗi rõ ràng); mọi lần đọc kiểm tra còn đủ byte; đầu vào tối đa 1 MB hex
(vượt thì lỗi). Thông báo lỗi chép đầu vào qua cách cắt 120 ký tự (dùng lại `shown` của semver nếu hợp, hoặc hàm riêng tương đương).

*Sửa sau khi build (`src/tools/resumetoken.js`):*
- Bộ đọc là **đệ quy có giới hạn** (`object`, `array`, `value` gọi nhau), không phải lặp; `MAX_DEPTH = 200`, vượt thì lỗi `Objects and arrays nest more than 200 levels deep.`. Test: lồng 190 tầng đọc được, 300 tầng lỗi; 100.000 tầng (hex và JSON) xong dưới 1.000 ms.
- `MAX_HEX = 1048576` chữ số hex (tức 512 KiB byte, "1 MB" nghĩa là số chữ số), `MAX_TEXT = 4194304` ký tự văn bản dán (có thể là cả change event).
- Thêm trần giá trị: `MAX_VALUES = 20000` giá trị trong một token và `MAX_WEIGHT = 400000` (mỗi giá trị cộng `độ sâu + 1`), lỗi `The token holds too many values (20,000 at most, fewer when deeply nested).`. Lý do: một token hợp lệ 1 MB gồm 200 mảng lồng và 523.000 null làm `toExtendedJson` sinh 213.797.515 ký tự (535 ms, 735 MB RSS) và treo Chromium. Ở trần, JSON ra dưới 1.000.000 ký tự.
- `shown` được dùng trong thông báo ký tự hex sai; thông báo lỗi trong test dài tối đa 200 ký tự.
- Lỗi không phải `Error` thuần (ví dụ `RangeError` từ `TextDecoder`) đổi thành `This is not a resume token that can be read.`.

### D5 - Nhận dạng đầu vào và detect
*Sửa sau khi build: mục mới.* `tokenHex(input)` lấy chuỗi hex: hex trần (hoặc trong một cặp nháy `"` hoặc `'`), JSON `{"_data": …}`, JSON có `_id._data`; nếu `JSON.parse` thất bại, thử hai biểu thức chính quy cho dạng mongosh (`{ _data: '…' }` ở đầu, hoặc `_id: { _data: '…' }` ở bất kỳ đâu). `isResumeToken` trong `src/detect.js` dùng lại `tokenHex` và đòi hex khớp `^82` + ít nhất 8 byte (xem REQ-043); nó chạy trước `isJson` nên `{"_data":"82…"}` hợp lệ mở tool `resumetoken` chứ không phải `json`.

## Agent's calls
- Tự viết theo D1-D2 (bạn chọn); gói npm chỉ là oracle sinh fixture, cài trong `/tmp`, không vào `package.json`.
- Tool đặt ngay sau `objectid`; detect chỉ nhận dạng JSON có `_data` là hex bắt đầu bằng `82` (hex trần quá dễ nhầm với tool khác). *Sửa sau khi build: phải có thêm ít nhất 8 byte sau `82`, và dạng mongosh cũng được nhận (D5). Tool đặt đúng sau `objectid` trong `src/registry.js`, nhóm `Inspect`, icon `bookmark`.*
- Làm trên nhánh riêng `resume-token` tách từ `merge-upstream-0.6.1`, trong một worktree riêng, để không đụng phần Phase 2 đang chờ.
