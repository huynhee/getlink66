# Marketplace data contract

Tai lieu nay la chuan duy nhat cho pipeline:

```text
upload tool -> cloud storage -> admin scanner/API -> MongoDB -> web -> 3ds Max plugin
```

Muc tieu:

- Khong co field tu do nhu `tags`, `description`, `source.raw`, `source.url`.
- MongoDB chi luu catalog index va du lieu van hanh nhe.
- Cloud luu toan bo file nang: archive, cover, preview, metadata raw dang `.json.gz`.
- Web/plugin chi lam viec qua backend API, khong nhin thay Drive link hoac Drive file ID that.
- Category va filter phai chon tu bo gia tri co dinh.

## 1. Ownership

### Upload tool owns

- Tao folder model tren cloud.
- Upload file nen chinh, cover, preview, metadata `.json.gz`, checksum.
- Resize cover ve anh vuong.
- Goi API scan/attach neu can cap nhat nhanh hon scanner batch.

Upload tool co the dat quyen tai trong `metadata.json` bang `accessType`. Neu metadata khong co `accessType`, admin scan batch hoac admin panel se dung quyen tai mac dinh.

### Cloud storage owns

- `model.zip`, `model.rar`, hoac `model.7z`.
- `cover.jpg`, `cover.jpeg`, hoac `cover.png`.
- `preview-01.jpg`, `preview-02.jpeg`, `preview-03.png`, ...
- `metadata.json.gz`.
- `model.sha256`.

Cloud path chi de quan ly noi bo. Mongo luu Drive file ID, khong luu public URL.

### MongoDB owns

- User, order, quota, history, download session.
- Catalog index nhe: title, slug, category, filters, file status, drive IDs, sha256, file size.
- Khong luu anh, file nen, raw JSON lon, source URL, tag, description.

### Web owns

- Public list/detail/search.
- Preview proxy: web chi thay `/api/marketplace/models/:id/cover` va `/preview/:index`.
- Download session creation.

### Plugin owns

- Goi cung download-session API voi web.
- Tai file ve cache local.
- Verify `sha256` neu co.
- Giai nen va merge/import `.max` bang 3ds Max.

Plugin khong duoc dung Drive link truc tiep.

## 2. Canonical IDs

Moi model co cac ID rieng:

| Field | Owner | Purpose | Public |
| --- | --- | --- | --- |
| `sourceModelId` | upload metadata | Ma catalog doi chieu noi bo, vi du ID cu tu nguon | No |
| `driveFolderId` | cloud/admin scanner | Dinh danh folder that tren Drive | No |
| `slug` | web/backend | URL noi bo cua web | Yes |
| `_id` | MongoDB | Internal API identity | Yes, safe |

Rule:

- `sourceModelId` la opaque ID, khong phai URL.
- Khong luu link nguon ngoai.
- Neu doi title, khong nen doi slug cu khi model da publish, de tranh gay link chet.

## 3. Cloud folder standard

Root:

```text
/3dipl/
  /models/
    /{sourceModelId}-{slug}/
```

Vi du:

```text
/3dipl/models/6373049-outdoor-kitchen-145/
```

Allowed files:

```text
model.zip | model.rar | model.7z
model.sha256
cover.jpg | cover.jpeg | cover.png
preview-01.jpg | preview-01.jpeg | preview-01.png
preview-02.jpg | preview-02.jpeg | preview-02.png
metadata.json.gz
```

Folder cu dang co dang `{sourceModelId}.{hash}` van duoc scanner nhan, nhung chuan moi nen dung `{sourceModelId}-{slug}`.

## 4. File rules

### Archive

- Required de model tai duoc.
- Ten chuan: `model.zip`, `model.rar`, hoac `model.7z`.
- Scanner fallback: `{sourceModelId}.*`, file trung ten folder, sau do file nen lon nhat.
- Archive extension chi de backend dat download filename, khong phai marketplace filter.

### Cover

- Required de model hien dep tren grid.
- Chi dung `jpg`, `jpeg`, `png`.
- Anh vuong, khuyen nghi 392-512 px moi canh.
- Nen < 200 KB neu la JPG/JPEG.
- Ten chuan: `cover.jpg`, `cover.jpeg`, hoac `cover.png`.

### Preview

- Optional cho trang detail.
- Ten chuan: `preview-01.jpg`, `preview-02.jpg`, ...
- Chi dung `jpg`, `jpeg`, `png`.
- Khuyen nghi khoang 1200 px canh dai.

### Metadata

- Required de model du metadata.
- Ten chuan: `metadata.json.gz`.
- Tool nen gzip JSON truoc khi upload.
- Backend scan doc file nay, map cac field hop le vao Mongo, bo qua field khong hop le.

### Checksum

- Recommended.
- Ten chuan: `model.sha256`.
- Noi dung chi can chua 64 hex chars cua archive.
- Backend luu vao Mongo va tra trong download session de plugin verify.

## 5. `metadata.json` schema

Allowed fields only:

```json
{
  "sourceModelId": "6373049",
  "title": "Outdoor Kitchen 145",
  "sourceSlug": "outdoor-kitchen-145",
  "sourceCategoryId": "256",
  "accessType": "member",
  "renderer": "Corona",
  "styles": ["modern"],
  "renderers": ["corona"],
  "forms": ["rectangle"],
  "colors": ["black", "wood"],
  "materials": ["metal", "wood"],
  "sizeText": "25 MB",
  "sha256": "64_hex_characters"
}
```

Do not send:

```json
{
  "description": "not allowed",
  "tags": ["not allowed"],
  "sourceUrl": "not allowed",
  "source": { "raw": "not allowed" },
  "format": "not allowed",
  "version": "not allowed",
  "polygons": "not allowed",
  "fileName": "not allowed",
  "driveFileId": "not allowed"
}
```

Field rules:

| Field | Required | Rule |
| --- | --- | --- |
| `sourceModelId` | Yes | String, stable opaque ID |
| `title` | Yes | Display title, max 200 chars |
| `sourceSlug` | Optional | Internal slug fallback, max 160 chars |
| `sourceCategoryId` | Yes | Must match a leaf category |
| `accessType` | Optional | `free`, `member`, or `pro`; `pro` is normalized to `member` |
| `renderer` | Optional | Display label only, example `Corona` |
| `styles` | Yes | Values from `MARKETPLACE_FILTERS.style` |
| `renderers` | Yes | Values from `MARKETPLACE_FILTERS.render` |
| `forms` | Yes | Values from `MARKETPLACE_FILTERS.form` |
| `colors` | Yes | Values from `MARKETPLACE_FILTERS.color` |
| `materials` | Yes | Values from `MARKETPLACE_FILTERS.material` |
| `sizeText` | Optional | Display text, example `25 MB` |
| `sha256` | Recommended | 64 hex chars of archive |

Model chi duoc publish khi du:

- Leaf category.
- Style.
- Render.
- Form.
- Color.
- Material.
- File archive ready.

## 6. Controlled vocabularies

Source of truth:

- Categories: `backend/src/data/marketplaceCategories.js`
- Filters: `backend/src/data/marketplaceFilters.js`

Allowed filters:

- `style`: `classic`, `modern`, `ethnic`
- `render`: `vray`, `corona`, `standard`
- `form`: `round`, `oval`, `square`, `rectangle`, `triangle`, `diamond`, `pentagon`, `star`, `angle`, `bioform`
- `color`: `white`, `gray`, `black`, `brown`, `red`, `orange`, `yellow`, `beige`, `pink`, `magenta`, `purple`, `blue`, `sky`, `cyan`, `lime`, `green`
- `material`: `brick`, `ceramics`, `concrete`, `fabric`, `fur`, `glass`, `gypsum`, `leather`, `liquid`, `metal`, `organics`, `paper`, `plastic`, `rattan`, `stone`, `wood`

Khong co filter `format`.

## 7. Mongo compact model

Mongo `MarketplaceModel` chi luu:

- `source.provider`, `source.modelId`, `source.slug`, `source.categoryId`, `source.syncedAt`
- `title`, `slug`
- `categoryId`, `parentCategoryId`, `categorySourceId`
- `coverImage`, `previewImages`
- `driveFolderId`, `driveFolderName`, `driveSignature`, `lastDriveScanAt`, `lastDriveChangeAt`
- `styles`, `renderers`, `forms`, `colors`, `materials`, `renderer`, `sizeText`
- `metadataStatus`, `metadataMissingFields`
- `accessType`, `isPublished`, `fileStatus`
- `storageProvider`, `storageKey`, `driveFileId`, `telegramFileRef`
- `archiveExt`, `fileSize`, `sha256`
- `metadataDriveFileId`, `metadataFileName`, `metadataSize`
- `downloadCount`

`accessType` allowed values:

- `free`: guest/free/pro deu co the tai theo quota.
- `member`: chi Pro/admin tai duoc. UI hien thi la Pro.

Mongo khong luu:

- `description`
- `tags`
- `source.raw`
- `source.url`
- external source link
- raw metadata JSON
- file binary
- image binary
- Drive public link
- model credit price

## 8. Admin API boundaries

Batch scan:

```text
POST /api/admin/marketplace/import-drive-folder
```

Manual metadata import:

```text
POST /api/admin/marketplace/models/import-metadata
```

Manual model update:

```text
PUT /api/admin/marketplace/models/:id
```

Attach archive:

```text
POST /api/admin/marketplace/models/:id/attach-file
```

Attach cover/preview/metadata refs:

```text
POST /api/admin/marketplace/models/:id/attach-assets
```

Tool upload co the dung attach APIs neu da upload file len Drive va co Drive file IDs.

## 9. Public web API boundaries

List categories:

```text
GET /api/marketplace/categories
```

List filters:

```text
GET /api/marketplace/filters
```

List/search models:

```text
GET /api/marketplace/models
```

Model detail:

```text
GET /api/marketplace/models/:slug
```

Cover/preview proxy:

```text
GET /api/marketplace/models/:id/cover
GET /api/marketplace/models/:id/preview/:index
```

Public API must not return:

- Drive file ID.
- Drive public URL.
- Source URL.
- Raw metadata.
- Storage key.

## 10. Download and plugin contract

Web:

```text
POST /api/marketplace/models/:id/download-session
GET  /api/download/session/:id/file?t=:token
```

Plugin:

```text
POST /api/plugin/models/:id/download-session
GET  /api/download/session/:id/file?t=:token
```

Session response:

```json
{
  "session": {
    "_id": "mongo_session_id",
    "expiresAt": "2026-07-06T10:00:00.000Z",
    "fileName": "outdoor-kitchen-145.zip",
    "fileSize": 26200794,
    "sha256": "64_hex_chars_or_empty"
  },
  "downloadUrl": "/api/download/session/:id/file?t=:token",
  "remaining": 99,
  "resetAt": "2026-07-06T17:00:00.000Z"
}
```

Plugin flow:

1. Call plugin download-session API.
2. Download file from `downloadUrl`.
3. Save to local cache.
4. If `sha256` exists, verify downloaded archive.
5. Extract archive.
6. Find main `.max`.
7. Call 3ds Max merge/import.

## 11. Update flow

Scanner uses `driveSignature`:

- `created`: folder not in Mongo.
- `updated`: folder exists but file list/name/size/modified time changed.
- `unchanged`: folder signature unchanged.

For 200k models:

- Do not rescan all folders in one request.
- Use batch `limit` and `pageToken`.
- Upload tool should call attach APIs for hot updates.
- Full rescan is for recovery or periodic audit only.

## 12. Validation checklist for upload tool

Before upload:

- Folder name matches `{sourceModelId}-{slug}`.
- Archive is `model.zip`, `model.rar`, or `model.7z`.
- Cover exists, is square, and is JPG/JPEG/PNG.
- Metadata has no forbidden fields.
- `sourceCategoryId` is a leaf category.
- Facets are valid controlled values.
- `model.sha256` matches archive.

After upload:

- Store Drive file IDs from upload result.
- Call attach APIs or wait for scanner batch.
- Do not expose Drive links to users.
