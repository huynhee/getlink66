# Fable handoff: Marketplace remaining work, excluding upload tool and 3ds Max plugin

Tai lieu nay danh cho Fable/dev khac tiep tuc lam cac phan con thieu cua marketplace model 3D tren codebase hien tai.

Repo hien tai dang co:

- He getlink/credit cu.
- Marketplace `/models`, detail model, membership/topup co ban.
- Google Drive storage cho archive/cover/preview/metadata.
- MongoDB chi luu catalog index nhe, user, order, quota, history.
- Admin marketplace co import/scan Drive, tim model, chinh sua metadata, attach file/asset, quet lai Drive theo tung model.

Khong lam trong scope tai lieu nay:

- Tool upload model rieng.
- Plugin 3ds Max.

Hai phan do se lam sau. Tuyet doi khong tron task cua hai phan do vao scope hien tai.

## 1. Nguyen tac chung

### Bat buoc giu

- UI hien thi tieng Viet.
- Enum/key/system field giu tieng Anh.
- Model chi co 2 loai quyen tai: `free` va `member`/Pro.
- Khong co `svip`, `credit model`, `format filter`, `tag`, `description`.
- Khong luu link nguon ngoai vao Mongo.
- Khong tra Drive file ID/link that ra public API.
- File nang, anh preview, raw metadata nam tren Google Drive.
- Mongo chi luu index nhe va du lieu van hanh.
- Category/filter phai chon tu danh sach co dinh, khong nhap tu do.

### File nen doc truoc khi lam

1. `SYSTEM_DOCUMENTATION.md`
2. `MODEL_MARKETPLACE_DEVELOPMENT.md`
3. `MARKETPLACE_DATA_CONTRACT.md`
4. `MARKETPLACE_DRIVE_NAMING.md`

Neu tai lieu nao mau thuan voi yeu cau moi cua chu du an, uu tien tai lieu nay va code hien tai.

## 2. Trang thai hien tai can biet

### Backend marketplace

Da co cac nhom API chinh:

- Public marketplace:
  - category/filter list.
  - model list/search.
  - model detail.
  - preview proxy tu Drive.
  - download session.
- Admin marketplace:
  - list model.
  - import metadata thu cong.
  - scan Drive folder batch.
  - update model metadata.
  - attach file nen.
  - attach cover/preview/metadata.
  - rescan Drive tung model.
  - download/session logs.

Can tiep tuc lam:

- Admin UX day du hon cho cac module ngoai marketplace.
- User history timeline hop nhat.
- Image search backend/quota.
- Voucher tach loai.
- Payment flow Credit/Pro can duoc test va khoa chat hon.
- Drive sync tu dong theo job.
- Preview cache/thumbnail production.
- Dashboard/audit/log van hanh.

### Frontend marketplace

Da co:

- `/models`
- `/models/:slug`
- `/membership`
- `/topup`
- Admin marketplace tab import/search/edit/logs.
- Grid model vuong, badge Pro nho.
- Detail co thong so danh muc/render/style/form/color/material/size.

Can tiep tuc lam:

- Lam polish UI va empty/loading/error state day du.
- User history moi.
- Admin module moi/hoan thien theo shell cu.
- Image search UI that su goi API backend.
- Quan ly voucher/transaction/user ro rang hon.

## 3. Priority 1: User history timeline hop nhat

Muc tieu:

- Thay lich su roi rac bang mot timeline hop nhat cho user.
- User vao `/history` thay tat ca hoat dong lien quan tai khoan.
- De doc, de loc, co trang thai ro.

### Backend API

Tao/hoan thien:

```text
GET /api/history/timeline?type=all|credit|pro|getlink|model|referral|voucher&page=1&limit=20
```

Response:

```json
{
  "events": [
    {
      "id": "string",
      "type": "credit|pro|getlink|model|purchase|referral|voucher",
      "title": "string",
      "amount": 0,
      "status": "pending|approved|cancelled|failed|completed|expired",
      "createdAt": "ISO date",
      "metadata": {}
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 1
  }
}
```

Nguon du lieu can gom:

- Getlink records.
- Credit topup records.
- Membership orders.
- Model downloads.
- Model purchases neu co schema cu.
- Referral records.
- Voucher redemption records.

Mapping event:

- Credit topup:
  - `type=credit`
  - `title=Nạp credit`
  - `amount=money amount`
  - `metadata.creditAmount`
  - `metadata.paymentCode`
  - `metadata.voucherCode`
- Pro order:
  - `type=pro`
  - `title=Mua Pro`
  - `amount=money amount`
  - `metadata.planName`
  - `metadata.proUntil`
  - `metadata.isDailyAddon`
- Getlink:
  - `type=getlink`
  - `title=Getlink`
  - `metadata.url/domain/fileName`
  - `metadata.downloadUrlAvailable`
- Marketplace download:
  - `type=model`
  - `title=Tải model`
  - `metadata.modelTitle`
  - `metadata.clientType=web|plugin`
  - `metadata.quotaCharged`
  - `metadata.accessTier`
- Referral:
  - `type=referral`
  - `title=Giới thiệu bạn bè`
  - `metadata.referredUser`
  - `metadata.reward`
- Voucher:
  - `type=voucher`
  - `title=Dùng voucher`
  - `metadata.code`
  - `metadata.discount`
  - `metadata.targetKind`

Rules:

- Sort moi event theo `createdAt desc`.
- Phan trang sau khi merge event.
- Khong tra token, cookie, Drive ID, private payment payload.
- Neu collection rong, API van tra `events=[]`, khong crash.

### Frontend `/history`

Thay UI hien tai bang timeline.

Tabs/filter:

```text
Tat ca | Credit | Pro | Getlink | Model | Referral | Voucher
```

Card event can co:

- Icon theo type.
- Title.
- Trang thai badge.
- Thoi gian.
- Amount neu co.
- Metadata chinh.
- Getlink con han thi co nut tai lai.
- Model download thi hien model title, web/plugin, co tinh quota hay khong.

Empty state:

- Neu chua co lich su: hien text ngan gon.

Loading/error:

- Skeleton hoac loading row.
- Error co nut thu lai.

Acceptance criteria:

- Timeline gom dung nhieu collection.
- Filter dung type.
- Pagination khong bi lap/mat item.
- Khong lo du lieu nhay cam.
- Build frontend pass.

## 4. Priority 2: Admin V1 hoan thien tren giao dien cu

Muc tieu:

- Khong thay admin thanh UI moi qua lon.
- Nang cap tren shell/admin cu.
- Tach module ro rang de de van hanh.

Sidebar/module can co:

```text
Tong quan
User
Thanh toan
Marketplace
Goi nap
Voucher
Noi dung
Thong bao
He thong
Audit
```

### 4.1 Admin dashboard

API:

```text
GET /api/admin/dashboard?period=day|week|month&from=&to=
```

KPI:

- Doanh thu Credit.
- Doanh thu Pro.
- Pending payment.
- User moi.
- Active Pro.
- Getlink count.
- Marketplace downloads.
- Model missing file.
- Model incomplete metadata.
- Loi he thong gan day.

Frontend:

- Card KPI gon.
- Bang hoat dong gan day.
- Link nhanh den pending payment, model missing, user moi.

Acceptance:

- DB rong khong crash.
- Period filter thay doi du lieu.
- Khong query qua nang.

### 4.2 Admin User module

List API:

```text
GET /api/admin/users?search=&status=all|banned|active&tier=all|free|pro|admin&page=&sort=
```

Detail APIs:

```text
GET /api/admin/users/:id/profile
GET /api/admin/users/:id/timeline?type=&page=&limit=
GET /api/admin/users/:id/quota
POST /api/admin/users/:id/pro-adjust
POST /api/admin/add-credit
POST /api/admin/set-credit
POST /api/admin/users/:id/ban
POST /api/admin/users/:id/unban
```

User detail can hien:

- Email/name/avatar.
- Role admin hay user.
- Credit hien tai.
- Pro until.
- Quota tai model hom nay.
- Quota tim bang hinh hom nay.
- Timeline gan nhat.
- Getlink gan nhat.
- Credit topup.
- Pro orders.
- Marketplace downloads.
- Audit action lien quan user.

Admin actions:

- Cong credit.
- Set credit.
- Ban/unban.
- Chinh han Pro.
- Chinh quota/add-on neu da co field.

Rules:

- Moi action quan trong phai ghi `AuditLog`.
- Khong cho admin tu ban chinh minh neu se mat admin cuoi cung.
- Confirm ro truoc khi set credit/ban/cancel order.

Acceptance:

- Search user theo email/name.
- Filter pro/admin/banned dung.
- Detail load nhanh, moi table co loading/error.
- Action cap nhat UI sau khi thanh cong.

### 4.3 Admin transaction module

API:

```text
GET /api/admin/transactions?kind=credit|pro|all&status=&search=&page=
POST /api/admin/topups/:id/approve
POST /api/admin/topups/:id/cancel
POST /api/admin/membership-orders/:id/approve
POST /api/admin/membership-orders/:id/cancel
```

UI:

Tabs:

```text
Credit | Pro | Tat ca
```

Columns:

- Thoi gian.
- User.
- Kind.
- Status.
- Payment code.
- Gateway transaction ID.
- Amount.
- Credit amount hoac plan.
- Voucher.
- Action.

Pending action:

- Duyet.
- Huy.

Rules:

- Duyet credit chi cong credit mot lan.
- Duyet Pro chi kich hoat/gia han Pro mot lan.
- Don approved/cancelled khong duoc approve lai.
- Dung lai logic san co `approvePendingTopup` va `approvePendingMembershipOrder`, khong viet logic cong tien moi.

Acceptance:

- Manual approve/cancel hoat dong.
- Double click khong tao double credit/Pro.
- Audit log day du.

### 4.4 Admin membership/topup plan

Goi nap can ro hai muc dich:

- Credit: dung cho getlink.
- Pro: dung de tai model Pro va quyen Pro.

Admin API cho Pro plan:

```text
GET /api/admin/membership-plans
POST /api/admin/membership-plans
PUT /api/admin/membership-plans/:id
DELETE /api/admin/membership-plans/:id
POST /api/admin/membership-plans/reorder
```

Fields plan:

- `name`
- `price`
- `durationDays`
- `dailyDownloadQuota`
- `badge`
- `isDailyAddon`
- `isActive`
- `position`

Rules Pro:

- Daily 50k/ngay la add-on.
- Monthly/3-month/12-month la base Pro.
- Han Pro tinh den cuoi ngay Asia/Saigon, 23:59:59.
- Daily add-on dung de them luot tai hom nay khi user het luot, khong ghi de goi thang.
- Credit package khong kich Pro.
- Pro order khong cong credit.

Acceptance:

- Admin sua gia/goi/hien an/reorder duoc.
- User mua dung loai goi.
- SePay IPN phan luong dung Credit/Pro bang payment code.

## 5. Priority 3: Voucher tach loai va dung chung

Muc tieu:

- Voucher dung chung duoc cho Credit va Pro khi cau hinh `targetKind=all`.
- Co the gioi han voucher chi cho Credit hoac Pro.
- Voucher UI tach rieng, khong nam lap trong topup section.

### Schema/fields can co

Neu schema hien tai chua co, them field:

```text
targetKind: all|credit|pro
discountType: fixed|percent
discountValue: number
minAmount: number
maxDiscount: number
usageLimit: number
usedCount: number
perUserLimit: number
startsAt: Date
expiresAt: Date
isActive: boolean
```

Rules:

- `targetKind=credit`: chi ap dung goi credit.
- `targetKind=pro`: chi ap dung goi Pro.
- `targetKind=all`: ca hai.
- Voucher het han/het luot/khong active khong duoc dung.
- Voucher phai ghi redemption history.

### Admin voucher UI

List:

- Code.
- Target kind.
- Discount.
- Min amount.
- Used/limit.
- Active.
- Expiry.
- Actions.

Form:

- Tao/sua voucher.
- Chon target kind bang select.
- Chon discount type.
- Bat/tat active.

### Frontend topup

Trang home:

- Hai tab/card:
  - Nap Credit.
  - Mua Pro.
- Voucher input dung chung o ngoai.
- Khi bam nap ngay chuyen vao `/topup?type=credit` hoac `/topup?type=pro`.

Trang `/topup`:

- Tieu de: `Goi nap`.
- Toggle 2 nut: `Credit` va `Pro`.
- Voucher nam duoi danh sach goi.
- Giai thich ngan:
  - Credit dung cho getlink.
  - Pro dung de tai model Pro va tang quota marketplace.

Acceptance:

- Voucher credit khong apply duoc cho Pro.
- Voucher Pro khong apply duoc cho Credit.
- Voucher all apply duoc cho ca hai.
- UI khong lam user nham Credit voi Pro.

## 6. Priority 4: Image search backend va quota

Muc tieu:

- Nut icon search bang hinh trong thanh tim kiem hoat dong that.
- Free user co 10 lan/ngay.
- Pro user co 150 lan/ngay.
- Khong can cong khai quota tren thanh search.

Khong lam:

- Khong can AI xuat sac ngay MVP.
- Khong can plugin.
- Khong can upload tool.

### Data model

Tao model neu chua co:

```text
ImageSearchQuota
```

Fields:

- `userId`
- `guestKey`
- `dateKey` theo Asia/Saigon, vi du `2026-07-06`
- `used`
- `limit`
- timestamps

Tao log:

```text
ImageSearchLog
```

Fields:

- `userId`
- `guestKey`
- `status`
- `queryImageSize`
- `resultCount`
- `clientIpHash`
- `createdAt`

### API

```text
POST /api/marketplace/image-search
Content-Type: multipart/form-data
field: image
```

Response:

```json
{
  "results": [],
  "quota": {
    "used": 1,
    "limit": 10
  }
}
```

Rules:

- Free/guest limit: 10/ngay.
- Pro limit: 150/ngay.
- Kiem tra file type: jpg/jpeg/png/webp.
- Gioi han dung luong anh upload, vi du 8 MB.
- Neu het quota tra 429.
- Khong luu anh raw lau dai trong phase nay, chi log metadata.

### Search implementation MVP

Chon mot trong hai cach:

1. Placeholder practical MVP:
   - Upload anh.
   - Tra empty results voi message `Dang nang cap tim bang hinh`.
   - Van enforce quota.
   - Phu hop neu chua co embedding/search infra.

2. Embedding MVP:
   - Tao image embedding cho cover/preview sau.
   - Luu vector vao collection rieng hoac engine rieng.
   - Query nearest neighbor.

De lam nhanh, uu tien cach 1 truoc de UI/quota/API day du, sau do gan engine that.

### Frontend

- Thanh search chi co icon camera.
- Bấm icon mo file picker.
- Upload xong hien loading trong grid.
- Results tra ve thi replace list model.
- Neu het quota hien toast/modal ngan.
- Khong hien text `Tim anh Pro 150/ngay` tren thanh search.

Acceptance:

- Free dung qua 10 lan/ngay bi chan.
- Pro dung qua 150 lan/ngay bi chan.
- UI khong crash khi API tra empty.
- Co log trong admin/system.

## 7. Priority 5: Marketplace admin refinement

Muc tieu:

- Admin marketplace de hieu hon, lam viec theo 3 luong:
  - Import/dong bo.
  - Tim model.
  - Chinh sua model.

Da co nen tiep tuc polish, khong lam lai tu dau.

### Can them vao admin marketplace

#### Model validation panel

Trong detail edit model, hien checklist:

- Category leaf.
- Style.
- Render.
- Form.
- Color.
- Material.
- Cover.
- Archive.
- Metadata file.
- Publish status.

Hien ro:

- Du metadata: co the publish.
- Thieu metadata: tu dong draft.
- File missing: khong tai duoc.

#### Bulk actions

Trong tab search/list:

- Chon nhieu model.
- Bulk publish/unpublish.
- Bulk set access `free/member`.
- Bulk rescan Drive cho model da chon.

Can rate limit/confirm vi co the ton quota Google API.

#### Better Drive scan status

Import Drive batch can hien:

- Batch da quet bao nhieu folder.
- Tao moi/cap nhat/khong doi/bo qua.
- Next page token.
- Nut copy token neu can.
- Nut tiep tuc batch.
- Nut reset batch.

#### Model rescan behavior

Endpoint da co:

```text
POST /api/admin/marketplace/models/:id/rescan-drive
```

Can polish UI:

- Disable neu khong co `driveFolderId`.
- Loading rieng tren nut.
- Bao so file scan, so preview, metadata error neu co.
- Sau rescan clear form local va reload model.

Acceptance:

- Admin nhin vao biet vi sao model chua online.
- Co the cap nhat anh preview moi tren Drive bang nut rescan tung model.
- Bulk action co confirm va audit log.

## 8. Priority 6: Drive sync tu dong

Muc tieu:

- Khong phai bam batch thu cong mai.
- Co job nen scan root Drive theo batch nho.
- Cap nhat model moi/cu dua tren `driveSignature`.

Khong lam:

- Khong tao/upload file len Drive.
- Khong doc Telegram.

### Backend job

Tao service:

```text
marketplaceDriveSyncJob
```

Config `.env`:

```text
MARKETPLACE_DRIVE_SYNC_ENABLED=false
MARKETPLACE_DRIVE_ROOT_FOLDER_ID=
MARKETPLACE_DRIVE_SYNC_BATCH_SIZE=50
MARKETPLACE_DRIVE_SYNC_INTERVAL_MINUTES=30
```

State can luu:

```text
MarketplaceDriveSyncState
```

Fields:

- `rootFolderId`
- `pageToken`
- `lastStartedAt`
- `lastFinishedAt`
- `status`
- `lastError`
- `createdCount`
- `updatedCount`
- `unchangedCount`

Rules:

- Moi interval chi scan mot batch.
- Het `nextPageToken` thi reset ve dau o lan sau hoac theo config.
- Neu folder/file khong doi signature thi chi update `lastDriveScanAt`, khong rewrite model.
- Co lock de khong chay 2 job cung luc.

Admin UI:

- Trang System/Marketplace sync hien:
  - Enabled/disabled.
  - Last run.
  - Page token.
  - Counts.
  - Last error.
  - Nut run once.

Acceptance:

- Job khong crash server khi Google API loi.
- Co log loi.
- Co the tat bang env.

## 9. Priority 7: Preview cache va thumbnail production

Muc tieu:

- Load grid nhanh hon khi nhieu user.
- Giam request truc tiep toi Drive.
- Khong lo Drive ID.

Hien tai:

- Backend proxy anh tu Drive.
- Public API tra URL noi bo.

Can lam:

### Cache headers

Cho cover/preview proxy:

```text
Cache-Control: public, max-age=31536000, immutable
ETag
```

Neu anh thay doi driveFileId thi URL nen doi version/cache key:

```text
/api/marketplace/models/:id/cover?v=:driveFileId
/api/marketplace/models/:id/preview/:index?v=:driveFileId
```

### Optional disk cache

Neu can:

- Cache file anh proxy vao local disk.
- Key theo driveFileId.
- Max size config.
- TTL dai.

Env:

```text
MARKETPLACE_IMAGE_CACHE_ENABLED=false
MARKETPLACE_IMAGE_CACHE_DIR=./storage/marketplace-image-cache
MARKETPLACE_IMAGE_CACHE_MAX_MB=2048
```

### Thumbnail

MVP co the chi dung cover da vuong tu Drive.

Sau do:

- Backend tao thumbnail cover 392x392 webp/jpeg.
- Luu cache local hoac R2.
- Khong lam neu chua can.

Acceptance:

- Public API khong tra Drive ID.
- Browser cache anh cover/preview.
- Model thieu anh hien placeholder, khong crash.

## 10. Priority 8: Payment Credit/Pro hardening

Muc tieu:

- Credit va Pro tach muc dich that chat.
- Giao dich khong bi double approve.
- Han Pro dung den cuoi ngay.
- Daily Pro addon khong pha goi thang.

### Rules bat buoc

Credit:

- Dung cho getlink.
- Nap credit chi cong credit.
- Khong kich Pro.

Pro:

- Dung cho marketplace model Pro va quyen thanh vien.
- Mua Pro khong cong credit.
- Base plan gia han `proUntil`.
- Daily add-on them luot tai hom nay, khong rut ngan/gia han sai goi thang.
- Han plan tinh den `23:59:59 Asia/Saigon`.

### Backend can test/kiem tra

- SePay IPN phan loai bang payment code.
- Payment code Credit di vao Topup.
- Payment code Pro di vao MembershipOrder.
- Manual approve dung lai logic IPN.
- Idempotency:
  - Topup approved roi khong cong lai.
  - MembershipOrder approved roi khong kich lai.

### Frontend can polish

Home:

- Goi nap nam giua.
- Toggle/card Credit/Pro.
- Noi ro:
  - Credit: dung de getlink.
  - Pro: dung de tai model Pro va tang quota.
- Bam `Nap ngay` chuyen vao `/topup?type=credit` hoac `/topup?type=pro`.

Topup:

- Header chi can `Goi nap`.
- Toggle 2 nut Credit/Pro.
- Voucher nam duoi.
- Khong co goi nap trong `/getlink`.

Acceptance:

- User khong nham credit voi Pro.
- Test IPN/manual approve day du.
- Pro until tinh dung cuoi ngay.

## 11. Priority 9: Audit log va system log

Muc tieu:

- Moi action admin quan trong co audit.
- Loi he thong quan trong de xem trong admin.

Audit actions can log:

- Update user credit.
- Ban/unban user.
- Adjust Pro.
- Approve/cancel topup.
- Approve/cancel Pro order.
- Create/update/delete voucher.
- Create/update/delete membership plan.
- Update marketplace model.
- Attach file/assets.
- Rescan Drive model.
- Bulk marketplace actions.
- Run Drive sync.

Audit record can co:

- actor user id/email.
- action.
- target type/id.
- metadata da che thong tin nhay cam.
- ip/user agent neu co.
- createdAt.

System logs:

- Google Drive API error.
- Payment IPN error.
- Download stream error.
- Image search quota/error.
- Drive sync job error.

Acceptance:

- Admin co filter audit theo action/actor/target/date.
- Khong log token, cookie, Drive secret, raw payment secret.

## 12. Priority 10: Tests

Can them test theo muc do rui ro.

### Backend tests

User history:

- Merge dung order tu nhieu collection.
- Filter dung type.
- Pagination dung.

Transaction:

- Approve credit mot lan.
- Approve Pro mot lan.
- Cancel pending khong cong credit/Pro.
- Approved khong cancel/approve lai.

Voucher:

- Credit voucher chi credit.
- Pro voucher chi Pro.
- All voucher ca hai.
- Expired/limit invalid.

Marketplace:

- Model incomplete khong publish.
- Missing file khong download.
- Ready file tao download session duoc.
- Public API khong tra Drive ID.
- Rescan Drive cap nhat previewImages.

Quota:

- Guest/free/member download quota reset dung 00:00 Asia/Saigon.
- Image search quota Free 10, Pro 150.

### Frontend tests/checks

Neu repo chua co test UI, toi thieu:

- `npm run build --prefix frontend`
- Manual smoke:
  - `/models`
  - `/models/:slug`
  - `/topup?type=credit`
  - `/topup?type=pro`
  - `/history`
  - Admin marketplace edit/rescan.
  - Admin transaction approve/cancel.

## 13. Suggested implementation order for Fable

Lam theo thu tu nay de it va cham:

1. User history timeline backend + frontend.
2. Admin transaction module Credit/Pro.
3. Voucher target kind + admin voucher UI + topup voucher move.
4. Admin user detail/profile/quota/timeline.
5. Dashboard/admin audit polish.
6. Image search API quota placeholder + frontend upload icon.
7. Marketplace admin validation/bulk actions polish.
8. Drive sync job.
9. Preview cache headers/versioning.
10. Payment hardening tests.

Khong nen lam tat ca mot PR neu co the tach:

- PR 1: timeline.
- PR 2: transactions/voucher.
- PR 3: admin user/dashboard/audit.
- PR 4: image search quota.
- PR 5: Drive sync/cache.

## 14. Definition of done

Moi task duoc coi la xong khi:

- API co validate input.
- Khong lo token/Drive ID/private data.
- UI co loading, error, empty state.
- Admin action co audit log neu thay doi du lieu.
- Build frontend pass.
- Backend syntax/test pass.
- Co manual smoke notes.
- Khong them lai cac field da cam: `description`, `tags`, `source.raw`, `source.url`, `format`, `version`, `polygons`, `fileName`.

## 15. Notes for future, not now

### Upload tool model rieng

Lam sau. Tool nay se:

- Lay file tu Telegram/local.
- Tao folder Drive dung chuan.
- Tao cover/preview/metadata/checksum.
- Upload len Drive.
- Goi API scan/attach.

Khong nam trong scope hien tai.

### Plugin 3ds Max

Lam sau. Plugin nay se:

- Login user.
- Goi download session API.
- Tai archive ve cache.
- Verify sha256.
- Giai nen.
- Merge `.max` vao scene.

Khong nam trong scope hien tai.
