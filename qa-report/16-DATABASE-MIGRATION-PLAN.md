# Database Migration Plan

## Nguyên tắc

- Backup Atlas và VPS trước migration; restore thử trên target tách biệt.
- `dry-run -> review counts -> execute có confirm -> verify`.
- Additive/backward-compatible trước; cleanup/drop ở release sau.
- Không chạy migration trong backend startup production.

## Asset Migration

```powershell
npm.cmd run marketplace:asset:dry-run
$env:MIGRATION_CONFIRM='marketplace-asset-v1'
npm.cmd run marketplace:asset:execute
Remove-Item Env:MIGRATION_CONFIRM
```

Script mặc định dry-run. Execute thiếu exact confirmation phải fail. Dùng batch,
checkpoint và idempotent update; không đổi Drive khi nội dung không thay đổi.
`--memory` chỉ dành regression và đã pass với zero records.

## Thứ tự Staging

1. Snapshot Atlas/VPS và manifest Drive.
2. Kiểm tra replica set/transaction trên marketplace VPS.
3. Dry-run taxonomy/search/assets; lưu counts và sample diff.
4. Execute trên staging, verify index/unique constraints.
5. Chạy API/search/download regression.
6. Lấy Changes start token sau migration.

## Rollback

Ưu tiên forward-fix vì migration additive. Nếu dữ liệu sai, dừng worker/write,
khôi phục snapshot vào DB mới, đổi URI sau kiểm tra và giữ DB lỗi để điều tra.
Không tự drop collection hay overwrite production snapshot.
