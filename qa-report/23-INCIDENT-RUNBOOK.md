# Incident Runbook

## Quy trình chung

1. Gán severity và incident commander.
2. Giảm tác động: ngắt traffic/write/worker phù hợp.
3. Giữ log, request ID, image SHA và snapshot; redact secret.
4. Khôi phục theo runbook, verify, theo dõi và postmortem.

## Website/Database Down

- Kiểm tra Cloudflare, TLS, reverse proxy, container health, `/health`, `/ready`.
- Nếu DB down: dừng worker/write, kiểm tra Atlas/VPS status/pool/disk/replication.
- Không đổi URI sang DB không xác minh. Failover/restore theo provider runbook.

## Worker/Queue/Getlink

- Kiểm tra active/stale heartbeat, processing age và restart count.
- Dừng tạo job mới nếu duplicate hoặc backlog tăng.
- Cho active job drain; reclaim chỉ qua atomic worker logic.
- Không sửa credit trực tiếp; reconcile history/job/ledger trước.

## Payment/Credit

- Tạm khóa approve/manual credit nếu duplicate hoặc amount mismatch.
- Đối chiếu gateway transaction, PaymentReceipt, order và ledger.
- Không replay payload thiếu signature; không cấp quyền từ success redirect.
- Correction cần dual approval và AuditLog.

## Download/Storage/Security

- Unauthorized download: unpublish asset, revoke session, chuyển delivery proxy,
  bảo toàn logs và đánh giá rotate Drive/crypto secret.
- Drive mất file: khóa tải, không xóa catalog/history; restore từ version/backup.
- Secret lộ: revoke/rotate theo thứ tự, invalidate sessions, audit access.
- Admin compromise: ban/revoke session, reset OAuth/TOTP, review AuditLog.

## Resource Saturation/Attack

CPU/RAM/disk cao: loại instance khỏi upstream, giữ dump/metrics, kiểm tra queue,
temp/log và slow query. Traffic bất thường: Cloudflare WAF/rate limit/challenge,
không tự chạy phản công hoặc brute-force.

Sau mọi incident, chạy regression liên quan và cập nhật alert/runbook.
