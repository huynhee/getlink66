# Getlink 3D66

Tài liệu tổng hợp cho project web getlink 3D66. Project gồm frontend React/Vite và backend Node.js/Express, dùng MongoDB để lưu user, credit, voucher, lịch sử getlink, cookie 3D66 và cấu hình gói nạp.

## 1. Chức năng chính

- Đăng nhập bằng Google OAuth cho cả user và admin.
- User có credit, mặc định user mới là `0` credit.
- Nhập link model 3D66 để lấy link tải.
- Cache sản phẩm để tránh mua lại cùng một model.
- Lưu lịch sử getlink của từng user.
- Nạp credit theo gói.
- Admin quản lý user, credit, cookie 3D66, gói nạp, voucher.
- Voucher có thể giảm giá gói nạp theo phần trăm hoặc cộng thêm credit.

## 2. Cấu trúc thư mục

```txt
get-link-3d66/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   └── utils/
│   ├── .env
│   ├── .env.example
│   ├── package.json
│   └── server.js
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── App.jsx
│   │   └── styles.css
│   ├── index.html
│   └── package.json
│
├── package.json
└── README.md
```

## 3. Yêu cầu môi trường

- Node.js 18 trở lên.
- MongoDB local hoặc MongoDB Atlas.
- npm.

Nếu không muốn cài MongoDB local khi dev, có thể bật memory DB fallback bằng biến:

```env
ALLOW_MEMORY_DB=true
```

Lưu ý: memory DB chỉ dùng tạm khi dev, dữ liệu sẽ không bền như MongoDB thật.

## 4. Cài đặt

Chạy tại thư mục gốc project:

```bash
npm run install:all
```

Lệnh này sẽ cài dependency cho cả `backend` và `frontend`.

## 5. Cấu hình backend

Tạo file:

```txt
backend/.env
```

Có thể copy từ:

```txt
backend/.env.example
```

Mẫu cấu hình:

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/getlink_3d66
SESSION_SECRET=change-me
CLIENT_URL=http://localhost:5173
ALLOW_MEMORY_DB=false
THREED66_MOCK=true
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
VIETQR_BANK_ID=
VIETQR_ACCOUNT_NO=
VIETQR_ACCOUNT_NAME=
VIETQR_TEMPLATE=compact2
VIETQR_IMAGE_HOST=https://api.vietqr.io/image
VIETQR_IMAGE_EXT=jpg
VIETQR_WEBHOOK_SECRET=change-me
```

Giải thích nhanh:

- `PORT`: cổng backend, mặc định `5000`.
- `MONGO_URI`: link MongoDB.
- `SESSION_SECRET`: chuỗi bí mật để ký session.
- `CLIENT_URL`: URL frontend.
- `ALLOW_MEMORY_DB`: cho phép dùng DB tạm nếu MongoDB lỗi.
- `THREED66_MOCK`: bật mock getlink 3D66 khi chưa tích hợp thật.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: thông tin Google OAuth.
- `VIETQR_BANK_ID`: mã ngân hàng hoặc BIN ngân hàng nhận tiền.
- `VIETQR_ACCOUNT_NO`: số tài khoản nhận tiền.
- `VIETQR_ACCOUNT_NAME`: tên chủ tài khoản nhận tiền.
- `VIETQR_TEMPLATE`: mẫu QR, mặc định `compact2`.
- `VIETQR_IMAGE_HOST`: host tạo ảnh VietQR, mặc định `https://api.vietqr.io/image`.
- `VIETQR_IMAGE_EXT`: định dạng ảnh, mặc định `jpg`.
- `VIETQR_WEBHOOK_SECRET`: mã bí mật để bảo vệ webhook tự động xác nhận thanh toán.

## 6. Chạy local

Chạy cả backend và frontend:

```bash
npm run dev
```

URL sử dụng:

```txt
Trang chủ public: http://localhost:5173
Trang getlink:    http://localhost:5173/getlink
Nạp credit:       http://localhost:5173/topup
Lịch sử:          http://localhost:5173/history
Admin:            http://localhost:5173/admin
Backend:          http://localhost:5000
```

Chạy riêng backend:

```bash
npm run dev --prefix backend
```

Chạy riêng frontend:

```bash
npm run dev --prefix frontend
```

Build frontend:

```bash
npm run build --prefix frontend
```

## 7. MongoDB local lấy ở đâu

Cách 1, dùng MongoDB Community Server:

- Tải MongoDB Community Server từ trang chính thức MongoDB.
- Cài đặt trên máy.
- Dùng URI local:

```env
MONGO_URI=mongodb://127.0.0.1:27017/getlink_3d66
```

Cách 2, dùng MongoDB Atlas:

- Tạo cluster miễn phí trên MongoDB Atlas.
- Lấy connection string.
- Dán vào `backend/.env`:

```env
MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/getlink_3d66
```

Cách 3, dev tạm không cần MongoDB:

```env
ALLOW_MEMORY_DB=true
```

## 8. Đăng nhập

### Google OAuth

Backend hỗ trợ Google OAuth qua:

```txt
GET /api/auth/google
GET /api/auth/google/callback
```

Khi dùng Google OAuth cần cấu hình đúng redirect URI trong Google Cloud Console:

```txt
http://localhost:5000/api/auth/google/callback
```

Nếu sai sẽ gặp lỗi:

```txt
redirect_uri_mismatch
```

Nếu `GOOGLE_CLIENT_ID` hoặc `GOOGLE_CLIENT_SECRET` sai sẽ gặp lỗi:

```txt
invalid_client
```

### Admin bằng Google

Admin cũng phải đăng nhập Google như user thường. Backend lấy email thật từ Google OAuth để phân quyền.

Email admin hiện tại:

```txt
huylevan696@gmail.com
```

Nếu Google trả về email này, backend lưu user với:

```txt
role = "admin"
```

Nếu là email khác, backend lưu:

```txt
role = "user"
```

Vào trang admin qua:

```txt
http://localhost:5173/admin
```

Trang `/admin` sẽ chuyển người chưa đăng nhập sang nút đăng nhập Google. Sau khi OAuth thành công, backend redirect lại `/admin`.

Trang chủ `/` là landing page public. Người dùng sau khi đăng nhập Google sẽ vào khu vực getlink tại:

```txt
http://localhost:5173/getlink
```

Nếu user nhập sẵn link 3D66 ở trang chủ rồi bấm `GET LINK`, hệ thống sẽ chuyển sang `/getlink` và tự điền link đó vào ô getlink. Nếu chưa đăng nhập, hệ thống sẽ đăng nhập Google trước rồi quay lại `/getlink` kèm link đã nhập.

## 9. Phân quyền

User model:

```js
User {
  email,
  name,
  avatar,
  role: "user" | "admin",
  credit: Number,
  createdAt
}
```

Quy tắc hiện tại:

- User mới có `credit = 0`.
- Email `huylevan696@gmail.com` là admin.
- Admin vào trang quản trị tại `/admin`.
- User thường dùng `/getlink` để getlink, `/topup` để nạp credit, `/history` để xem lịch sử.

## 10. Credit

Quy tắc:

```txt
1 lần getlink = trừ 1 credit
```

Nếu không đủ credit, backend sẽ không cho getlink.

## 11. Nạp tiền VietQR

Luồng nạp tiền hiện tại:

```txt
1. User vào /topup.
2. User chọn gói credit.
3. Backend tạo giao dịch topup trạng thái pending.
4. Backend tạo ảnh VietQR theo số tiền và nội dung chuyển khoản riêng.
5. User chuyển khoản đúng số tiền và nội dung.
6. Nhà cung cấp biến động số dư gọi webhook về backend.
7. Backend tìm mã giao dịch trong nội dung chuyển khoản.
8. Nếu số tiền đủ, backend tự cộng credit cho user.
```

Backend tạo QR theo VietQR Quick Link:

```txt
https://img.vietqr.io/image/<BANK_ID>-<ACCOUNT_NO>-<TEMPLATE>.png?amount=<AMOUNT>&addInfo=<DESCRIPTION>&accountName=<ACCOUNT_NAME>
```

Tài liệu VietQR Quick Link: https://www.vietqr.io/en/intro

Ví dụ cấu hình `.env`:

```env
VIETQR_BANK_ID=970436
VIETQR_ACCOUNT_NO=123456789
VIETQR_ACCOUNT_NAME=NGUYEN VAN A
VIETQR_TEMPLATE=compact2
VIETQR_IMAGE_HOST=https://api.vietqr.io/image
VIETQR_IMAGE_EXT=jpg
VIETQR_WEBHOOK_SECRET=change-me
```

Webhook tự động:

```txt
POST /api/payments/vietqr/webhook
```

Gửi secret bằng một trong các cách:

```txt
Authorization: Bearer <VIETQR_WEBHOOK_SECRET>
x-webhook-secret: <VIETQR_WEBHOOK_SECRET>
x-vietqr-secret: <VIETQR_WEBHOOK_SECRET>
```

Payload webhook cần có nội dung chuyển khoản chứa mã dạng `NAP...` và số tiền. Backend vẫn nhận cả mã cũ dạng `3D66...` nếu còn giao dịch pending. Backend hỗ trợ các field phổ biến như `description`, `content`, `addInfo`, `transactionContent` cho nội dung và `amount`, `transferAmount`, `creditAmount` cho số tiền.

Ví dụ test webhook:

```bash
curl -X POST http://localhost:5000/api/payments/vietqr/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: change-me" \
  -d "{\"description\":\"NAPPAYMENTCODE\",\"amount\":50000}"
```

Trang `/admin` vẫn có mục duyệt thủ công để xử lý fallback khi webhook chưa chạy hoặc user chuyển khoản sai nội dung.

Gói nạp mặc định:

```txt
GÓI STARTER
50.000đ
5 credit
5 lượt tải model
Lưu lịch sử tải
Hỗ trợ cơ bản

GÓI BASIC
100.000đ
12 credit
Có sale mặc định

GÓI PRO
200.000đ
25 credit
Có sale mặc định

GÓI TEAM
500.000đ
65 credit
Có sale mặc định
```

Admin có thể tạo, sửa thông tin hiển thị bằng cách tạo gói mới, thêm:

- Tên gói.
- Giá.
- Số credit.
- Sale phần trăm.
- Badge.
- Danh sách quyền lợi.

## 12. Voucher

Voucher model:

```js
Voucher {
  code,
  description,
  creditBonus,
  discountPercent,
  usageLimit,
  usedCount,
  expireAt
}
```

Logic voucher:

- Kiểm tra voucher có tồn tại không.
- Kiểm tra đã hết lượt dùng chưa.
- Kiểm tra đã hết hạn chưa.
- Nếu `creditBonus > 0` thì cộng credit cho user.
- Nếu `discountPercent > 0` thì dùng làm voucher giảm giá gói nạp.
- Khi user áp dụng voucher, frontend hiển thị mô tả voucher.
- Admin xem được danh sách voucher đã có.
- Admin có thể xóa voucher.

## 13. Getlink

API:

```txt
POST /api/getlink
```

Body:

```json
{
  "url": "https://3d66.com/model/xxx"
}
```

Luồng xử lý:

```txt
1. Lấy productId từ URL.
2. Kiểm tra ProductCache.
3. Nếu đã cache, trả fileUrl trong cache.
4. Nếu chưa cache, dùng cookie 3D66 để lấy/mua model.
5. Lưu ProductCache.
6. Trừ credit user.
7. Lưu lịch sử getlink.
8. Trả link tải cho user.
```

Khi chưa tích hợp API thật của 3D66, đặt:

```env
THREED66_MOCK=true
```

để backend trả link mock ổn định cho việc test giao diện và luồng credit.

## 14. Admin

Trang admin:

```txt
http://localhost:5173/admin
```

Chức năng admin hiện có:

- Xem user.
- Cộng hoặc set credit cho user.
- Quản lý cookie 3D66.
- Quản lý gói nạp.
- Quản lý voucher.
- Xem và duyệt giao dịch nạp VietQR đang chờ.

Khi vào `/admin`, header user thường như `Getlink`, `Nạp credit`, `Lịch sử` được ẩn để tránh lẫn với trang quản trị.

## 15. API chính

Auth:

```txt
GET  /api/auth/google
GET  /api/auth/google/callback
POST /api/auth/logout
GET  /api/user
```

Credit và topup:

```txt
GET  /api/credit
GET  /api/topup/packages
POST /api/topup
GET  /api/topup/history
```

Voucher:

```txt
POST /api/voucher/apply
```

Payment:

```txt
POST /api/payments/vietqr/webhook
```

Getlink:

```txt
POST /api/getlink
GET  /api/getlink/history
```

Admin:

```txt
GET    /api/admin/users
POST   /api/admin/add-credit
POST   /api/admin/set-credit
POST   /api/admin/cookie
GET    /api/admin/topup-packages
POST   /api/admin/topup-packages
DELETE /api/admin/topup-packages/:id
GET    /api/admin/vouchers
POST   /api/admin/voucher
DELETE /api/admin/vouchers/:id
```

## 16. Lưu ý quan trọng

- Không lưu file model trên server, chỉ trả/proxy link tải.
- Product cache là bắt buộc để tránh mua trùng.
- Cookie 3D66 phải được bảo mật.
- Không tạo đường đăng nhập tắt để lấy quyền admin.
- Mỗi request getlink phải kiểm tra credit trước khi xử lý.
- Nên có cơ chế chống race condition khi nhiều user getlink cùng một model.
- Nên dùng queue nếu request getlink thật tăng cao.

## 17. Các lỗi thường gặp

### Không login được Google, lỗi `invalid_client`

Nguyên nhân thường là sai `GOOGLE_CLIENT_ID` hoặc `GOOGLE_CLIENT_SECRET`.

Cách xử lý:

- Kiểm tra lại credential trong Google Cloud Console.
- Copy đúng client ID và secret vào `backend/.env`.
- Restart backend.

### Không login được Google, lỗi `redirect_uri_mismatch`

Nguyên nhân là redirect URI trong Google Cloud Console không trùng với backend.

Redirect URI cần thêm:

```txt
http://localhost:5000/api/auth/google/callback
```

### Không kết nối được MongoDB local

Kiểm tra MongoDB đã chạy chưa. Nếu chưa muốn cài MongoDB, dùng tạm:

```env
ALLOW_MEMORY_DB=true
```

### Trang admin không vào được

Kiểm tra:

- Đã đăng nhập chưa.
- Email đăng nhập có phải `huylevan696@gmail.com` không.
- Backend đang chạy không.
- Google OAuth đã cấu hình đúng `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` và redirect URI chưa.
#   g e t l i n k 6 6  
 #   g e t l i n k 6 6  
 #   g e t l i n k 6 6  
 