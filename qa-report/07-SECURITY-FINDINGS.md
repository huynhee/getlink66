# Security Findings

## Controls đã xác minh

- Cookie HttpOnly; production Secure/SameSite; exact-origin CORS.
- CSRF HMAC cho mutation; plugin Bearer routes tách khỏi cookie CSRF.
- Helmet CSP chỉ cho Turnstile origin cần thiết, HSTS và `nosniff`.
- JWT có session revocation; ban/role đọc lại từ Atlas.
- Admin role + email allowlist + production TOTP 2FA.
- Marketplace kiểm tra auth, Pro, Turnstile, quota, owner ở backend.
- Plugin device code, rotating refresh, single-use challenge và owner-bound file.
- SePay xử lý server-side/idempotent; không tin redirect hoặc giá frontend.
- Mongo operator payload bị từ chối; public response không lộ Drive ID/secrets.
- Build artifact không chứa localhost, Mongo URI, private key, secret assignment
  hoặc source map.
- `npm audit --offline`: 0 known vulnerabilities trong cache hiện có.

## Rủi ro còn lại

1. `drive_redirect` trả URL Drive tái sử dụng sau authorization. Dùng `proxy` để
   giữ URL kín; nếu vẫn redirect phải chấp nhận bằng env rõ ràng.
2. Rate limit theo process; nhiều replica làm nhân giới hạn.
3. Worker interval chưa có distributed leader lock; production chỉ một replica.
4. Chưa chạy DAST/staging với domain HTTPS, Turnstile và OAuth thật.
5. Plugin manifest cần public key pinning được xác minh trong plugin client.
6. Secret rotation, firewall, Cloudflare WAF và access log retention là thao tác
   hạ tầng chưa thể xác minh trong repo.

## Security Gate

Production boot bị chặn nếu dev login, HTTP callback, sai Turnstile hostname,
thiếu 2FA, thiếu VPS transaction requirement, image-search bắt buộc nhưng thiếu,
hoặc cấu hình Drive/history không an toàn.
