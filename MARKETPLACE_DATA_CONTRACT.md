# Marketplace Model & Scene data contract V3

Tai lieu nay la source of truth cho marketplace Model va Scene. Moi thay doi cua upload tool,
backend, admin, web va plugin 3ds Max phai tuan theo contract nay.

```text
upload tool -> Google Drive -> sync-folder / Changes API -> MongoDB index -> web/plugin
```

## 1. Nguyen tac bat bien

1. Google Drive la canonical source cho metadata va asset model.
2. Atlas Core va MongoDB VPS co ownership rieng; khong co populate/ObjectId join cheo database.
3. Admin ghi metadata len Drive thanh cong va doc xac nhan xong moi cap nhat Mongo.
4. Mot model thay doi chi sync folder cua model do.
5. Changes API phat hien thay doi thu cong. Full reconciliation chi chay khi admin yeu cau.
6. Web va plugin khong nhan Drive ID, Drive URL, metadata hash hay storage key.
7. Public slug va `desiredPublished` khong bi Drive rescan ghi de.
8. Metadata chi nhan controlled vocabulary dang active trong taxonomy Atlas.

## 2. Data ownership

### Google Drive owns

- `metadata.json.gz`.
- `model.zip`, `model.rar` hoac `model.7z`.
- `cover.jpg`, `cover.jpeg` hoac `cover.png`.
- `preview-01.jpg`, `preview-02.png`, ...
- `model.sha256` neu upload tool tao file checksum rieng.
- Drive file version, modified time va parent relationship.
- History archive da verify checksum.
- Backup Atlas/VPS da ma hoa bang `age` kem manifest SHA-256.

Metadata Drive owns:

- `sourceModelId`, `title`, `sourceCategoryId`.
- `accessType`: `free` hoac `member` (UI hien thi `member` la Pro).
- `renderer`, `styles`, `renderers`, `forms`, `colors`, `materials`.
- SHA-256 cua archive.

### Atlas Core owns

- User, Credit, Pro, payment, referral, voucher va Getlink.
- Site settings va GuideArticle.
- `MarketplaceCategory` va `MarketplaceFilterOption` la taxonomy chuan.
- `BackupRun` chi luu trang thai nho; Drive manifest moi la nguon phuc hoi doc lap.

### MongoDB VPS owns

- `MarketplaceModel`, public `slug`, `desiredPublished`, `isPublished` va sync state.
- Quota, download session, marketplace download history, bao loi tai nguyen va cumulative `downloadCount`.
- Drive queue/state, product cache, system log, audit va notification.
- Drive references noi bo de backend cap file/preview; public API khong tra cac field nay.
- `MarketplaceReport` da dong, `AuditLog` va download history duoc archive sau 365 ngay.

### Upload tool owns (phase sau)

- Validate va upload dung folder/file naming.
- Tao metadata V2 va checksum.
- Upload xong goi `POST /api/admin/marketplace/drive/sync-folder`.
- Khong ghi Mongo truc tiep.

### Web/plugin owns

- Chi goi public catalog va download-session API.
- Preview qua backend proxy.
- Plugin verify checksum, giai nen va merge `.max` sau khi tai.
- Web xac minh Turnstile truoc khi tao download session. Backend goi Siteverify;
  token het han sau 5 phut, chi dung mot lan va khong ap dung cho route plugin.
- O che do `drive_redirect`, JSON model/session van chi tra URL noi bo. Endpoint file
  tra HTTP 302 den Drive `webContentLink`; archive chua public se fallback ve proxy.

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
| `styles` | No | Controlled vocabulary `style`; de `[]` neu chua co du lieu |
| `renderers` | No | Controlled vocabulary `render`; de `[]` neu chua co du lieu |
| `forms` | No | Controlled vocabulary `form`; de `[]` neu chua co du lieu |
| `colors` | No | Controlled vocabulary `color`; de `[]` neu chua co du lieu |
| `materials` | No | Controlled vocabulary `material`; de `[]` neu chua co du lieu |
| `sha256` | Recommended | Dung 64 lowercase hex chars |

Khong co `sourceSlug`, `sizeText`, `description`, `tags`, URL nguon, format,
3ds Max version, polygon count, Drive ID hoac raw payload trong schema V2.

Dung luong hien thi lay tu `fileSize` cua archive tren Drive. Public slug thuoc Mongo.
Facet de trong khong chan publish. Khi user loc theo mot facet, model co mang facet
rong khong khop truy van va khong xuat hien trong ket qua do.

## 5. Controlled vocabulary

Runtime source of truth la Atlas:

- Categories: collection `MarketplaceCategory`.
- Filters: collection `MarketplaceFilterOption`.
- `backend/src/data/marketplaceCategories.js`, `marketplaceFilters.js` va
  `marketplaceCatalogs.js` chi la seed/migration co kiem soat, khong ghi de nhan admin da sua.

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

- `categorySourceId`, `parentCategorySourceId` (English stable key, khong phai ObjectId Atlas).
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

## 6.1 Catalog chung va phan biet tai nguyen

- Collection van la `MarketplaceModel` de giu tuong thich references cu.
- `assetType=model|scene` phan biet hai catalog; record cu khong co field nay duoc migrate thanh `model`.
- Identity duy nhat: `{ assetType, source.provider, source.assetId }`.
- Public slug duy nhat trong tung catalog: `{ assetType, slug }`.
- API Model luon loc Model; API Scene luon loc Scene. Search va recommendation khong tron hai namespace.
- Download session, download log, Drive change va Drive sync state deu luu `assetType`.
- `quotaCost`: Model = 1, Scene = 5. `quotaCharged` duoc giu de tuong thich lich su cu.

## 6.2 Scene metadata V3

```json
{
  "schemaVersion": 3,
  "assetType": "scene",
  "revision": 1,
  "updatedAt": "2026-07-14T00:00:00.000Z",
  "sourceAssetId": "scene-000001",
  "title": "Modern Living Room",
  "sourceCategoryId": "living-room",
  "accessType": "member",
  "renderer": "Corona",
  "renderers": ["corona"],
  "styles": ["modern"],
  "sha256": "64_lowercase_hex_chars"
}
```

Scene bat buoc ID, title, leaf category, Free/Pro va SHA-256. Renderer va style co
the de trong; neu co gia tri thi van phai dung controlled vocabulary.
Scene khong dung `forms`, `colors` hoac `materials`. Model tiep tuc dung schema V2;
backend khong migration hang loat metadata Model sang V3.

Scene Drive root:

```text
/3dipl/scenes/{sourceAssetId}-{slug}/
  metadata.json.gz
  scene.zip | scene.rar | scene.7z
  cover.jpg
  preview-01.jpg
  preview-02.jpg
  preview-03.png
```

`cover.jpg` la cover vuong va bat buoc. `preview-01` giu anh preview nguon dau tien va
khong bi crop thanh cover. Archive, metadata, cover hoac preview-01 thieu se khoa
tai va offline Scene. Preview tu so 02 tro di la optional. Backend van doc duoc
ten cu `preview-1`, nhung tool upload moi phai xuat ten co hai chu so.

Scene category va filter source of truth:

- Categories/Style/Render: `backend/src/data/marketplaceCatalogs.js`.
- Category co con bat buoc gan leaf category.
- System key dung English; UI co nhan Viet/Anh.

## 6.3 Quota chung

- Chua dang nhap: chi duoc xem catalog, khong duoc tao download session.
- Free: tu dong ap dung sau khi dang nhap, 5 luot/ngay.
- Pro: `proDailyDownloadLimit`, mac dinh 100 luot/ngay.
- Admin: khong tru quota.
- Model tru 1; Scene tru 5. Quota bonus cua goi ngay duoc cong vao cung record.
- Chi co hai quyen public la Free va Pro. Gia tri `guest` trong session/log chi duoc giu de doc lich su cu, khong duoc tao moi.
- Backend lay cost tu `assetType`, khong tin `quotaCost` client gui.
- Tang quota la atomic theo dieu kien `count + cost <= limit`.
- Loi sau khi charge phai rollback dung cost; tai lai cung download session trong TTL khong charge lai.
- Image search quota Free 10/Pro 150 dung chung giua Model va Scene.

## 6.4 API Scene

Public catalog nam tai `/api/marketplace/scenes`; plugin session nam tai
`POST /api/plugin/scenes/:id/download-session`. Admin Scene nam tai
`/api/admin/marketplace/scenes`. Response public chi tra internal image/download URL,
khong tra Drive ID, metadata hash, storage key hoac Drive URL.

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
GOOGLE_DRIVE_OAUTH_REDIRECT_URI=http://127.0.0.1:53682/oauth2/callback
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
MARKETPLACE_DOWNLOAD_DELIVERY=drive_redirect
MARKETPLACE_DOWNLOAD_REDIRECT_FALLBACK_PROXY=true
TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
TURNSTILE_EXPECTED_HOSTNAME=3dipl.org
TURNSTILE_EXPECTED_ACTION=marketplace_download
```

Production dung refresh token. Access token tinh chi phu hop test ngan han. Tao refresh
token bang `npm run drive:auth`, khoi dong lai backend va xac minh bang
`npm run drive:check`. OAuth Consent Screen phai o `In production`; trang thai `Testing`
lam refresh token co Drive scope het han sau 7 ngay.

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
## 13. Search and recommendation discovery

Current production engine is `mongo_hybrid_v3` on the marketplace VPS. Qdrant and
heavy embedding models are not required in this phase.

- Atlas taxonomy owns Vietnamese/English labels and aliases; system keys stay English.
- `MarketplaceModel.searchTitle` stores title, slug and accent-free variants.
- `searchTaxonomy` stores parent/child category and assigned facet labels/aliases.
- `searchTokens` stores normalized searchable tokens and compact multi-word aliases.
- Mongo text weights are `searchTitle=10`, `searchTaxonomy=6`, `slug=2`.
- Search applies asset/category/access/facet filters before server-side pagination.
- Queries such as `ghe banh`, `ghế bành` and `arm chair` resolve through one search
  document. Query token order does not matter. If the exact pass has no result, the
  indexed fuzzy pass accepts one adjacent transposition or one/two edits based on token
  length, then reranks by title, taxonomy, popularity and recency.

Detail recommendations use `catalog_behavior_v2`: category, title tokens, renderer,
style, material, form, color, popularity and recency, followed by 86/14 diversity
reranking. Model and Scene are never mixed. Detail returns six records; the expansion
endpoint returns at most 54 more.

Homepage recommendations read at most 30 successful downloads from the last 180 days,
using a 30-day half-life. Ranking is 70% preference, 20% popularity and 10% recency.
Users without history receive a popularity/newness mix. Cache lifetime is 10 minutes,
bounded to 2,000 users and invalidated immediately after a successful download.

```env
MARKETPLACE_BILINGUAL_SEARCH_ENABLED=true
MARKETPLACE_SEARCH_INDEX_INTERVAL_MS=30000
MARKETPLACE_SEARCH_INDEX_BATCH_SIZE=100
MARKETPLACE_SEARCH_CANDIDATE_LIMIT=2000
```

Future Qdrant/BGE-M3 integration may reuse the discovery provider contract, but it must
not change public frontend routes or bypass Mongo publish/file validation.

## 15. Split database, retention va migration contract

### 15.1 Collection ownership

Atlas Core:

```text
User, Topup, TopupPackage, MembershipOrder, MembershipPlan, PaymentReceipt
Referral, Voucher, VoucherRedemption, Getlink, Cookie, SiteSetting, GuideArticle
MarketplaceCategory, MarketplaceFilterOption
```

MongoDB VPS:

```text
MarketplaceModel, MarketplaceReport, ModelDownload, DownloadSession
DailyDownloadQuota, DailyImageSearchQuota, MarketplaceQuotaGrant
MarketplaceDriveChange, MarketplaceDriveSyncState
ProductCache, SystemLog, AuditLog, Notification, NotificationReceipt
HistoryArchiveManifest
```

Google Drive:

```text
Archive Model/Scene, cover, preview, metadata.json.gz
Encrypted Atlas/VPS backups
history-archive/getlink/YYYY-MM/*.jsonl.gz
history-archive/marketplace-download/YYYY-MM/*.jsonl.gz
```

`ModelPurchase` khong con schema/API/timeline. Marketplace chi co Free va Pro.

### 15.2 Cross-database rules

- VPS catalog luu `categorySourceId` va `parentCategorySourceId` dang string.
- VPS history luu `userId` Atlas nhu opaque ObjectId; backend batch-load User tu Atlas
  va hydrate response. Khong dung Mongoose `populate()` cheo connection.
- Category me resolve danh sach stable key cua cac con tren Atlas, sau do query VPS.
- Metadata co category/facet key khong ton tai hoac dang tat tren Atlas bi tu choi.
- Admin taxonomy chi sua `labelVi`, `labelEn`, `position`, `isActive`; key, facet va
  hierarchy bi khoa. Moi thay doi ghi AuditLog.
- API public giu URL/shape cu; frontend khong can biet response duoc hop nhat tu hai DB.

### 15.3 Retention settings

`SiteSetting` Atlas co ba field:

| Field | Default | Moc tinh |
| --- | ---: | --- |
| `getlinkDetailRetentionDaysAfterExpiry` | 1 | Sau khi het quyen tai lai |
| `getlinkHistoryRetentionDaysAfterExpiry` | 730 | Sau khi het quyen tai lai |
| `marketplaceDownloadHistoryRetentionDays` | 365 | Tu `downloadedAt` |

Gia tri `0` la giu vinh vien. History retention khac 0 nam trong 30-3650 ngay;
detail retention khac 0 nam trong 1-3650 ngay.

Job chay 02:30 `Asia/Saigon`:

1. Xoa URL/anh nhay cam cua Getlink sau detail retention, giu record compact.
2. Lay batch record qua han va chia theo `YYYY-MM`.
3. Tao `.jsonl.gz`, SHA-256 va `HistoryArchiveManifest` tren VPS.
4. Upload archive, doc lai verify checksum, sau do upload Drive manifest.
5. Chi xoa exact Mongo IDs khi manifest da verified.
6. Neu process dung sau verify, chu ky sau resume deletion tu manifest.
7. Drive/upload/checksum loi thi Mongo record van duoc giu.

`DownloadSession.purgeAt = expiresAt + 7 ngay`; TTL xoa session cu. Daily quota TTL
xoa sau reset 45 ngay. Xoa history khong thay doi `MarketplaceModel.downloadCount`.

### 15.4 Download count

- Tao download session chi charge quota va tao log `requested`; khong tang counter.
- Khi backend cap redirect Drive hop le hoac mo stream thanh cong lan dau, transaction VPS:
  - claim `DownloadSession.downloadCountedAt`;
  - chuyen session sang `used` va log sang `downloaded`;
  - ghi `downloadedAt`;
  - tang `MarketplaceModel.downloadCount` dung 1.
- Retry/multi-connection cung session khong tang lai.
- Redirect chi xac nhan backend da cap link hop le, khong the xac nhan client da nhan du byte.
- Public card/detail duoc tra `fileSize` va `downloadCount`; hover cover hien dung luong,
  renderer va so luot tai.

### 15.5 Pro daily quota grant

Membership order nam Atlas, quota nam VPS nen khong co transaction cheo DB. Don Pro
Daily approved duoc danh dau `quotaSyncStatus=pending`; worker tao duy nhat mot
`MarketplaceQuotaGrant` theo `membershipOrderId`, tang `bonusLimit`, sau do danh dau
order `applied`. Retry khong cong lai. Don loi giu `error` va duoc worker retry.

### 15.6 Migration commands

Bilingual taxonomy/search rollout:

```bash
npm run marketplace:search:dry-run
npm run marketplace:search:execute
npm run marketplace:search:verify
```

`execute` creates a gzip backup and a resumable checkpoint before translating seeded
Model categories, backfilling search documents in batches of 500 and replacing the old
text index. It does not read Drive or rewrite `metadata.json.gz`.

Split database rollout:

```bash
cd backend
npm run data:split:dry-run
npm run data:split:execute
MIGRATION_CONFIRM=split-marketplace-data npm run data:split:finalize
```

- Dry-run chi in count, khong ghi.
- Execute copy/upsert theo batch, luu checkpoint tren VPS, co the resume, backfill stable
  taxonomy keys va tinh lai `downloadCount`. Atlas source chua bi xoa.
- Review count, sample va backup truoc finalize.
- Finalize tu choi neu con `ModelPurchase`, neu target khong du count, neu hai DB trung nhau
  hoac thieu chuoi xac nhan.
- Mongo VPS production phai la replica set (mot node replica set cung duoc) hoac sharded
  cluster de transaction download counter/quota grant hoat dong.

Required environment:

```dotenv
MONGO_CORE_URI=mongodb+srv://.../core
MONGO_MARKETPLACE_URI=mongodb://.../marketplace?replicaSet=rs0
MARKETPLACE_DB_TARGET=vps
MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED=true
HISTORY_ARCHIVE_DRIVE_FOLDER_ID=
HISTORY_RETENTION_JOB_ENABLED=true
MARKETPLACE_QUOTA_GRANT_JOB_ENABLED=true
```
