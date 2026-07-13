# Marketplace handoff status

Tai lieu cu da duoc thay bang implementation Drive sync V2. AI/dev tiep theo phai doc:

1. `MARKETPLACE_DATA_CONTRACT.md`.
2. `MODEL_MARKETPLACE_DEVELOPMENT.md`.
3. `MARKETPLACE_DRIVE_NAMING.md`.

## Da co trong repo

- Drive canonical metadata schema V2.
- Drive-first admin save va optimistic conflict.
- Per-folder sync API.
- Changes API queue, dedup, retry, checkpoint.
- Manual full reconciliation co resume token.
- Mongo-wins migration dry-run, backup va checkpoint.
- Computed publication blockers.
- Admin UI tach metadata Drive va state web.
- Public API serialization khong lo storage internals.
- Automated regression tests.

## Viec rollout can nguoi van hanh thuc hien

- Backup Mongo that.
- Tao OAuth refresh token co scope `https://www.googleapis.com/auth/drive`.
- Dien root/backup folder ID.
- Chay dry-run tren data production.
- Bat write flag, migrate tung batch va review backup/error.
- Chay reconciliation het root.
- Bat Changes worker sau migration.

## Phase sau, khong nam trong Drive sync V2

- Tool upload model rieng.
- Plugin 3ds Max.
- CDN/R2 neu traffic preview tang.

Khong khoi phuc automatic root scanner cu va khong them lai form Drive ID thu cong.
