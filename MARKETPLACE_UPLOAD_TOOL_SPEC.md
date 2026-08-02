# 3DIPL Local Model Folder Builder - Specification V1

Tai lieu nay mo ta tool chuan bi thu muc Model/Scene tren may local.

Tool **khong upload Google Drive**, **khong dang nhap admin**, **khong goi API
dong bo** va **khong ghi MongoDB**.

```text
file goc tren may
  -> tool validate va chuan hoa
  -> tao folder Model/Scene hoan chinh tren may
  -> nguoi dung tu upload nguyen folder len Google Drive
  -> backend Drive Changes hoac admin sync folder
  -> web va plugin
```

## 1. Pham vi V1

Tool V1 chi can:

1. Chon file archive Model/Scene tren may.
2. Chon cover va cac anh preview.
3. Chon category, Free/Pro va cac bo loc co san.
4. Tinh SHA-256 cua archive.
5. Tao `metadata.json.gz`.
6. Doi/ghi file theo dung quy chuan.
7. Tao mot folder output hoan chinh tren may.
8. Validate folder truoc khi bao hoan tat.
9. Luu danh sach job local de khong tao trung asset ID.

Tool V1 khong can:

- Google OAuth.
- Google Drive API.
- Upload resumable.
- Admin login, cookie, CSRF hoac 2FA.
- Goi `sync-folder`.
- Ket noi MongoDB Atlas/VPS.
- Crawl website hoac Telegram.
- Chinh public slug va publish state cua web.

## 2. Folder output

Nguoi dung chon mot thu muc output tren may, vi du:

```text
D:\3DIPL_READY\
```

Tool tao:

```text
D:\3DIPL_READY\
  models\
  scenes\
  failed\
  logs\
  data\
```

Trong do:

```text
models\  -> folder Model da san sang upload Drive
scenes\  -> folder Scene da san sang upload Drive
failed\  -> job loi hoac folder chua du du lieu
logs\    -> log xu ly
data\    -> journal SQLite va taxonomy cache
```

Khong de file tam trong `models` hoac `scenes`. Tool chi move folder vao day
sau khi validation cuoi cung thanh cong.

## 3. Ten folder asset

### Model

```text
{sourceAssetId}-{slug}
```

Vi du:

```text
6373049-outdoor-kitchen-145
```

### Scene

```text
{sourceAssetId}-{slug}
```

Vi du:

```text
scene-000001-modern-living-room
```

Quy tac:

- `sourceAssetId` la ID on dinh, khong thay doi sau khi tao.
- Model co the dung ID so hien co, vi du `6373049`.
- Scene nen dung ID noi bo, vi du `scene-000001`.
- Slug tao tu title.
- Slug lowercase ASCII.
- Tu cach nhau bang `-`.
- Bo dau tieng Viet va ky tu dac biet.
- Khong co dau cach o dau/cuoi.
- Phan slug toi da 120 ky tu.
- Khong tao hai folder cung `assetType + sourceAssetId`.

Folder name chi de sap xep Drive. Public slug tren web do backend quan ly.

## 4. Cau truc folder Model

Output Model:

```text
6373049-outdoor-kitchen-145\
  metadata.json.gz
  model.rar
  model.sha256
  cover.jpg
  preview-01.jpg
  preview-02.png
```

Bat buoc:

- `metadata.json.gz`.
- Dung mot archive `model.zip`, `model.rar` hoac `model.7z`.
- Dung mot cover `cover.jpg`, `cover.jpeg` hoac `cover.png`.
- `model.sha256`.

Optional:

- `preview-01` den `preview-20`.

Khong duoc co:

- Hai archive.
- Hai cover.
- Hai metadata.
- Subfolder.
- File tam `.tmp`, `.part`, `.download`.
- URL/link nguon.
- Raw JSON lon khong dung.

## 5. Cau truc folder Scene

Output Scene:

```text
scene-000001-modern-living-room\
  metadata.json.gz
  scene.rar
  scene.sha256
  cover.jpg
  preview-01.jpg
  preview-02.jpg
  preview-03.png
```

Bat buoc:

- `metadata.json.gz`.
- Dung mot archive `scene.zip`, `scene.rar` hoac `scene.7z`.
- `cover.jpg|jpeg|png`.
- `preview-01.jpg|jpeg|png`.
- `scene.sha256`.

`cover` cua Scene duoc tao tu anh preview dau tien. Anh preview dau tien van duoc
giu nguyen noi dung va ty le trong `preview-01`, khong bi thay bang anh cover.

Optional:

- `preview-02` den `preview-20`.

## 6. File duoc phep

Archive:

```text
zip
rar
7z
```

Image:

```text
jpg
jpeg
png
```

Tool phai tu choi:

- WebP.
- GIF.
- BMP.
- TIFF.
- SVG.
- Video.
- Archive hong hoac khong doc duoc.
- File chi bi doi extension nhung noi dung khong dung dinh dang.

## 7. Quy chuan archive

Tool nhan file goc voi ten bat ky:

```text
6373049.66094fb73e165.rar
living-room-final-v2.7z
```

Tool copy/rename sang:

```text
model.rar
scene.7z
```

Khong sua noi dung archive neu khong can thiet.

Tool nen inspect archive va canh bao:

- Khong co file `.max`.
- Co nhieu file `.max`.
- Co path `../`.
- Co path tuyet doi.
- Co `.exe`, `.bat`, `.cmd`, `.ps1`, `.scr`.
- Archive bi ma hoa bang password.
- Archive hong.

V1 co the cho phep nguoi dung tiep tuc khi co nhieu file `.max`, nhung khong
duoc cho tiep tuc neu archive hong hoac co path nguy hiem.

## 8. SHA-256

Tool tinh SHA-256 tu archive output sau cung.

Quy tac:

- Tinh theo streaming, khong nap ca file lon vao RAM.
- Lowercase hexadecimal.
- Dung 64 ky tu.
- Hash phai tinh sau khi file output da duoc tao.
- Gia tri trong metadata va checksum file phai giong nhau.

Model:

```text
0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  model.rar
```

Scene:

```text
0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  scene.rar
```

Phan biet:

- `sha256` trong metadata la hash cua archive.
- Khong phai hash cua `metadata.json.gz`.

## 9. Quy chuan anh

### Bat buoc

- Anh decode thanh cong.
- Width va height lon hon 0.
- Dung JPG/JPEG/PNG that.
- Khong luu EXIF/GPS.
- Chuyen color space ve sRGB.
- Khong crop mat vat the.

### Cover/preview de xuat

- Canvas vuong.
- Khuyen nghi `1200 x 1200`.
- Toi thieu `512 x 512`.
- Dung `contain`, giu du vat the.
- JPG quality 82-88.
- Nen duoi 500 KB khi chat luong cho phep.
- Nen trang cho JPG.
- PNG chi dung khi can transparent.

Tool can co preview truoc/sau de nguoi dung kiem tra anh.

### Naming

Model:

```text
cover.jpg
preview-01.jpg
preview-02.png
```

Scene:

```text
cover.jpg
preview-01.jpg
preview-02.jpg
```

Tool danh so tu `01`, tang dan va khong bo so.

## 10. Metadata Model V2

Tool tao JSON UTF-8 khong BOM, sau do gzip thanh `metadata.json.gz`.

```json
{
  "schemaVersion": 2,
  "revision": 1,
  "updatedAt": "2026-07-16T00:00:00.000Z",
  "assetType": "model",
  "sourceAssetId": "6373049",
  "sourceModelId": "6373049",
  "title": "Outdoor Kitchen 145",
  "sourceCategoryId": "256",
  "accessType": "member",
  "renderer": "Corona",
  "styles": ["modern"],
  "renderers": ["corona"],
  "forms": ["rectangle"],
  "colors": ["black"],
  "materials": ["metal", "wood"],
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

Model bat buoc:

- ID.
- Title.
- Category con/leaf.
- Free hoac Pro.
- SHA-256.

Style, Render, Form, Color va Material la tuy chon. Tool ghi `[]` khi khong co du
lieu; khong tu suy doan. Neu co gia tri thi phai dung key trong taxonomy da import.

## 11. Metadata Scene V3

```json
{
  "schemaVersion": 3,
  "revision": 1,
  "updatedAt": "2026-07-16T00:00:00.000Z",
  "assetType": "scene",
  "sourceAssetId": "scene-000001",
  "title": "Modern Living Room",
  "sourceCategoryId": "living-room",
  "accessType": "member",
  "renderer": "Corona",
  "styles": ["modern"],
  "renderers": ["corona"],
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

Scene bat buoc:

- ID.
- Title.
- Category leaf.
- Free hoac Pro.
- SHA-256.

Renderer, Style va Render la tuy chon. De chuoi rong/`[]` neu chua co du lieu.
Scene van khong ghi Form, Color hoac Material.

Scene khong ghi:

- `sourceModelId`.
- `forms`.
- `colors`.
- `materials`.

## 12. Quy tac metadata

| Field | Rule |
| --- | --- |
| `schemaVersion` | Model `2`, Scene `3` |
| `revision` | Model/Scene moi bat dau tu `1` |
| `updatedAt` | ISO-8601 UTC |
| `assetType` | `model` hoac `scene` |
| `sourceAssetId` | Required, stable, max 80 chars |
| `sourceModelId` | Model only, bang `sourceAssetId` |
| `title` | Trim, max 200 chars |
| `sourceCategoryId` | Active leaf category key |
| `accessType` | `free` hoac `member` |
| `renderer` | Display label, max 80 chars |
| Facet arrays | Unique system keys |
| `sha256` | 64 lowercase hex |

Renderer:

| System key | Display label |
| --- | --- |
| `vray` | `Vray` |
| `corona` | `Corona` |
| `standard` | `Standard` |

Neu co ca `renderer` va `renderers`, `renderer` phai tuong ung mot key trong
`renderers`. Neu chua xac dinh renderer, ghi `renderer: ""` va `renderers: []`.

Metadata sau khi giai nen toi da 256 KB.

## 13. Du lieu khong dua vao metadata

Khong ghi:

- Link nguon.
- Link 3dsky hoac website ben ngoai.
- Google Drive ID/link.
- Description.
- Tags.
- Public slug.
- Publish state.
- Credit price.
- File size text.
- 3ds Max version.
- Format.
- Polygon count.
- Download count.
- Raw response.
- User/history/payment.

File size se duoc backend doc tu archive tren Drive.

## 14. Taxonomy

Tool khong cho nguoi dung nhap category/filter tuy y.

### Cach 1: Dong bo bundle public

```http
GET /api/marketplace/taxonomy/export?assetType=all
```

Bundle gom category va filter cua ca Model/Scene, co `schemaVersion`,
`taxonomyVersion=sha256:...`, nhan VI/EN va alias. Day la API read-only, khong can
admin login va chi export muc dang active.

Admin co the tai ca muc da tat de doi soat:

```http
GET /api/admin/marketplace/taxonomy/export?assetType=all&includeInactive=true
```

Tool phai verify SHA-256 truoc khi thay cache. File sai checksum hoac schemaVersion
khong ho tro khong duoc ghi de snapshot dang dung.

### Cach 2: Taxonomy cache local

Neu web khong chay, tool dung snapshot da tai gan nhat:

```text
data\taxonomy-bundle-v1.json
data\taxonomy-bundle-v1.previous.json
```

Tool ghi cache theo kieu atomic, giu snapshot hop le truoc do, hien thoi gian snapshot
va canh bao neu qua 7 ngay. UI co `Dong bo taxonomy tu web` va `Nhap file taxonomy`.

### Category

Tool UI:

1. Chon category me.
2. Hien category con.
3. Chi ghi `sourceCategoryId` cua category leaf.

Category me co category con khong duoc luu vao metadata.

### Filter

Tool luu `value`, khong luu label:

```json
{
  "value": "modern",
  "labelVi": "Hien dai",
  "labelEn": "Modern"
}
```

Metadata chi ghi:

```json
["modern"]
```

## 15. Controlled vocabulary hien tai

Runtime API van la source of truth. Danh sach duoi day chi de tham chieu.

Model Style:

```text
classic, modern, ethnic
```

Model/Scene Render:

```text
vray, corona, standard
```

Model Form:

```text
round, oval, square, rectangle, triangle
diamond, pentagon, star, angle, bioform
```

Model Color:

```text
white, gray, black, brown
red, orange, yellow, beige
pink, magenta, purple, blue
sky, cyan, lime, green
```

Model Material:

```text
brick, ceramics, concrete, fabric, fur, glass, gypsum, leather
liquid, metal, organics, paper, plastic, rattan, stone, wood
```

Scene Style:

```text
modern, industrial, neoclassic, classic, luxury, indochine
japanese, wabi-sabi, french, modern-classic, other
```

## 16. Input UI

### Thong tin chung

- Asset type: Model/Scene.
- Stable ID.
- Title.
- Access: Free/Pro.
- Category me.
- Category con.
- Renderer.
- Style.
- Model only: Form, Color, Material.

### File

- Archive.
- Cover.
- Preview list.
- Output directory.

### Preview ket qua

Truoc khi tao folder, UI hien:

- Ten folder output.
- Ten archive output.
- Anh cover output.
- Danh sach preview.
- File size.
- SHA-256.
- Metadata JSON.
- Validation warnings/errors.

Nut `Tao folder` chi bat khi khong con error.

## 17. Input manifest optional

De batch nhanh, tool co the doc `input.json`.

Model:

```json
{
  "contractVersion": 1,
  "assetType": "model",
  "sourceAssetId": "6373049",
  "title": "Outdoor Kitchen 145",
  "sourceCategoryId": "256",
  "accessType": "member",
  "renderer": "Corona",
  "styles": ["modern"],
  "renderers": ["corona"],
  "forms": ["rectangle"],
  "colors": ["black"],
  "materials": ["metal", "wood"],
  "files": {
    "archive": "6373049.66094fb73e165.rar",
    "cover": "cover-source.jpg",
    "previews": [
      "preview-source-01.jpg",
      "preview-source-02.png"
    ]
  }
}
```

Tool khong tin checksum/file size do input khai. Tool tu doc va tu tinh.

## 18. Quy trinh tao folder

1. Nguoi dung chon/nhap du lieu.
2. Tool load taxonomy.
3. Tool validate metadata.
4. Tool inspect archive.
5. Tool chuan hoa anh trong temp folder.
6. Tool copy/rename archive vao temp folder.
7. Tool tinh SHA-256 archive output.
8. Tool tao checksum file.
9. Tool tao JSON metadata.
10. Tool gzip thanh `metadata.json.gz`.
11. Tool validate toan bo temp folder.
12. Tool move atomic temp folder vao `models` hoac `scenes`.
13. Tool ghi journal va bao `San sang upload Drive`.

Temp:

```text
data\work\{jobId}\
```

Khong ghi truc tiep vao output final trong luc dang xu ly.

## 19. Update folder local

Tool co hai mode:

### Create new

- Asset ID chua ton tai trong journal/output.
- `revision=1`.
- Tao folder moi.

### Update existing local folder

- Nguoi dung chon folder output da co.
- Tool doc `metadata.json.gz`.
- Asset type va stable ID khong duoc thay doi.
- Merge thay doi.
- `revision=currentRevision + 1`.
- Cap nhat `updatedAt`.
- Chi thay file duoc nguoi dung chon.
- Neu archive thay doi, tinh lai SHA-256.
- Neu preview khong duoc chon thay, giu nguyen preview cu.

Luu y:

Sau khi folder da upload Drive va co the bi admin sua metadata, local folder co
the khong con la ban moi nhat. De sua asset da online:

1. Tai folder/metadata moi nhat tu Drive ve.
2. Mo ban moi nhat bang tool.
3. Sua va tao lai folder local.
4. Upload thay the file trong dung folder Drive cu.

Khong tao folder Drive moi cho cung stable ID.

## 20. Journal local

Dung SQLite:

```text
data\upload-builder.sqlite
```

Luu:

- Asset type.
- Stable ID.
- Title.
- Folder output.
- Archive local source.
- Archive size va SHA-256.
- Metadata revision.
- Metadata updatedAt.
- Input hash.
- Trang thai.
- Errors/warnings.
- Created/updated time.

Trang thai:

```text
draft
validating
building
ready_for_drive
failed
uploaded_manual
```

`uploaded_manual` do nguoi dung bam danh dau sau khi tu upload Drive. Tool khong
tu kiem tra Drive.

Journal dung de:

- Phat hien trung ID.
- Tim folder da tao.
- Tao lai folder bi loi.
- Biet folder nao chua upload.

## 21. Manual upload len Drive

Sau khi tool bao `ready_for_drive`, nguoi dung:

### Model

Upload nguyen folder vao:

```text
/3dipl/models/
```

### Scene

Upload nguyen folder vao:

```text
/3dipl/scenes/
```

Folder asset phai nam truc tiep trong root, khong them cap trung gian.

Dung:

```text
/3dipl/models/6373049-outdoor-kitchen-145/
```

Sai:

```text
/3dipl/models/2026/07/6373049-outdoor-kitchen-145/
```

Khi cap nhat asset:

- Mo dung folder Drive cu.
- Replace/update file thay doi.
- Khong upload thanh folder moi.
- Khong giu hai archive canonical cung luc.
- Khong giu `metadata (1).json.gz`.
- Khong giu `cover (1).jpg`.

Sau khi upload:

- Changes worker co the tu dong phat hien neu backend da bat.
- Hoac vao Admin Model/Scene va bam dong bo folder.
- Full reconcile chi dung khi can doi soat nhieu folder.

## 22. Chia se Drive

Tool local khong sua permission Drive.

Nguoi upload tu cau hinh:

- Folder, metadata va preview co the giu private.
- Neu web dung `drive_redirect`, archive co the can
  `Anyone with the link / Viewer`.
- Khong share ca root folder.
- Khong share metadata.

## 23. Validation report

Tool tao:

```text
logs\6373049-build-report.json
```

Vi du:

```json
{
  "ok": true,
  "assetType": "model",
  "sourceAssetId": "6373049",
  "outputFolder": "D:\\3DIPL_READY\\models\\6373049-outdoor-kitchen-145",
  "archive": {
    "name": "model.rar",
    "size": 26200794,
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "images": {
    "cover": "cover.jpg",
    "previews": 2
  },
  "metadataRevision": 1,
  "warnings": []
}
```

Report khong dua vao folder upload Drive.

## 24. Errors chan tao folder

- Thieu archive.
- Archive extension khong hop le.
- Archive hong.
- Thieu cover.
- Anh hong.
- ID trung.
- Title trong.
- Category khong hop le/khong phai leaf.
- Facet thieu hoac sai key.
- `accessType` khac `free/member`.
- SHA-256 khong tao duoc.
- Metadata vuot 256 KB.
- Output folder da ton tai nhung khong phai mode Update.
- Khong du dung luong dia.

Warnings:

- Cover nho hon 512 px.
- Cover lon hon 1 MB.
- Archive khong co `.max`.
- Archive co nhieu `.max`.
- Taxonomy cache cu qua 7 ngay.

## 25. CLI goi y

```text
folder-builder taxonomy pull
folder-builder validate <input-folder-or-json>
folder-builder build <input-folder-or-json>
folder-builder update <existing-output-folder>
folder-builder list --status ready_for_drive
folder-builder mark-uploaded <asset-id>
folder-builder verify <output-folder>
```

## 26. Module goi y

```text
config
taxonomy-client
taxonomy-cache
input-form
manifest-parser
archive-inspector
image-processor
checksum
metadata-builder
folder-builder
folder-validator
journal
reporter
ui-or-cli
```

Khong can:

```text
google-drive-client
backend-admin-client
oauth
csrf
mongodb
```

## 27. Acceptance tests

### Model

- Tao dung folder name.
- Archive duoc rename dung extension.
- Cover dung ten.
- Preview danh so lien tuc.
- Metadata V2 parse/gunzip duoc.
- SHA metadata trung checksum file va archive.

### Scene

- Metadata V3.
- Archive dung ten `scene.*`.
- Co `cover.jpg` rieng; `preview-01` giu anh preview nguon dau tien.
- Khong co Form/Color/Material trong metadata.

### Duplicate

- Cung asset ID khong tao folder moi.
- Update mode tang revision.
- Update preview khong xoa preview cu neu khong yeu cau.

### Taxonomy

- Parent category co children bi reject.
- Unknown/inactive key bi reject.
- Tool luu system key, khong luu label.

### File

- File anh fake extension bi reject.
- Archive hong bi reject.
- SHA tinh streaming.
- Temp folder khong xuat hien trong output final.

## 28. Definition of Done

Tool V1 hoan thanh khi:

1. Tao folder Model local dung contract.
2. Tao folder Scene local dung contract.
3. Co UI chon category/filter co san.
4. Co xu ly anh vuong.
5. Co inspect archive va SHA-256.
6. Co metadata JSON gzip.
7. Co validation truoc output.
8. Co journal chong trung ID.
9. Co update local folder va revision.
10. Folder output co the keo nguyen vao Drive va backend doc duoc.

## 29. Tai lieu/code tham chieu

- Data contract: `MARKETPLACE_DATA_CONTRACT.md`.
- Drive naming: `MARKETPLACE_DRIVE_NAMING.md`.
- Metadata validator: `backend/src/utils/marketplaceMetadata.js`.
- Folder scanner: `backend/src/utils/marketplaceDriveService.js`.
- Taxonomy runtime: `backend/src/utils/marketplaceTaxonomy.js`.
- Model filters: `backend/src/data/marketplaceFilters.js`.
- Scene filters/categories: `backend/src/data/marketplaceCatalogs.js`.

