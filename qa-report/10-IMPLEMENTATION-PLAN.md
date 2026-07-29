# Implementation Plan

## Đã hoàn thành

1. Baseline Git, architecture và business-flow review.
2. Lint/test/build/dependency/security baseline.
3. Sửa auth revocation, admin 2FA, ban và Pro authorization.
4. Khóa IDOR download web/plugin và harden plugin release/challenge.
5. Tạo production fail-fast, CSP/HSTS và safe env examples.
6. Tách startup migration; thêm dry-run/confirm/checkpoint contract.
7. Drain getlink worker, hiển thị lỗi audit log.
8. Thêm build artifact verifier, Chromium smoke, load/memory evidence.
9. Mở rộng CI để chạy release build và smoke.
10. Xác minh Drive OAuth refresh/API bằng thao tác read-only.

## Trước staging

1. Điền production-like staging env và tách Atlas/VPS/Drive staging.
2. Cấu hình HTTPS OAuth, Turnstile, SePay sandbox, image-search provider.
3. Chọn `proxy` hoặc ký chấp nhận rủi ro `drive_redirect`.
4. Chạy migration dry-run trên snapshot staging.
5. Chạy OAuth/payment/download/getlink/plugin E2E.
6. Restore backup vào database/folder tách biệt.

## Sau staging

Chốt evidence, khắc phục mọi Critical/High mới, chạy regression, duyệt legal,
monitoring và rollback, rồi phát hành theo `18-DEPLOYMENT-GUIDE.md`.
