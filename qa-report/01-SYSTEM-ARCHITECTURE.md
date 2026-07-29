# System Architecture

## Runtime

- Frontend: React 18 + Vite 6, client-side rendering và route trong `App.jsx`.
- Backend: Express 4 + Mongoose 8, REST API dưới `/api`.
- Authentication: Google OAuth, JWT access/refresh trong cookie HttpOnly,
  session version để thu hồi token; plugin dùng device authorization và Bearer.
- Security: CSRF HMAC, exact-origin CORS, Helmet/CSP, rate limit, Turnstile.

## Data Ownership

- Atlas Core: user, credit/topup, Pro, voucher, referral, getlink, taxonomy,
  nội dung website và cấu hình lõi.
- MongoDB VPS: catalog Model/Scene, download session/log, quota, Drive sync,
  audit/system log và dữ liệu vận hành tăng nhanh.
- Google Drive: archive, cover, preview, `metadata.json.gz`, history archive và
  backup. Public API không trả Drive file ID.

## Background Work

- `GetlinkJob` dùng Mongo làm persistent queue, claim nguyên tử và heartbeat.
- Drive Changes, retention, notification, cleanup và marketplace workers chạy
  theo interval trong backend process.
- Graceful shutdown dừng nhận HTTP, chờ getlink đang chạy rồi mới đóng Mongo.

## Deployment Shape

Frontend build được Nginx phục vụ; `/api` proxy tới Node. Hiện tại phải chạy
**một backend replica** vì rate limit/cache/worker lock còn theo process. Muốn
scale ngang cần Redis/distributed lock và tách worker.

## External Dependencies

Google OAuth/Drive, Cloudflare Turnstile/DNS, SePay/VietQR, Telegram/getlink
upstream và tùy chọn image-search provider. `/health` kiểm tra process;
`/ready` kiểm tra DB và shutdown state, chưa kiểm tra đầy đủ storage/worker.
