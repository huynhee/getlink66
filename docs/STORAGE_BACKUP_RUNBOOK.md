# Storage, Backup And Recovery Runbook

## Data Ownership

| Layer | Source of truth |
| --- | --- |
| Atlas Core | User, Credit, Pro, payment, referral, voucher, Getlink, taxonomy, website content, plugin login, `BackupRun` |
| MongoDB VPS | Model/Scene catalog, reports, download/session/quota, Drive sync, audit, notification, cache and operational logs |
| Google Drive | Model/Scene assets, source metadata, verified history archives and encrypted database backups |

Never populate ObjectIds across databases. Store user IDs as opaque values and
taxonomy references as stable English keys.

## Production Database

```env
MONGO_CORE_URI=mongodb+srv://.../core
MONGO_MARKETPLACE_URI=mongodb://app:...@127.0.0.1:27017/marketplace?authSource=admin&replicaSet=rs0
MARKETPLACE_DB_TARGET=vps
MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED=true
```

Configure the VPS MongoDB as a single-node replica set:

```yaml
# /etc/mongod.conf
net:
  bindIp: 127.0.0.1
replication:
  replSetName: rs0
```

Restart MongoDB, then initialize once:

```bash
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
mongosh --eval 'rs.status().ok'
```

Do not expose port `27017` publicly. The backend refuses to start if `target=vps`
has no URI, resolves to Core, or lacks transaction support.

## Backup Preparation

Install Node 20, MongoDB Database Tools and `age`. Generate the encryption identity
on an offline administration machine:

```bash
age-keygen -o 3dipl-backup.agekey
```

Store the private `.agekey` offline. Put only the printed `age1...` recipient on
the VPS:

```env
DATABASE_BACKUP_DRIVE_FOLDER_ID=...
BACKUP_AGE_RECIPIENT=age1...
BACKUP_WORK_DIR=/var/lib/3dipl/backup-work
DATABASE_SCHEMA_VERSION=1
```

Use a dedicated Shared Drive backup folder. The backend account needs create,
read and delete access inside that folder, but should not manage Drive ownership.

## Backup And Verification

```bash
npm run backup:databases
npm run backup:verify
npm run storage:status
```

Each run creates `*.archive.gz.age` plus a JSON manifest. The command downloads
the uploaded artifact again and compares SHA-256 before marking it verified.
Retention keeps 14 daily, 8 weekly and 12 monthly recovery points.

These are logical per-database dumps. Atlas Free/Shared tiers do not support
`mongodump --oplog`, so run them during the lowest-write window and keep the
monthly restore drill mandatory. Provider-native point-in-time recovery requires
an Atlas tier that supports Cloud Backup.

Install timers:

```bash
sudo cp ops/systemd/3dipl-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now \
  3dipl-backup-core.timer \
  3dipl-backup-marketplace.timer \
  3dipl-history-retention.timer \
  3dipl-backup-verify.timer
systemctl list-timers '3dipl-*'
```

Set `HISTORY_RETENTION_JOB_ENABLED=false` when the systemd retention timer is
active.

## Monthly Restore Drill

Run on an isolated restore host with the offline identity mounted temporarily:

```env
RESTORE_CORE_URI=mongodb://127.0.0.1:27018/core-drill
RESTORE_MARKETPLACE_URI=mongodb://127.0.0.1:27018/marketplace-drill
BACKUP_AGE_IDENTITY_FILE=/secure/3dipl-backup.agekey
RESTORE_CONFIRM=isolated-drill
```

```bash
npm run restore:drill
```

The script rejects production database identities, verifies encrypted and
decrypted checksums, restores only to drill databases, then checks collection
counts and indexes.

## Split Migration

Run `backup:databases`, `backup:verify`, then `data:split:dry-run`. Enter
maintenance mode and export:

```bash
MIGRATION_WRITES_FROZEN=true
MIGRATION_BACKUP_VERIFIED_AT=2026-07-29T01:30:00Z
```

Run `data:split:execute`, verify counts/indexes and smoke tests, then set
`MIGRATION_CONFIRM=split-marketplace-data` for `data:split:finalize`. Never
finalize before verification.

## Retention And Incidents

- Getlink sensitive URLs: purge one day after redownload expiry.
- Getlink, downloads, closed reports and AuditLog: archive after 365 days.
- SystemLog: TTL 30 days. DownloadSession: expiry plus 7 days. Daily quota: 45 days.
- Mongo records are deleted only after Drive checksum verification.

Apply the approved one-year defaults once:

```bash
npm run storage:retention:dry-run
STORAGE_RETENTION_CONFIRM=apply-365-day-policy npm run storage:retention:apply
```

If the VPS is lost: disable marketplace writes, provision `rs0`, restore the
latest verified backup, recreate indexes, run Drive reconciliation and search
backfill, recalculate download counts, smoke test, then reopen traffic. Target
RPO/RTO is 24 hours.

Telegram alerts cover stale backup, 70/85/95% capacity, database/replica failure,
Drive errors, archive errors and stuck Drive polling. At 85% capacity, the monitor
may run verified history retention; it never deletes financial data.

Google Drive remains a provider-level single point of failure. Separate Shared
Drive permissions reduce accidental deletion but do not replace an independent
second provider.
