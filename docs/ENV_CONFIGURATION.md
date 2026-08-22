# Cau hinh moi truong 3DIPL

Tai lieu nay dung cho `backend/.env`. Khong commit file `.env` va khong dua secret vao log, ticket hoac anh chup.

## 1. Hai che do MongoDB

### Local, chua tach VPS

```env
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/getlink_3dipl
MONGO_CORE_URI=
MONGO_MARKETPLACE_URI=
MARKETPLACE_DB_TARGET=core
MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED=false
ALLOW_MEMORY_DB=false
```

Khi `MONGO_CORE_URI` de trong, backend dung `MONGO_URI`. Che do nay de test nhanh, khong phai cau hinh production.

### Production, Atlas Core va MongoDB VPS rieng

```env
NODE_ENV=production
MONGO_CORE_URI=mongodb+srv://<atlas-user>:<password>@<cluster>/<core-db>
MONGO_MARKETPLACE_URI=mongodb://<vps-user>:<password>@127.0.0.1:27017/<marketplace-db>?authSource=admin&replicaSet=rs0
MARKETPLACE_DB_TARGET=vps
MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED=true
ALLOW_MEMORY_DB=false
```

MongoDB VPS phai la replica set, ke ca khi chi co mot node. Backend production se dung khoi dong neu URI marketplace bi thieu, hai URI tro cung database hoac VPS khong ho tro transaction.

Phan chia:

- Atlas Core: User, thanh toan, Pro, voucher, referral, Getlink, SiteSetting, GuideArticle va taxonomy.
- MongoDB VPS: catalog Model/Scene, quota, download session/history, Drive sync, notification va log van hanh.
- Google Drive: archive Model/Scene, cover, preview, metadata va history archive.

## 2. Google Login OAuth

Google Login va Google Drive OAuth la hai callback khac nhau. Trong Google Cloud Console,
OAuth Client loai `Web application` can co cac Authorized redirect URI:

```text
http://localhost:5000/api/auth/google/callback
http://127.0.0.1:53682/oauth2/callback
```

Callback thu nhat dung de dang nhap web local. Callback thu hai chi dung cho lenh
`npm run drive:auth`.

Local:

```env
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback
```

Production neu frontend/backend cung domain:

```env
GOOGLE_CALLBACK_URL=https://3dipl.org/api/auth/google/callback
```

Neu backend dung subdomain rieng, thay bang URL backend that, vi du
`https://api.3dipl.org/api/auth/google/callback`. URI phai trung tuyet doi ca protocol,
hostname, port, path va dau gach cuoi voi Google Cloud Console.

Trong `Authorized JavaScript origins`, them:

```text
http://localhost:5173
https://3dipl.org
```

Sau khi sua `.env`, khoi dong lai backend.

## 3. Google Drive tu gia han token

Khong dung `GOOGLE_DRIVE_ACCESS_TOKEN` trong production vi token nay thuong het han sau khoang mot gio.

1. Bat Google Drive API trong Google Cloud project.
2. OAuth consent screen phai o trang thai Production neu ung dung dung lau dai.
3. OAuth Client them Authorized redirect URI chinh xac:

```text
http://127.0.0.1:53682/oauth2/callback
```

4. Dien client credentials. Co the dung rieng bo Drive hoac de backend fallback sang bo Google Login:

```env
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_OAUTH_REDIRECT_URI=http://127.0.0.1:53682/oauth2/callback
```

5. Chay tren may co trinh duyet:

```powershell
cd D:\LTinh\get-link-3d66\backend
npm run drive:auth
```

Lenh se xin scope `https://www.googleapis.com/auth/drive`, luu `GOOGLE_DRIVE_REFRESH_TOKEN` vao `.env` va xoa access token tam.

## 4. Thu muc Drive

Tao bon thu muc, mo tung thu muc va lay chuoi sau `/folders/` tren URL:

```text
/3dipl/models
/3dipl/scenes
/3dipl/history-archive
/3dipl/backup
```

Cau hinh:

```env
MARKETPLACE_DRIVE_ROOT_FOLDER_ID=<id-thu-muc-models>
SCENES_DRIVE_ROOT_FOLDER_ID=<id-thu-muc-scenes>
HISTORY_ARCHIVE_DRIVE_FOLDER_ID=<id-thu-muc-history-archive>
MARKETPLACE_DRIVE_BACKUP_FOLDER_ID=<id-thu-muc-backup>
SCENES_DRIVE_BACKUP_FOLDER_ID=<id-thu-muc-backup>
```

Tai khoan Google da OAuth phai co quyen Editor tren cac thu muc. Sau do kiem tra:

```powershell
cd D:\LTinh\get-link-3d66\backend
npm run drive:check
```

Ket qua dung phai co `Automatic refresh: yes` va `Drive API: ok`.

## 5. Bat Drive va job nen

Luc moi cau hinh, giu write/Changes tat:

```env
MARKETPLACE_DRIVE_WRITE_ENABLED=false
MARKETPLACE_DRIVE_CHANGES_ENABLED=false
HISTORY_RETENTION_JOB_ENABLED=true
HISTORY_RETENTION_RUN_ON_START=false
MARKETPLACE_QUOTA_GRANT_JOB_ENABLED=true
MARKETPLACE_QUOTA_GRANT_INTERVAL_MS=60000
```

Chi sau khi `drive:check`, metadata dry-run va backup deu dung moi bat:

```env
MARKETPLACE_DRIVE_WRITE_ENABLED=true
MARKETPLACE_DRIVE_CHANGES_ENABLED=true
MARKETPLACE_DRIVE_RECONCILE_WORKER_ENABLED=true
MARKETPLACE_DRIVE_RECONCILE_INTERVAL_MS=2000
```

Full reconciliation duoc khoi dong tu Admin va tu dong noi cac batch 1-200
folder. Checkpoint, tong so da quet va loi duoc luu trong Mongo, nen reload UI
hoac restart backend khong lam mat tien do. Changes API tam dung trong khi full
reconciliation dang `queued/running` va tiep tuc sau khi job hoan tat.

### Cache cover tren VPS

Drive van la nguon anh goc. Backend tao WebP 480x480 tai volume ben vung, Nginx
doc cung volume de phuc vu catalog ma khong goi Drive cho moi cover:

```env
MARKETPLACE_COVER_CACHE_ENABLED=true
MARKETPLACE_COVER_CACHE_DIR=/var/lib/3dipl/media/covers
MARKETPLACE_COVER_PUBLIC_BASE_URL=/media/covers
MARKETPLACE_COVER_SIZE=480
MARKETPLACE_COVER_WEBP_QUALITY=80
MARKETPLACE_COVER_WORKER_ENABLED=true
MARKETPLACE_COVER_WORKER_CONCURRENCY=4
```

Backend mount volume voi quyen doc/ghi, Nginx mount cung thu muc read-only. Sau
khi deploy, queue cover cu va theo doi den khi `ready`:

```bash
npm run marketplace:covers:dry-run
npm run marketplace:covers:backfill
npm run marketplace:covers:verify
```

Backfill co checkpoint va website van fallback sang Drive trong luc worker chay.
Khong backup thu muc cache; khi thay VPS co the tao lai tu Drive.

Nginx phai serve `/media/covers/` tu cung volume voi cache header immutable mot
nam. Neu backend/frontend chay container rieng, mount volume read-write vao
backend va read-only vao Nginx. Tren Cloudflare tao Cache Rule:

```text
(http.host in {"3dipl.org" "www.3dipl.org"}
 and starts_with(http.request.uri.path, "/media/covers/"))
```

Dat `Cache eligibility = Eligible for cache`, `Edge TTL = 1 year` va de Browser
TTL ton trong header origin. Khong dat Cache Everything cho `/api`.

## 6. Download va Turnstile

```env
MARKETPLACE_DOWNLOAD_DELIVERY=proxy
MARKETPLACE_DOWNLOAD_REDIRECT_FALLBACK_PROXY=true
TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=<cloudflare-site-key>
TURNSTILE_SECRET_KEY=<cloudflare-secret-key>
TURNSTILE_EXPECTED_HOSTNAME=3dipl.org
TURNSTILE_EXPECTED_ACTION=marketplace_download
```

Local co the dung bo test key trong `.env.example`. Production phai dung key tao tren Cloudflare cho domain that.

## 7. Image search va discovery

Hai provider nay la tuy chon. De trong thi text search/recommendation fallback ve MongoDB, con image search that se khong hoat dong:

```env
MARKETPLACE_IMAGE_SEARCH_URL=
MARKETPLACE_IMAGE_SEARCH_API_KEY=
MARKETPLACE_DISCOVERY_URL=
MARKETPLACE_DISCOVERY_API_KEY=
```

## 8. Migration Atlas sang VPS

Truoc migration: dung upload/admin edit, backup ma hoa Atlas va VPS, sau do chay:

```powershell
cd D:\LTinh\get-link-3d66
npm --prefix backend run data:split:dry-run
npm --prefix backend run data:split:execute
```

`execute` chi copy va verify, chua xoa du lieu Atlas. Sau khi doi soat:

```powershell
$env:MIGRATION_CONFIRM="split-marketplace-data"
npm --prefix backend run data:split:finalize
Remove-Item Env:MIGRATION_CONFIRM
```

Khong luu `MIGRATION_CONFIRM` co dinh trong `.env`.

## 9. Kiem tra cuoi

```powershell
cd D:\LTinh\get-link-3d66
npm run check
npm run env:check
npm run drive:check
```

Hoac neu dang dung thu muc `backend`:

```powershell
cd D:\LTinh\get-link-3d66\backend
npm run env:check
npm run drive:check
```

Production can dat them `CLIENT_URL`, `PUBLIC_BASE_URL`, `CORS_ORIGINS`, cac secret bao mat, Google Login, SePay va Telegram theo `.env.example`.

## 10. Split database va backup

Production bat buoc dat `MONGO_CORE_URI`, `MONGO_MARKETPLACE_URI`,
`MARKETPLACE_DB_TARGET=vps` va
`MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED=true`. Local chi dung mot database phai
dat `MARKETPLACE_DB_TARGET=core` ro rang; `vps` khong fallback ve Atlas.

Backup can them:

```env
DATABASE_BACKUP_DRIVE_FOLDER_ID=
BACKUP_AGE_RECIPIENT=age1...
BACKUP_WORK_DIR=/var/lib/3dipl/backup-work
ATLAS_CORE_STORAGE_LIMIT_BYTES=524288000
VPS_DISK_PATH=/
```

Khong luu `BACKUP_AGE_IDENTITY_FILE` tren VPS production. Chi gan private key
tam thoi tren may restore tach biet. Xem `docs/STORAGE_BACKUP_RUNBOOK.md`.
