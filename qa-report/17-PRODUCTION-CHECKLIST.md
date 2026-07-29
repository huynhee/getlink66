# Production Checklist

Ký hiệu: `[x]` pass, `[ ]` chưa làm, `[!]` rủi ro, `[-]` không áp dụng.

## Code

- [x] Lint pass.
- [-] Type check: codebase JavaScript, không có TypeScript/typecheck script.
- [x] Backend test 139/139.
- [x] Production build sạch và artifact verifier pass.
- [x] Không Critical/High code defect đã biết.
- [x] Không localhost/secret/source map trong build.
- [!] JS bundle vượt cảnh báo 500 kB.
- [ ] Changelog/release commit được duyệt.

## Database

- [x] Migration dry-run memory và confirmation guard.
- [x] Unique/idempotency tests quan trọng.
- [ ] `MONGO_MARKETPLACE_URI` replica set production.
- [ ] Snapshot trước deploy.
- [ ] Dry-run/verify trên staging snapshot.
- [ ] Restore drill.

## Security

- [x] Backend authorization, CSRF, CORS, CSP/HSTS, session revocation.
- [x] Admin 2FA fail-closed trong code.
- [x] Plugin Bearer/challenge/manifest gates.
- [ ] HTTPS/OAuth callback/Turnstile production khớp domain.
- [ ] Cloudflare proxy, WAF/rate rules và firewall.
- [ ] Secret rotation và plugin public-key verification.

## Payment và Credit

- [x] Server-side amount/status và idempotency tests.
- [x] Không cấp quyền qua frontend redirect.
- [ ] SePay sandbox E2E và reconciliation.
- [ ] Webhook production URL/secret/currency xác nhận.

## Getlink và Marketplace

- [x] Persistent job, claim, retry, drain và owner checks.
- [x] Free/Pro/quota enforcement ở backend.
- [x] Drive OAuth refresh/API read-only.
- [ ] Getlink upstream staging với file hợp lệ/lỗi.
- [ ] Turnstile + Drive download end-to-end.
- [!] Một backend replica cho đến khi có distributed lock.

## Infrastructure và Vận hành

- [ ] Docker image build trên Linux runner.
- [ ] Nginx/TLS/DNS/firewall xác minh.
- [ ] Monitoring, alert, log rotation và uptime probe.
- [ ] Backup automation/restore.
- [ ] Post-deploy smoke owner và rollback approver.

## User/Legal

- [x] Desktop/mobile smoke cơ bản.
- [ ] 404/500/SEO metadata review production.
- [ ] Điều khoản, privacy, payment/refund/copyright/contact được chủ site duyệt.

**Release gate: NOT READY.**
