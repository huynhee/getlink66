# Bug Report

Môi trường tái hiện: local production-like build, baseline `3b0b1cf`. Tất cả lỗi
dưới đây đã được sửa và có regression test hoặc build/smoke gate tương ứng.

## BUG-001: CSP chặn Cloudflare Turnstile

- Mức độ/Khu vực: High, security headers.
- Tái hiện: bật Turnstile với production CSP; script/frame không tải.
- Root cause: CSP thiếu exact Turnstile origin.
- Sửa: `httpSecurity.js` tạo Helmet policy và HSTS tập trung.
- Test: `http-security.test.js`; Chromium smoke. Trạng thái: Fixed.

## BUG-002: Production bundle có thể gọi localhost

- Mức độ/Khu vực: High, frontend API.
- Tái hiện: build không đặt API URL; fallback là `localhost:5000`.
- Root cause: fallback dùng chung dev/production.
- Sửa: production dùng same-origin; build verifier quét artifact.
- Test: `npm run build:release`. Trạng thái: Fixed.

## BUG-003: Logout không thu hồi JWT cũ

- Mức độ/Khu vực: Critical, authentication.
- Tái hiện: lưu access token, logout, gọi lại API bằng token cũ.
- Root cause: token không có server-side revocation version.
- Sửa: thêm `sessionVersion`, ký/kiểm tra `sv`, logout tăng version.
- Test: `session-revocation.test.js`. Trạng thái: Fixed.

## BUG-004: Admin 2FA không fail-closed

- Mức độ/Khu vực: High, admin authentication.
- Tái hiện: production admin chưa enroll vẫn có thể tiếp tục theo config yếu.
- Root cause: 2FA không bắt buộc ở production.
- Sửa: production gate + `2FA_SETUP_REQUIRED`.
- Test: `auth-hardening.test.js`, `production-readiness.test.js`. Fixed.

## BUG-005: Admin bypass quyền tải Pro

- Mức độ/Khu vực: Critical, marketplace authorization.
- Tái hiện: admin không Pro tạo session tài nguyên Pro.
- Root cause: tier `admin` được coi là không giới hạn.
- Sửa: public/plugin chỉ xét `proUntil`; verify-file là luồng admin riêng.
- Test: `marketplace-rules.test.js`. Trạng thái: Fixed.

## BUG-006: File route thiếu ràng buộc chủ session

- Mức độ/Khu vực: Critical, IDOR download.
- Tái hiện: user B dùng session ID của user A.
- Root cause: file endpoint xác minh token nhưng chưa buộc owner đầy đủ.
- Sửa: bắt buộc auth và đối chiếu `session.userId`.
- Test: `request-security.test.js`, marketplace rules. Trạng thái: Fixed.

## BUG-007: Startup có thể chạy migration production

- Mức độ/Khu vực: High, database lifecycle.
- Tái hiện: bật migration flag khi boot production.
- Root cause: migration và runtime startup chưa tách an toàn.
- Sửa: production mặc định tắt; readiness gate cấm startup migration.
- Test: `production-readiness.test.js`. Trạng thái: Fixed.

## BUG-008: Production khởi động với cấu hình nguy hiểm

- Mức độ/Khu vực: High, configuration.
- Tái hiện: thiếu VPS URI/2FA/Turnstile hoặc bật dev login.
- Root cause: warning không chặn boot.
- Sửa: `productionReadiness.js` fail-fast và tích hợp `env:check`.
- Test: `production-readiness.test.js`. Trạng thái: Fixed.

## BUG-009: Shutdown không drain getlink đang chạy

- Mức độ/Khu vực: High, worker/idempotency.
- Tái hiện: SIGTERM khi worker đang xử lý.
- Root cause: interval dừng nhưng promise active không được đợi.
- Sửa: theo dõi active promise, drain timeout trước khi đóng Mongo.
- Test: `getlink-job.test.js`. Trạng thái: Fixed.

## BUG-010: Audit log nuốt lỗi ghi DB

- Mức độ/Khu vực: High, auditability.
- Tái hiện: DB audit lỗi; action vẫn chạy mà không có tín hiệu vận hành.
- Root cause: catch rỗng.
- Sửa: log lỗi đã làm sạch kèm actor/action/target.
- Test: lint + admin regression. Trạng thái: Fixed.

## BUG-011: Plugin nhận URL tải cần cookie web

- Mức độ/Khu vực: Critical, plugin download.
- Tái hiện: plugin tạo session bằng Bearer nhưng URL trả về trỏ route cookie.
- Root cause: dùng chung URL phát file không đúng auth contract.
- Sửa: route plugin file riêng, Bearer + owner.
- Test: `plugin-download-idempotency.test.js`. Trạng thái: Fixed.

## BUG-012: Plugin update/challenge production chưa fail-closed

- Mức độ/Khu vực: High, supply chain/anti-bot.
- Tái hiện: manifest thiếu signature/checksum hoặc challenge không always.
- Root cause: validation chỉ ở runtime từng route.
- Sửa: production gate bắt HTTPS, SHA-256, signature, version và challenge.
- Test: plugin auth/challenge/readiness tests. Trạng thái: Fixed.

## BUG-013: Image search có thể im lặng bị vô hiệu

- Mức độ/Khu vực: Medium, product capability.
- Root cause: thiếu provider chỉ tạo warning.
- Sửa: production mặc định yêu cầu HTTPS provider/key; có opt-out rõ ràng.
- Test: readiness tests. Trạng thái: Fixed về fail-fast; provider còn phải cấu hình.

## BUG-014: Google Fonts làm trang phụ thuộc mạng ngoài

- Mức độ/Khu vực: Medium, performance/privacy.
- Tái hiện: smoke có 16 request ngoài lỗi và first page khoảng 9.4 giây.
- Sửa: bỏ external font links, dùng system font stack.
- Test: smoke còn 0 external failure, home 225 ms. Trạng thái: Fixed.

## BUG-015: CI thiếu artifact/security/browser gates

- Mức độ/Khu vực: Medium, release process.
- Sửa: CI dùng release build verifier, Chromium smoke và upload evidence.
- Test: workflow review + local command pass. Trạng thái: Fixed.

## BUG-016: Docker frontend từ chối cấu hình API same-origin

- Mức độ/Khu vực: High, production build.
- Tái hiện: build image với `VITE_API_URL` rỗng theo production example.
- Root cause: Dockerfile chạy `test -n "$VITE_API_URL"` trước Vite build.
- Sửa: cho phép chuỗi rỗng; reverse proxy production route `/api` same-origin.
- Test: clean Vite build + artifact verifier; Docker CLI local không có. Fixed.
