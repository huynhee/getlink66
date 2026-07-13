# Marketplace model data contract V2

Tai lieu nay la source of truth cho marketplace model. Moi thay doi cua upload tool,
backend, admin, web va plugin 3ds Max phai tuan theo contract nay.

```text
upload tool -> Google Drive -> sync-folder / Changes API -> MongoDB index -> web/plugin
```

## 1. Nguyen tac bat bien

1. Google Drive la canonical source cho metadata va asset model.
2. MongoDB la catalog index va noi luu du lieu van hanh, khong phai ban sao file.
3. Admin ghi metadata len Drive thanh cong va doc xac nhan xong moi cap nhat Mongo.
4. Mot model thay doi chi sync folder cua model do.
5. Changes API phat hien thay doi thu cong. Full reconciliation chi chay khi admin yeu cau.
6. Web va plugin khong nhan Drive ID, Drive URL, metadata hash hay storage key.
7. Public slug va `desiredPublished` khong bi Drive rescan ghi de.
8. Metadata chi nhan controlled vocabulary trong source code.

## 2. Data ownership

### Google Drive owns

- `metadata.json.gz`.
- `model.zip`, `model.rar` hoac `model.7z`.
- `cover.jpg`, `cover.jpeg` hoac `cover.png`.
- `preview-01.jpg`, `preview-02.png`, ...
- `model.sha256` neu upload tool tao file checksum rieng.
- Drive file version, modified time va parent relationship.

Metadata Drive owns:

- `sourceModelId`, `title`, `sourceCategoryId`.
- `accessType`: `free` hoac `member` (UI hien thi `member` la Pro).
- `renderer`, `styles`, `renderers`, `forms`, `colors`, `materials`.
- SHA-256 cua archive.

### MongoDB owns

- Public `slug`.
- `desiredPublished`.
- `isPublished` da tinh.
- `publicationBlockers` va `syncStatus`.
- User, Pro, quota, payment, download session, history va audit.
- Catalog index nhe de list/search/filter.
- Drive references noi bo de backend stream file.
- Download count va cac moc thoi gian van hanh.

### Upload tool owns (phase sau)

- Validate va upload dung folder/file naming.
- Tao metadata V2 va checksum.
- Upload xong goi `POST /api/admin/marketplace/drive/sync-folder`.
- Khong ghi Mongo truc tiep.

### Web/plugin owns

- Chi goi public catalog va download-session API.
- Preview qua backend proxy.
- Plugin verify checksum, giai nen va merge `.max` sau khi tai.

## 3. Folder va file naming

```text
/3dipl/models/
  /{sourceModelId}-{slug}/
    metadata.json.gz
    model.zip
    model.sha256
    cover.jpg
    preview-01.jpg
    preview-02.png
```

Folder cu `{sourceModelId}.{hash}` van doc duoc de migration. Folder moi nen dung
`{sourceModelId}-{slug}`.

Required de model online:

- Metadata hop le.
- Mot archive hop le.
- Mot cover hop le.
- Leaf category va du filter bat buoc.

Preview phu la optional. Xoa preview phu khong lam model offline.

Allowed archive extensions: `zip`, `rar`, `7z`.

Allowed image extensions: `jpg`, `jpeg`, `png`.

`metadata.json.gz` toi da 256 KB sau khi giai nen.

## 4. Metadata schema V2

Canonical JSON truoc khi gzip:

```json
{
  "schemaVersion": 2,
  "revision": 1,
  "updatedAt": "2026-07-13T00:00:00.000Z",
  "sourceModelId": "6373049",
  "title": "Outdoor Kitchen 145",
  "sourceCategoryId": "256",
  "accessType": "member",
  "renderer": "Corona",
  "styles": ["modern"],
  "renderers": ["corona"],
  "forms": ["rectangle"],
  "colors": ["black"],
  "materials": ["metal"],
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

Field rules:

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion` | Yes | Luon la `2` khi backend ghi |
| `revision` | Yes | Integer tang 1 sau moi lan save |
| `updatedAt` | Yes | ISO-8601 UTC do backend tao |
| `sourceModelId` | Yes | Opaque stable ID, max 80 chars |
| `title` | Yes | Max 200 chars |
| `sourceCategoryId` | Yes | Phai map den leaf category |
| `accessType` | Yes | `free` hoac `member`; legacy `pro` normalize thanh `member` |
| `renderer` | No | Label hien thi, max 80 chars |
| `styles` | Yes | Controlled vocabulary `style` |
| `renderers` | Yes | Controlled vocabulary `render` |
| `forms` | Yes | Controlled vocabulary `form` |
| `colors` | Yes | Controlled vocabulary `color` |
| `materials` | Yes | Controlled vocabulary `material` |
| `sha256` | Recommended | Dung 64 lowercase hex chars |

Khong co `sourceSlug`, `sizeText`, `description`, `tags`, URL nguon, format,
3ds Max version, polygon count, Drive ID hoac raw payload trong schema V2.

Dung luong hien thi lay tu `fileSize` cua archive tren Drive. Public slug thuoc Mongo.

## 5. Controlled vocabulary

Source of truth:

- Categories: `backend/src/data/marketplaceCategories.js`.
- Filters: `backend/src/data/marketplaceFilters.js`.

Allowed values hien tai:

- `style`: `classic`, `modern`, `ethnic`.
- `render`: `vray`, `corona`, `standard`.
- `form`: `round`, `oval`, `square`, `rectangle`, `triangle`, `diamond`,
  `pentagon`, `star`, `angle`, `bioform`.
- `color`: `white`, `gray`, `black`, `brown`, `red`, `orange`, `yellow`,
  `beige`, `pink`, `magenta`, `purple`, `blue`, `sky`, `cyan`, `lime`, `green`.
- `material`: `brick`, `ceramics`, `concrete`, `fabric`, `fur`, `glass`,
  `gypsum`, `leather`, `liquid`, `metal`, `organics`, `paper`, `plastic`,
  `rattan`, `stone`, `wood`.

Value la English system key. UI co the dich label sang tieng Viet.

## 6. Mongo catalog index

`MarketplaceModel` luu cac nhom field sau:

### Identity va public state

- `_id`, `slug`, `title`.
- `source.provider`, `source.modelId`, `source.slug`, `source.categoryId`.
- `metadataSourceModelId`.
- `desiredPublished`, `isPublished`, `publicationBlockers`.

### Search/filter index

- `categoryId`, `parentCategoryId`, `categorySourceId`.
- `styles`, `renderers`, `forms`, `colors`, `materials`, `renderer`.
- `accessType`, `metadataStatus`, `metadataMissingFields`.

### Storage references

- `driveFolderId`, `driveFolderName`, `driveSignature`.
- `driveFileId`, `archiveExt`, `fileSize`, `sha256`, `fileStatus`.
- `coverImage`, `previewImages`.
- `metadataDriveFileId`, `metadataFileName`, `metadataSize`.

### Sync state

- `metadataHash`, `metadataRevision`, `metadataDriveVersion`,
  `metadataModifiedTime`.
- `syncStatus`, `syncError`.
- `lastDriveScanAt`, `lastDriveChangeAt`.

Mongo khong luu binary, raw JSON, public Drive URL, external source URL,
description, tags, format/version/polygon hoac model credit price.

## 7. Publication state machine

```text
isPublished = desiredPublished && publicationBlockers.length === 0
```

Required blockers:

- `metadata_file`: metadata thieu/khong doc duoc.
- `archive`: file nen thieu.
- `cover`: cover thieu.
- `category`: category khong ton tai hoac khong phai leaf.
- `style`, `render`, `form`, `color`, `material`: metadata thieu/invalid.

Rules:

- Admin unpublish dat `desiredPublished=false`; rescan khong duoc tu bat lai.
- Admin publish dat `desiredPublished=true`; model chi online khi khong co blocker.
- Model moi du du lieu co `desiredPublished=true` va tu online.
- Mat archive/cover/metadata se offline nhung record/history van con.
- Khoi phuc required file se online lai neu `desiredPublished=true`.
- Mat preview phu chi cap nhat `previewImages`.

## 8. Per-model sync

Central service:

`backend/src/utils/marketplaceDriveService.js`

`syncMarketplaceDriveFolder({ driveFolderId, force })`:

1. Doc metadata cua folder model.
2. List file con cua duy nhat folder do.
3. Chon metadata/archive/cover/preview theo naming.
4. Validate schema/category/vocabulary.
5. Tinh signature, blockers, storage refs va sync state.
6. Upsert dung mot `MarketplaceModel`.
7. Giu public slug va manual unpublish.

Upload/sua mot model khong goi root scan.

`force=false` bo qua read metadata khi Drive signature khong doi. `force=true`
doc lai folder, dung cho admin save, Changes worker va upload tool callback.

## 9. Admin metadata write va conflict

Endpoint:

```http
PUT /api/admin/marketplace/models/:id/metadata
```

Request:

```json
{
  "metadata": { "title": "..." },
  "expectedMetadataHash": "...",
  "expectedDriveVersion": "..."
}
```

Write order bat buoc:

1. List folder va doc metadata Drive moi nhat.
2. So `expectedMetadataHash` va `expectedDriveVersion`.
3. Validate canonical metadata.
4. Tang revision, gzip va `files.update` giu nguyen Drive file ID.
5. Neu chua co metadata, tao `metadata.json.gz` trong folder model.
6. Doc lai file vua ghi va verify hash.
7. Sync dung folder do vao Mongo.

Drive write fail thi Mongo catalog khong doi.

Neu hash/version khac, API tra:

```json
{
  "code": "METADATA_CONFLICT",
  "current": {
    "metadata": {},
    "metadataHash": "...",
    "driveVersion": "..."
  },
  "diff": [
    { "field": "title", "before": "Admin edit", "after": "Drive edit" }
  ]
}
```

Admin phai nap ban Drive moi nhat vao form va bam save lai. Khong co
last-write-wins hoac force overwrite ngam.

Operational state dung endpoint rieng:

```http
PATCH /api/admin/marketplace/models/:id/state
```

Chi nhan `slug` va `desiredPublished` (legacy `isPublished` duoc map thanh y dinh).

## 10. Changes API worker

Worker:

`backend/src/utils/marketplaceDriveSyncJob.js`

- Poll mac dinh 120 giay.
- Doc toi da 100 change moi page.
- Map file change ve `driveFolderId` qua parent hoac Drive ref trong Mongo.
- Upsert `MarketplaceDriveChange` theo `(rootFolderId, driveFolderId)`.
- Nhieu file change trong cung folder chi tao mot queue item.
- Xu ly toi da 20 folder moi batch.
- Retry toi da 8 lan, exponential backoff.
- Moi enqueue tang `generation`; change den trong luc folder dang sync duoc giu lai cho pass ke tiep.
- Queue item `processing` qua 15 phut duoc coi la stale va co the claim lai.
- State lock ngan hai backend instance poll cung token.
- Changes token chi advance sau khi enqueue xong page.
- Worker loi khong lam mat token; page co the doc lai va queue van deduplicate.

`MarketplaceDriveSyncState.changesPageToken` khac token reconciliation.

Worker root scan cu da tat. `MARKETPLACE_DRIVE_SYNC_ENABLED` khong con duoc dung.

## 11. Manual reconciliation va migration

### Reconciliation

```http
POST /api/admin/marketplace/drive/reconcile
```

Full scan la thao tac khoi phuc/doi soat manual. API luu checkpoint page token
trong `MarketplaceDriveSyncState` de co the resume. Khong co timer tu dong goi API nay.

### Migration Mongo-wins lan dau

```http
POST /api/admin/marketplace/drive/migrate-metadata
```

- `dryRun=true`: inspect batch, khong ghi.
- `dryRun=false`: tao `.jsonl.gz` backup metadata Drive cu truoc khi ghi.
- Metadata compact Mongo hien tai duoc chuyen thanh schema V2.
- Chi ghi file co diff, thieu metadata hoac schema cu.
- Doc xac nhan va sync sau tung write.
- Checkpoint page duoc luu trong sync state.
- Batch co model loi giu nguyen checkpoint de admin sua va retry.
- `desiredPublished` duoc backfill tu `isPublished` trong migration write.
- Trong luc migration dang chay hoac dang loi, metadata edit, attach, reconcile va Changes worker tra `423 MARKETPLACE_MIGRATION_LOCKED`.
- Migration complete xoa Changes token cu de worker lay start token moi sau full reconciliation.

Thu tu rollout:

1. Backup Mongo.
2. Tat upload/admin metadata edit.
3. De `MARKETPLACE_DRIVE_WRITE_ENABLED=false` va
   `MARKETPLACE_DRIVE_CHANGES_ENABLED=false`.
4. Chay migration dry-run.
5. Cap OAuth refresh token scope `https://www.googleapis.com/auth/drive`.
6. Bat Drive write, migration tung batch va review backup/error.
7. Chay manual reconciliation het root.
8. Bat Changes worker; lan dau worker lay start token sau migration.
9. Mo lai admin edit/upload.

Rollback: tat hai feature flag. Mongo backup va Drive metadata backup van duoc giu.

## 12. API contract

Admin write routes:

```text
PUT   /api/admin/marketplace/models/:id/metadata
PATCH /api/admin/marketplace/models/:id/state
POST  /api/admin/marketplace/drive/sync-folder
POST  /api/admin/marketplace/drive/reconcile
POST  /api/admin/marketplace/drive/migrate-metadata
POST  /api/admin/marketplace/sync-run
```

Compatibility routes `attach-file` va `attach-assets` van ton tai cho migration.
Neu model da co `driveFolderId`, backend verify tat ca file thuoc dung parent folder
roi sync folder; admin UI khong hien form Drive ID nua.

Public routes:

```text
GET  /api/marketplace/categories
GET  /api/marketplace/filters
GET  /api/marketplace/models
GET  /api/marketplace/models/:slug
GET  /api/marketplace/models/:id/cover
GET  /api/marketplace/models/:id/preview/:index
POST /api/marketplace/models/:id/download-session
```

Public JSON chi tra URL proxy anh. Khong tra Drive ID, metadata hash/version,
folder ID hoac storage link.

## 13. Environment

```dotenv
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
GOOGLE_DRIVE_ACCESS_TOKEN=
MARKETPLACE_DRIVE_ROOT_FOLDER_ID=
MARKETPLACE_DRIVE_BACKUP_FOLDER_ID=
MARKETPLACE_DRIVE_WRITE_ENABLED=false
MARKETPLACE_DRIVE_CHANGES_ENABLED=false
MARKETPLACE_DRIVE_CHANGES_POLL_SECONDS=120
MARKETPLACE_DRIVE_CHANGES_BATCH_SIZE=100
MARKETPLACE_DRIVE_QUEUE_BATCH_SIZE=20
MARKETPLACE_DRIVE_QUEUE_MAX_ATTEMPTS=8
MARKETPLACE_DRIVE_QUEUE_RETRY_BASE_SECONDS=30
```

Production dung refresh token. Access token tinh chi phu hop test ngan han.

## 14. Code map

- Metadata normalize/hash/diff: `backend/src/utils/marketplaceMetadata.js`.
- Drive read/write/Changes client: `backend/src/utils/storageProvider.js`.
- Folder sync/write conflict: `backend/src/utils/marketplaceDriveService.js`.
- Changes queue worker: `backend/src/utils/marketplaceDriveSyncJob.js`.
- Catalog schema: `backend/src/models/MarketplaceModel.js`.
- Queue schema: `backend/src/models/MarketplaceDriveChange.js`.
- Token/checkpoint schema: `backend/src/models/MarketplaceDriveSyncState.js`.
- Admin API: `backend/src/controllers/marketplaceAdminController.js`.
- Admin UI: `frontend/src/components/AdminMarketplace.jsx`.
- Regression tests: `backend/test/marketplace-drive-sync.test.js`.
