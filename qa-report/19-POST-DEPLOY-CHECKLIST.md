# Post-deploy Checklist

## 0-10 Phút

- [ ] Frontend `/`, `/models`, `/scenes`, `/topup` trả 200 qua HTTPS.
- [ ] `/health` 200; `/ready` 200; container health healthy.
- [ ] Không restart loop, 5xx spike hoặc CSP/CORS error.
- [ ] Security headers và cookie Secure/HttpOnly/SameSite đúng.
- [ ] OAuth login/logout; token cũ sau logout bị từ chối.
- [ ] Admin yêu cầu 2FA và user thường không gọi API admin.

## Business Smoke

- [ ] Search/filter/sort Model và Scene.
- [ ] Preview proxy, gallery và Turnstile trên Free/Pro.
- [ ] Free không tải Pro; Model -1, Scene -5; session owner đúng.
- [ ] Plugin device login, challenge, manifest và tải test.
- [ ] Getlink test job giữ trạng thái qua reload, completion không double-charge.
- [ ] SePay sandbox approve một lần; duplicate IPN không cộng lại.
- [ ] Voucher/referral/admin credit có ledger và audit.

## Data và External Services

- [ ] Atlas Core và VPS đúng database, transaction hoạt động.
- [ ] Drive preview/download/sync-folder và Changes worker.
- [ ] Image search provider và fallback text search.
- [ ] Worker heartbeat/backlog/retention; không duplicate.
- [ ] Audit/SystemLog không chứa token, cookie hoặc Drive URL.

## 30-60 Phút

- [ ] p95, 5xx, CPU, RSS, heap, disk và Mongo pool trong ngưỡng.
- [ ] Reconcile payment amount/order/receipt/credit.
- [ ] Uptime và alerts gửi được tới owner.
- [ ] Ghi release SHA/image digest và người xác nhận.
- [ ] Không có blocker thì đóng change; nếu có, theo rollback plan.
