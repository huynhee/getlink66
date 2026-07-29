# Manual Actions

Các việc chủ hệ thống/infra phải hoàn thành trước production:

1. Cấp staging domain HTTPS, Atlas/VPS/Drive folder và account test tách biệt.
2. Cấu hình `MONGO_MARKETPLACE_URI` replica set; xác nhận transaction.
3. Tắt toàn bộ dev login/mock; bật admin 2FA và enroll admin.
4. Cập nhật Google OAuth callback/origin HTTPS cho staging và `3dipl.org`.
5. Cấu hình Turnstile hostname/action/site-secret thật và Cloudflare proxy/WAF.
6. Chọn `MARKETPLACE_DOWNLOAD_DELIVERY=proxy` hoặc ký chấp nhận rủi ro redirect.
7. Bật Drive write cho retention/sync; kiểm tra quyền Editor và backup folders.
8. Cấu hình image-search HTTPS provider/API key hoặc tắt/hide tính năng có chủ ý.
9. Cấu hình SePay sandbox, webhook secret/URL và chạy duplicate/reconciliation.
10. Nếu bật plugin: ký installer/manifest, pin public key, điền release checksum,
    signature, version và activation URL.
11. Build/scan hai Docker image trên Linux CI; repo local không có Docker CLI.
12. Tạo top-level reverse proxy route `/api` -> backend, còn lại -> frontend.
13. Chạy đúng một backend replica; chưa scale ngang.
14. Thiết lập uptime, metrics, log rotation, alerts và người trực.
15. Tạo backup Atlas/VPS/Drive/config và restore thử vào môi trường riêng.
16. Review nội dung Terms, Privacy, Payment, Refund, Download, Copyright, Contact.
17. Chạy toàn bộ staging smoke và ký duyệt evidence.

Production `env:check` hiện fail 11 lỗi; không bypass hoặc đổi thành warning.
