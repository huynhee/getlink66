# Backup And Restore Guide

Tai lieu van hanh chinh:
[`docs/STORAGE_BACKUP_RUNBOOK.md`](../docs/STORAGE_BACKUP_RUNBOOK.md).

## Muc tieu

| Du lieu | Tan suat | Retention | RPO | RTO |
| --- | --- | --- | --- | --- |
| Atlas Core | Hang ngay 01:00 | 14 daily, 8 weekly, 12 monthly | 24 gio | 24 gio |
| MongoDB VPS | Hang ngay 01:30 | 14 daily, 8 weekly, 12 monthly | 24 gio | 24 gio |
| History archive | Hang ngay 02:30 | Drive archive | 24 gio | 24 gio |
| Backup verify | Hang ngay 04:00 | Cap nhat `BackupRun` | 24 gio | - |

## Lenh chuan

```bash
npm run backup:databases
npm run backup:verify
npm run storage:status
npm run restore:drill
```

Artifact database phai la `*.archive.gz.age`. VPS chi giu public recipient; private
identity giu offline va chi mount tam thoi tren restore host. Upload chi duoc xem
la thanh cong sau khi tai lai tu Drive va doi chieu SHA-256.

Restore drill phai dung `RESTORE_CORE_URI` va `RESTORE_MARKETPLACE_URI` tach biet.
Script tu choi target trung voi production, kiem tra checksum truoc/sau giai ma,
collection count va index count sau restore.

## Ket luan QA

Khong chay restore de production. Truoc moi migration phai theo thu tu:
freeze writes, backup, verify, dry-run, execute, verify, finalize.
