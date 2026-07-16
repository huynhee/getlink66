# Marketplace Google Drive naming V3

Day la quick reference cho nguoi sap xep Drive. Contract data day du nam trong
`MARKETPLACE_DATA_CONTRACT.md`; dac ta tool tao folder local truoc khi upload
thu cong nam trong `MARKETPLACE_UPLOAD_TOOL_SPEC.md`.

## Folder

```text
/3dipl/models/{sourceModelId}-{slug}/
```

Vi du:

```text
/3dipl/models/6373049-outdoor-kitchen-145/
```

Folder legacy `{sourceModelId}.{hash}` van sync duoc.

## Required files

```text
metadata.json.gz
model.zip | model.rar | model.7z
cover.jpg | cover.jpeg | cover.png
```

## Optional files

```text
model.sha256
preview-01.jpg
preview-02.jpeg
preview-03.png
```

Rule:

- Cover la anh vuong; khuyen nghi 392-512 px va duoi 200 KB.
- Preview sap theo so; toi da 20 anh duoc index.
- Chi dung JPG/JPEG/PNG.
- Metadata toi da 256 KB sau giai nen.
- Archive file size do Drive cung cap; khong ghi `sizeText` vao metadata.
- Khong dat Drive ID, URL nguon, description hoac tags vao metadata.
- Khi dung `MARKETPLACE_DOWNLOAD_DELIVERY=drive_redirect`, chi file archive phai
  duoc share `Anyone with the link / Viewer`. Backend van giu URL Drive sau
  download-session va redirect; metadata/cover/preview khong bat buoc public.

## Metadata V2

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
  "sha256": "64_lowercase_hex_chars"
}
```

Backend tang revision va updatedAt khi admin save. Upload tool tao model moi co the
bat dau voi revision 1.

## Scene folder va metadata V3

```text
/3dipl/scenes/scene-000001-modern-living-room/
  metadata.json.gz
  scene.zip
  preview-1.jpg
  preview-2.jpg
```

`metadata.json.gz`, archive va `preview-1` la bat buoc. `preview-1` luon la cover.
Scene chi dung filter Style va Render; khong ghi Form, Color hoac Material.

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

Upload/sua Scene xong goi `POST /api/admin/marketplace/scenes/drive/sync-folder`.
Root va backup dung `SCENES_DRIVE_ROOT_FOLDER_ID` va
`SCENES_DRIVE_BACKUP_FOLDER_ID`; khong dung chung root Models.

## Update flow

Upload tool sau khi upload/sua file goi:

```http
POST /api/admin/marketplace/drive/sync-folder
Content-Type: application/json

{ "driveFolderId": "..." }
```

Backend chi list folder model nay. Khong scan root.

Neu sua thu cong trong Drive, Changes worker se enqueue folder va sync trong chu ky
poll tiep theo. Full reconciliation chi dung de recovery/doi soat manual.
