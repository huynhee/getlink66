# Rollback Plan

## Trigger

Rollback ngay khi có unauthorized Pro download/IDOR, payment hoặc credit sai,
duplicate worker, data corruption, restart loop, `/ready` không ổn định, 5xx cao,
RAM tăng không kiểm soát hoặc secret/Drive URL bị lộ.

## Quyền quyết định

Incident commander hoặc release owner phê duyệt. Security/payment incident không
đợi đủ change window; ưu tiên ngắt traffic và bảo toàn evidence.

## Code Rollback

1. Dừng mở traffic, giữ container lỗi và logs read-only.
2. Đổi reverse proxy về image digest/SHA trước release.
3. Giữ termination grace 45 giây để drain getlink.
4. Rollback frontend sau backend nếu API compatibility cho phép.
5. Verify `/health`, `/ready`, login và read-only catalog.

## Data

Migration release này phải additive; không drop index/collection khi rollback.
Nếu schema mới vẫn tương thích, rollback code và forward-fix. Nếu dữ liệu sai:

1. Tắt write/admin/worker.
2. Restore snapshot vào database mới, không overwrite tại chỗ.
3. Verify counts, payment receipt, credit ledger và sample ownership.
4. Đổi URI sau approval.

Không tự downgrade approved payment hoặc trừ credit hàng loạt. Reconcile thủ công
có audit riêng.

## Jobs và Storage

Để job processing drain; job stale sẽ được reclaim bởi bản ổn định. Tạm tắt Drive
Changes/write nếu lỗi sync. Không xóa folder/file; restore từ trash/backup sau khi
đối chiếu manifest.

## Sau Rollback

Chạy post-deploy read-only smoke, đối soát pending payment/getlink/download, rotate
secret nếu cần và mở postmortem trong 24 giờ.
