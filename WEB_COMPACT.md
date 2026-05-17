# WEB_COMPACT - 3DIPL / GETLINK 3D66

Tai lieu canonical gom README, GETLINK_REAL_3D66 va cac ghi chu hien trang he thong.
Dung file nay de dua cho AI khac doc lai va hieu nhanh kien truc, luong nghiep vu, bao mat, deploy va cac diem can canh giac.

Cap nhat gan nhat: 2026-05-17.

---

## 1. Muc Tieu He Thong

Web trung gian getlink 3D66:

- User dang nhap bang Google.
- User nap credit bang VietQR.
- User dan link 3D66 va xem preview model: ma model, ten, anh demo, gia credit.
- Backend dung cookie 3D66 admin de lay/mua link tai that.
- User tai file qua proxy backend, khong thay link `down.3d66.com` that.
- Backend khong luu file model len o cung.
- Backend luu user, credit, topup, voucher, cache model, lich su getlink, cookie 3D66, bai huong dan.
- User duoc tai lai mien phi model da mua trong `GETLINK_REDOWNLOAD_DAYS`, hien la 3 ngay.

Luong file:

```txt
3D66 -> Backend proxy -> Browser user
```

---

## 2. Trang Thai Co The Deploy Chua

He thong co the dua len moi truong test/staging duoc neu:

- MongoDB that dang chay on dinh.
- `ALLOW_MEMORY_DB=false`.
- Google OAuth dung redirect URI domain deploy.
- VietQR webhook co secret that.
- Co it nhat 1 cookie 3D66 hop le.
- Da test user thuong khong vao duoc admin.
- Da test user A khong tai duoc history cua user B.
- Da test topup, voucher, getlink, tai lai trong 3 ngay.

Chua nen production cong khai rong neu chua co:

- HTTPS/domain that.
- Firewall/server security.
- Backup MongoDB.
- Logging/monitoring loi webhook va 3D66.
- Cach xu ly khi cookie 3D66 bi khoa/cooldown het loat.
- Gioi han traffic theo user/IP o tang reverse proxy neu traffic lon.

---

## 3. Stack

```txt
Frontend: React + Vite + lucide-react
Backend: Node.js + Express
Auth: Passport Google OAuth + JWT httpOnly cookies
Database: MongoDB + Mongoose
3D66: fetch + Playwright fallback
Payment: VietQR image + webhook
Security: Helmet CSP/HSTS, CSRF, request guard, audit log, rate limit
```

---

## 4. Cau Truc Thu Muc

```txt
get-link-3d66/
  backend/
    server.js
    .env
    .env.example
    src/
      config/
        db.js
        memoryStore.js
      controllers/
        authController.js
        topupController.js
        voucherController.js
        getlinkController.js
        paymentController.js
        adminController.js
        settingsController.js
        guideController.js
      middleware/
        requireAuth.js
        adminOnly.js
        csrf.js
        rateLimit.js
        requestGuard.js
      models/
        User.js
        Topup.js
        TopupPackage.js
        Voucher.js
        Getlink.js
        ProductCache.js
        Cookie.js
        SiteSetting.js
        GuideArticle.js
      routes/
      utils/
        3d66Service.js
        3d66BrowserService.js
        3d66CookiePool.js
        creditService.js
        pricingService.js
        secretBox.js
        topupApprovalService.js
        validators.js
        vietqr.js

  frontend/
    src/
      App.jsx
      api.js
      i18n.js
      styles.css
      components/
      pages/
```

---

## 5. Frontend Routes

```txt
/           Trang chu public
/getlink    Trang getlink sau dang nhap
/topup      Nap credit
/history    Lich su tai rieng
/guide      Huong dan user, co anh minh hoa
/admin      Trang quan tri
```

Header:

- PC: nav `[ Getlink ] [ Nap credit ] [ Lich su ] [ Huong dan ]` can giua.
- Mobile: menu 3 gach ben phai.
- Tablet: credit/admin/VI EN/logout gom thanh menu account.

Trang chu public:

- Co o nhap nhanh link 3D66.
- Neu chua co link thi nut getlink khong nen submit.
- Neu da dang nhap va bam getlink thi chuyen `/getlink`.
- Neu chua dang nhap thi login Google roi quay lai `/getlink`.
- Link nhap san o trang chu duoc luu va dien san vao form `/getlink`.

---

## 6. Auth, JWT, Admin

Auth dung Google OAuth:

```txt
GET /api/auth/google
GET /api/auth/google/callback
POST /api/auth/logout
GET /api/auth/csrf
GET /api/user
POST /api/auth/2fa/generate
POST /api/auth/2fa/enable
POST /api/auth/2fa/verify
```

He thong hien dung JWT luu trong httpOnly cookies, khong dung `express-session` nua:

```txt
accessToken: 15 phut
refreshToken: 7 ngay
```

JWT payload co:

```txt
id
is2FAVerified
fp
```

`fp` la fingerprint SHA-256 tu IP + User-Agent. Neu token bi dung o browser/IP khac, backend clear token va tra `401`.

User moi:

```txt
credit = 0
```

Admin khong dung password rieng. Admin xac thuc bang email Google that:

```env
ADMIN_EMAILS=huylevan696@gmail.com
```

Neu email Google nam trong `ADMIN_EMAILS`:

```txt
role = admin
```

Neu khong:

```txt
role = user
```

Middleware:

- `requireAuth`: bat buoc dang nhap.
- `jwtAuth`: doc `accessToken/refreshToken`, refresh access token khi can, gan `req.user`.
- `adminOnly`: check `role=admin`, email trong `ADMIN_EMAILS`, va 2FA neu admin da bat.
- `csrfProtection`: bat CSRF token cho request ghi du lieu, tru webhook VietQR.
- `requestGuard`: chan payload co key nguy hiem truoc khi vao controller.

2FA:

- Admin co the bat 2FA TOTP bang QR code.
- Khi admin da bat 2FA, admin API se tra `2FA_REQUIRED` neu token JWT chua co `is2FAVerified=true`.
- Secret 2FA hien luu trong `User.twoFactorSecret`.
- Token OTP validate voi window 1 chu ky 30 giay.

Bao mat can giu:

- Bat 2FA Gmail admin va 2FA trong web admin.
- Khong tao login dev/SYS_ADMIN ngoai Google OAuth.
- Khong commit `.env`.
- `SESSION_SECRET` va `COOKIE_ENCRYPTION_KEY` phai dai, random.

---

## 7. Database Models

MongoDB collections chinh:

```txt
users
topups
topuppackages
vouchers
getlinks
productcaches
cookies
sitesettings
guidearticles
auditlogs
```

### User

```js
User {
  email,
  name,
  avatar,
  role: "user" | "admin",
  credit,
  twoFactorSecret,
  isTwoFactorEnabled,
  createdAt,
  updatedAt
}
```

### Topup

```js
Topup {
  userId,
  packageId,
  originalAmount,
  discountAmount,
  voucherCode,
  voucherDiscountPercent,
  voucherCreditBonus,
  amount,
  credit,
  type: "manual" | "auto" | "fake" | "vnpay" | "vietqr",
  status: "pending" | "approved" | "rejected",
  paymentCode,
  qrUrl,
  bankId,
  accountNo,
  accountName,
  expiresAt,
  paidAt,
  gatewayTransactionId,
  gatewayPayload
}
```

### TopupPackage

```js
TopupPackage {
  name,
  price,
  credit,
  salePercent,
  badge,
  features,
  isActive,
  sortOrder
}
```

### Voucher

```js
Voucher {
  code,
  description,
  creditBonus,
  discountPercent,
  usageLimit,
  usedCount,
  expireAt
}
```

### ProductCache

```js
ProductCache {
  productId,
  fileUrl,
  sourceUrl,
  title,
  imageUrl,
  creditCost,
  isPurchased
}
```

### Getlink

```js
Getlink {
  userId,
  productId,
  fileUrl,
  sourceUrl,
  title,
  imageUrl,
  creditUsed,
  createdAt
}
```

### Cookie

```js
Cookie {
  value, // encrypted
  label,
  isActive,
  status: "active" | "warning" | "cooldown" | "disabled",
  failureCount,
  useCount,
  cooldownUntil,
  lastUsedAt,
  lastErrorAt,
  lastErrorMessage,
  lastTestAt,
  lastTestOk,
  lastTestMessage
}
```

### SiteSetting

```js
SiteSetting {
  key: "homepage",
  heroText,
  heroSubtitle,
  saleText,
  pricingNote
}
```

### GuideArticle

```js
GuideArticle {
  title,
  slug,
  summary,
  coverImage,
  content,
  language: "vi" | "en",
  isPublished,
  sortOrder
}
```

### AuditLog

```js
AuditLog {
  actor,
  actorEmail,
  action,
  target,
  targetId,
  details, // sensitive fields redacted
  ip,
  userAgent,
  statusCode,
  createdAt
}
```

---

## 8. Env Hien Tai Can Co

Khong ghi secret that vao tai lieu public. Mau an toan:

```env
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/3d66
ALLOW_MEMORY_DB=false
SESSION_SECRET=<random-long-secret>
COOKIE_ENCRYPTION_KEY=<random-long-secret>
CLIENT_URL=http://localhost:5173
ADMIN_EMAILS=huylevan696@gmail.com
TRUST_PROXY=false
JSON_BODY_LIMIT=100kb
LOG_LEVEL=info

THREED66_MOCK=false
THREED66_DOWNLOAD_ENDPOINT=https://user.3d66.com/api/v1/download/handle
THREED66_ORIGIN=
THREED66_TIMEOUT_MS=30000
THREED66_BROWSER_HEADLESS=true
THREED66_BROWSER_CONCURRENCY=1
THREED66_BROWSER_ALWAYS=false
THREED66_BROWSER_BLOCK_ASSETS=true
THREED66_BROWSER_WAIT_NETWORKIDLE=false
THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK=false
THREED66_REQUEST_INTERVAL_MS=3000
THREED66_COOKIE_MAX_FAILURES=2
THREED66_COOKIE_COOLDOWN_MS=1800000
THREED66_SITE_CONTEXTS=

VND_PER_CNY=4000
WEB_CREDIT_PER_CNY=10
GETLINK_REDOWNLOAD_DAYS=3

MIN_TOPUP_AMOUNT=1000
MAX_MANUAL_CREDIT=1000000
MAX_STORED_CREDIT=10000000
MAX_VOUCHER_DISCOUNT_PERCENT=90
SYNC_DEFAULT_TOPUP_PACKAGES=false

GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>

VIETQR_BANK_ID=<bank-bin>
VIETQR_ACCOUNT_NO=<account-number>
VIETQR_ACCOUNT_NAME=<account-name>
VIETQR_TEMPLATE=Gptz5EP
VIETQR_IMAGE_HOST=https://api.vietqr.io/image
VIETQR_IMAGE_EXT=jpg
VIETQR_WEBHOOK_SECRET=<random-webhook-secret>
VIETQR_WEBHOOK_IPS=
```

Ghi chu:

- `THREED66_ORIGIN=` nen de rong de backend tu lay origin theo link model, ho tro nhieu host `3d/su/cad/tietu`.
- `SYNC_DEFAULT_TOPUP_PACKAGES=false` de admin sua goi nap khong bi default ghi de.
- `ALLOW_MEMORY_DB=false` khi chay that. Memory DB chi de dev tam.
- `VIETQR_WEBHOOK_IPS=` de rong thi cho tat ca IP dung secret; khi nha cung cap co IP co dinh thi dien danh sach IP cach nhau boi dau phay.
- `LOG_LEVEL=info` la mac dinh; co the dung `warn`, `error`, `debug` khi can.

---

## 9. Credit Va Gia

Ty le nap credit:

```txt
1 CNY = 4.000 VND
1 CNY = 10 credit web
=> 1 credit web = 400 VND
```

Vi du:

```txt
50.000 VND / 4.000 = 12,5 CNY
12,5 * 10 = 125 credit
```

Goi nap hien tai:

```txt
STARTER
50.000d
140 credit

BASIC
100.000d gia goc gach ngang
90.000d gia sale
280 credit
SALE 10%

PRO
200.000d gia goc gach ngang
170.000d gia sale
560 credit
SALE 15%

TEAM
500.000d gia goc gach ngang
400.000d gia sale
1400 credit
SALE 20%
```

Gia tai model:

- Backend doc gia goc 3D66.
- Neu 3D66 bao model gia `28 download coin/credit`, web tru `28 credit`.
- Preview chi xem thong tin, khong tru credit.
- Chi khi lay duoc link/file thanh cong backend moi tru credit va tao history.

---

## 10. VietQR Topup

Luong:

```txt
1. User chon goi.
2. Backend doc goi tu DB, khong tin price/credit tu frontend.
3. Backend tinh gia sau sale package.
4. Neu co voucher hop le, backend tinh giam gia/credit bonus.
5. Backend chan neu amount sau giam < MIN_TOPUP_AMOUNT.
6. Backend tao Topup pending + paymentCode NAP...
7. Frontend hien QR.
8. Webhook ngan hang goi backend.
9. Backend verify secret webhook.
10. Backend tim topup pending theo paymentCode.
11. Backend check amount >= topup.amount.
12. Backend check transactionId chua approve truoc do.
13. Backend approve, cong credit, ghi paidAt/gatewayPayload.
```

Webhook:

```txt
POST /api/payments/vietqr/webhook
```

Secret nam o header:

```txt
x-webhook-secret: <secret>
x-vietqr-secret: <secret>
Authorization: Bearer <secret>
```

Khong chap nhan secret trong body request.

---

## 11. Voucher

Voucher co 2 kieu:

- `discountPercent`: giam gia goi nap.
- `creditBonus`: cong them credit sau khi giao dich duoc duyet.

Quy tac:

- Apply voucher chi preview, khong tang `usedCount`.
- Tao QR co voucher van chua tang `usedCount`.
- `usedCount +1` chi khi webhook/admin approve topup thanh cong.
- Neu voucher het han/het luot tai luc approve, topup khong duoc cong credit.
- `MAX_VOUCHER_DISCOUNT_PERCENT=90` de tranh voucher 100% lam free.

---

## 12. Getlink 3D66

API:

```txt
POST /api/getlink/preview
POST /api/getlink
GET  /api/getlink/download/:id
GET  /api/getlink/history
POST /api/getlink/inspect  admin only
```

Luong preview:

```txt
1. User dan link.
2. Backend validate request.
3. Backend extract productId, uu tien query `sof`.
4. Backend check ProductCache.
5. Neu cache co title/image/creditCost tot thi tra nhanh.
6. Neu thieu metadata, backend fetch HTML 3D66 bang cookie admin.
7. Neu gap Aliyun WAF/challenge, backend dung Playwright fallback.
8. Backend parse productId/title/image/price/creditCost.
9. Backend update ProductCache.
10. Frontend hien thong tin model cho user xac nhan.
```

Luong download:

```txt
1. User bam tai.
2. Backend validate request.
3. Backend check user da dang nhap.
4. Backend check active redownload trong 3 ngay.
5. Neu da mua trong 3 ngay, tra link tai lai mien phi.
6. Neu chua mua, backend check credit >= creditCost.
7. Backend check ProductCache/fileUrl.
8. Neu can, backend goi 3D66 download API.
9. Backend chi tru credit sau khi lay duoc cache/fileUrl hop le.
10. Backend tao Getlink history.
11. Backend tra link noi bo `/api/getlink/download/:historyId`.
```

Khong tra link `down.3d66.com` that ra frontend.

---

## 13. Download Proxy

User nhan link:

```txt
/api/getlink/download/:historyId
```

Endpoint nay:

- Bat dang nhap.
- Chi cho tai neu `Getlink.userId === req.user._id`.
- Check con trong han tai lai mien phi.
- Dung cookie 3D66 admin de request file that.
- Forward header quan trong: `Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges`.
- Ho tro `Range` header.
- Stream bang pipeline, khong buffer ca file vao RAM.
- Neu `auth_key` het han, dung `sourceUrl` de refresh link 3D66.
- Refresh link khong tru credit lan nua.

Neu qua han:

```txt
403 Free redownload expired
```

---

## 14. 3D66 Real API

Endpoint that:

```txt
POST https://user.3d66.com/api/v1/download/handle
```

Request:

```txt
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
Origin: origin theo model host
Referer: origin/
Cookie: cookie 3D66 admin
User-Agent: Chrome desktop
```

Field co dinh:

```txt
action=user_pay_download
rartype=1
needtype=1
st=2
source=0
click_res_source=1
collect=0
model_num=1
position=1
down_type=0
is_business=0
is_commercial=false
```

Field dong:

```txt
ll_id      query `sof` hoac HTML/page data
token      parse tu page/script/browser
up_time    parse tu page/script/browser
resUrl     URL model day du
referrer   URL model khong co alichlgref
uid        cookie Hm_lvt_bh_ud
uid_front  cookie Hm_lvt_bh_ud_uid_front
site       theo host/context
page_type  theo host/context
```

Response hop le:

```json
{
  "status": 200,
  "data": "https://down.3d66.com/allres/res/...rar?auth_key=...",
  "msg": "...",
  "request_id": "..."
}
```

Backend chi chap nhan khi:

- status/code = 200.
- `data` la URL.
- host thuoc `3d66.com`, uu tien `down.3d66.com`.

---

## 15. Domain 3D66 Can Ho Tro

```txt
3d.3d66.com
su.3d66.com
cad.3d66.com
xiaoguotu.3d66.com
fanganwenben.3d66.com
tietu.3d66.com
linggantu.3d66.com
www.3d66.com
3d66.com
```

`THREED66_ORIGIN` de rong giup backend tu lay:

```txt
origin = new URL(modelUrl).origin
```

Neu subdomain nao can site/page context rieng, set:

```env
THREED66_SITE_CONTEXTS={"cad.3d66.com":{"site":"8","pageType":"5","accessSourceSite":"8","accessSourcePage":"5"}}
```

---

## 16. Metadata 3D66

Can lay:

```txt
productId / ll_id / sof
title
imageUrl
original price
creditCost
sourceUrl
```

Thu tu parse:

1. `#detail_data` JSON trong HTML.
2. DOM chinh: `h1.model-name`, `.llimgs`, `.orginal-price`, `.price`.
3. Meta fallback: `<title>`, `meta[property="og:image"]`.
4. URL fallback: query `sof`.

Neu model co nhieu anh:

- Uu tien anh o khu vuc giua `.detail-swiper .llimgs`.
- Uu tien anh `data-img-type="1"` neu co.
- Mot so CAD/model chi co 1 anh, khong co thumbnail nho.

Neu HTML response la Aliyun WAF challenge:

```txt
textarea#renderData
aliyun_waf
acw_sc__v2
hasTitleTag=false
hasScriptOnlyShell=true
```

Thi fetch thuong khong parse duoc, phai dung Playwright fallback.

---

## 17. Playwright Fallback

Dung khi 3D66 tra WAF/challenge.

Y tuong:

```txt
1. Mo Chromium headless.
2. Gan cookie 3D66 vao context.
3. page.goto(modelUrl).
4. Cho selector `h1.model-name`, `#detail_data`, `.llimgs`, `.orginal-price`.
5. page.evaluate de lay metadata.
6. Dong context.
```

Cau hinh toi uu:

```env
THREED66_BROWSER_HEADLESS=true
THREED66_BROWSER_CONCURRENCY=1
THREED66_BROWSER_BLOCK_ASSETS=true
THREED66_BROWSER_WAIT_NETWORKIDLE=false
THREED66_BROWSER_ALWAYS=false
```

Giai thich:

- Concurrency 1 de giam nguy co bi ban.
- Block assets de load nhanh hon.
- Khong doi networkidle de tranh treo khi site co tracking/ads.

---

## 18. Cookie Pool 3D66

Admin co the luu nhieu cookie.

Cookie can co toi thieu:

```txt
PHPSESSID
login_token
login_sign
Hm_lvt_bh_ud
Hm_lvt_bh_ud_uid_front
```

Backend:

- Ma hoa cookie bang AES-GCM trong `secretBox.js`.
- Khong tra cookie raw ve frontend.
- Chi hien preview/missing keys/status.
- Chon cookie usable theo status/failure/cooldown/useCount.
- Neu cookie loi, tang failure.
- Neu loi qua nguong, dua vao cooldown.
- Neu con cookie khac, thu cookie khac.

Cau hinh:

```env
THREED66_COOKIE_MAX_FAILURES=2
THREED66_COOKIE_COOLDOWN_MS=1800000
THREED66_REQUEST_INTERVAL_MS=3000
```

---

## 19. Bao Mat Da Nang Cap

### 19.1 Helmet, CSP va header bao mat

- Backend dung `helmet`.
- Production bat CSP:
  - `default-src 'self'`
  - `script-src 'self'`
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' https://respic.3d66.com https://api.vietqr.io data:`
  - `connect-src 'self'`
  - `frame-src 'none'`
  - `object-src 'none'`
- Production bat HSTS 1 nam, include subdomains.
- Tat `x-powered-by`.
- Them `permissions-policy: camera=(), microphone=(), geolocation=()`.
- `crossOriginEmbedderPolicy=false` de tranh gay loi asset ngoai can thiet trong dev/use case hien tai.

### 19.2 Secret va JWT cookie

- `SESSION_SECRET` bat buoc manh trong production.
- `COOKIE_ENCRYPTION_KEY` dung de ma hoa cookie 3D66.
- Auth token luu bang httpOnly cookies:
  - `accessToken` het han 15 phut.
  - `refreshToken` het han 7 ngay.
  - `httpOnly=true`
  - `sameSite=lax`
  - `secure=true` khi production.
- JWT co fingerprint IP + User-Agent de giam rui ro token bi cuop.
- Khi fingerprint mismatch, backend clear token va log `SESSION_HIJACK_SUSPECT`.

### 19.3 Google OAuth va 2FA admin

- Google OAuth chay `session:false`, backend tao JWT sau callback.
- `returnTo` duoc validate bang safe path regex, tranh open redirect.
- Admin phai co:
  - `role=admin`
  - email nam trong `ADMIN_EMAILS`
  - neu da bat 2FA thi JWT phai co `is2FAVerified=true`
- Admin 2FA dung TOTP OTPAuth + QRCode.
- `temp2FASecret` luu cookie httpOnly 10 phut trong luc setup.

Luu y: neu production can hardening them OAuth CSRF, nen bat/giu `state` OAuth hoac co cookie state rieng.

### 19.4 CSRF

- Frontend goi `GET /api/auth/csrf`.
- Moi request mutating gui `x-csrf-token`.
- Backend reject request ghi du lieu neu token sai.
- Webhook VietQR duoc skip CSRF vi dung secret rieng.
- CSRF secret luu cookie httpOnly `csrfSecret`, token la HMAC bang `SESSION_SECRET`.

### 19.5 Request guard

Middleware `requestGuard.js` reject:

```txt
$set
$where
$ne
key co dau .
__proto__
prototype
constructor
```

Muc tieu:

- Chong NoSQL injection.
- Chong prototype pollution.
- Chan payload ban truoc khi vao controller/DB.

### 19.6 Route validation

Da validate truoc khi ghi DB:

- Topup: chi nhan `packageId`, `price`, `voucherCode`.
- Voucher: code format hop le, max discount theo env.
- Admin credit: id hop le, credit trong gioi han.
- Topup package: price/credit/salePercent/features hop le.
- Guide/settings: reject unknown keys, gioi han do dai.
- Getlink: reject unknown key, URL qua dai, id khong hop le.

### 19.7 Webhook

- Secret chi doc tu header, khong doc tu body.
- So sanh secret bang `timingSafeEqual`.
- Co `webhookIpGuard`: neu `VIETQR_WEBHOOK_IPS` duoc cau hinh thi chi cho IP trong allowlist goi webhook.
- Check `paymentCode`.
- Check amount.
- Check duplicate `gatewayTransactionId`.
- Chi approve topup dang pending.

### 19.8 SSRF/cookie leak

- `request3D66File` chi chap nhan host `3d66.com` hoac subdomain `.3d66.com`.
- Khong gui cookie 3D66 den domain la nhu `3d66.com.evil.com`.

### 19.9 Rate limit

Co rate limit in-memory:

```txt
getlink preview: 30/min
getlink create: 10/min
download: 30/min
topup create: 20/min
auth google: 40/10min
webhook: 120/min
admin write: 30/min theo user/IP
```

Can them reverse proxy rate limit khi deploy production.

### 19.10 Audit log va logging

- Backend dung `pino`.
- Dev dung `pino-pretty`, production log JSON.
- Logger redact:
  - cookie header
  - authorization header
  - password/secret/cookieValue/value
- `securityEvent()` log cac su kien security o level warn.
- `auditAdmin()` log hanh dong admin vao collection `auditlogs`.
- Cac hanh dong audit:
  - add/set credit
  - save/delete cookie
  - create/delete voucher
  - create/update/delete/reorder package
  - approve/reject topup
  - create/update/delete article
- Body audit duoc sanitize, field nhay cam bi `[REDACTED]`, string dai bi cat ngan.

### 19.11 Error response

- Error >= 500 duoc log level error.
- Error < 500 log warn.
- Production an chi tiet loi server bang message chung `Internal server error`.

---

## 20. API Backend

Auth:

```txt
GET  /api/auth/csrf
GET  /api/auth/google
GET  /api/auth/google/callback
POST /api/auth/logout
GET  /api/auth/user
GET  /api/user
POST /api/auth/2fa/generate
POST /api/auth/2fa/enable
POST /api/auth/2fa/verify
```

Settings:

```txt
GET  /api/settings
POST /api/settings        admin
```

System:

```txt
GET /api/system/3d66-status
```

Credit/topup:

```txt
GET  /api/credit
GET  /api/topup/packages
POST /api/topup
GET  /api/topup/history
```

Voucher:

```txt
POST /api/voucher/apply
```

Payment:

```txt
POST /api/payments/vietqr/webhook
```

Getlink:

```txt
POST /api/getlink/preview
POST /api/getlink
GET  /api/getlink/download/:id
GET  /api/getlink/history
POST /api/getlink/inspect   admin
```

Admin:

```txt
GET    /api/admin/overview
GET    /api/admin/users
GET    /api/admin/audit-logs
POST   /api/admin/add-credit
POST   /api/admin/set-credit
GET    /api/admin/cookies
POST   /api/admin/cookie
POST   /api/admin/cookie/test
POST   /api/admin/cookies/:id/test
DELETE /api/admin/cookies/:id
GET    /api/admin/vouchers
POST   /api/admin/voucher
DELETE /api/admin/vouchers/:id
GET    /api/admin/topup-packages
POST   /api/admin/topup-packages
POST   /api/admin/topup-packages/reorder
PUT    /api/admin/topup-packages/:id
DELETE /api/admin/topup-packages/:id
GET    /api/admin/topups/pending
POST   /api/admin/topups/:id/approve
POST   /api/admin/topups/:id/reject
GET    /api/admin/articles
POST   /api/admin/articles
PUT    /api/admin/articles/:id
DELETE /api/admin/articles/:id
```

Guide public:

```txt
GET /api/guides
GET /api/guides/:slug
```

---

## 21. Huong Dan Va Bai Viet

Frontend:

- `/guide` hien bai huong dan user.
- Header co nut `Huong dan`.
- Bai viet co cover image va anh trong noi dung.

Admin:

- Tab `Bai viet`.
- Tao/sua/xoa bai viet.
- Field:
  - title
  - slug
  - summary
  - coverImage
  - content
  - language
  - isPublished
  - sortOrder

Anh inline trong content dung syntax:

```md
![Mo ta anh](https://example.com/image.png)
```

Frontend render React text node, khong dung `dangerouslySetInnerHTML`.

---

## 22. Chay Local

Cai dependency:

```powershell
npm run install:all
```

Cai Playwright Chromium:

```powershell
cd backend
npx playwright install chromium
```

Chay dev:

```powershell
npm run dev
```

Backend rieng:

```powershell
npm run dev --prefix backend
```

Frontend rieng:

```powershell
npm run dev --prefix frontend
```

Build frontend:

```powershell
npm run build --prefix frontend
```

---

## 23. MongoDB

`.env` dang dung:

```env
MONGO_URI=mongodb://127.0.0.1:27017/3d66
ALLOW_MEMORY_DB=false
```

Neu Mongo local khong chay, backend phai crash. Neu backend van chay, kiem tra:

- Process `mongod` co dang chay khong.
- Port `127.0.0.1:27017` co open khong.
- Backend process cu co dang chay config cu khong.

Memory DB chi dung dev:

```env
ALLOW_MEMORY_DB=true
```

Khong dung memory DB khi deploy that vi restart se mat data.

---

## 24. Deploy Local Network

Vite co the hien:

```txt
Local:   http://localhost:5173
Network: http://192.168.1.x:5173
Network: http://26.x.x.x:5173
```

Nhieu network la do may co nhieu adapter:

- LAN/Wi-Fi: `192.168.x.x`
- VPN/Tailscale/Radmin/Hamachi: `26.x.x.x`

Dung IP LAN neu test cung Wi-Fi.

Can chu y:

- `CLIENT_URL` phai khop frontend origin.
- Backend port 5000 phai mo firewall.
- Google OAuth redirect phai dung backend domain.
- Neu deploy khac domain, can xem lai cookie `SameSite=None; Secure` hoac dat frontend/backend cung site.

---

## 25. Checklist Test Truoc Khi Public

Auth:

- User Google login duoc.
- Admin Google login duoc.
- User thuong khong vao `/admin`.
- Admin bat 2FA thi `/api/admin/*` bi chan den khi verify OTP.
- Fingerprint mismatch cua JWT bi clear token va tra 401.
- Logout xong khong goi API protected duoc.

Security:

- Helmet/CSP/HSTS production khong lam vo frontend/API.
- Request co `$set`, `$where`, `__proto__` bi reject.
- POST protected thieu CSRF bi reject.
- Webhook sai secret bi reject.
- Neu set `VIETQR_WEBHOOK_IPS`, IP ngoai allowlist bi reject.
- Body secret/token webhook khong duoc chap nhan.
- User A khong tai duoc history User B.
- Admin action ghi vao `auditlogs`, khong luu raw cookie/secret.

Topup:

- Tao QR dung so tien sau sale.
- Voucher apply chi preview, chua tang usedCount.
- Webhook dung amount approve duoc.
- Webhook amount thieu bi reject.
- Duplicate transactionId khong approve lai.
- Voucher 100% hoac amount qua thap bi reject.

Getlink:

- Preview lay duoc title/image/creditCost.
- Cookie loi thi trang bao dich vu dang loi, khong lo chi tiet cookie cho user.
- Getlink thanh cong tru dung credit.
- Link tra ve la `/api/getlink/download/:id`.
- Download proxy tai duoc file.
- Tai lai trong 3 ngay khong tru credit.
- Qua 3 ngay bi chan va yeu cau getlink lai.

3D66:

- Co it nhat 1 cookie active.
- Cookie pool failover khi 1 cookie loi.
- Cookie loi vao warning/cooldown.
- Browser concurrency de 1 luc moi chay that.

Payment/admin:

- Admin duyet topup cap nhat user credit ngay.
- Admin cong credit tao lich su topup manual.
- Goi nap admin sua khong bi default sync ghi de.

Build:

```powershell
node --check backend/server.js
node --check backend/src/middleware/jwtAuth.js
node --check backend/src/middleware/auditLog.js
node --check backend/src/middleware/webhookGuard.js
npm run build --prefix frontend
npm audit --omit=dev --prefix backend
npm audit --omit=dev --prefix frontend
```

---

## 26. Loi Thuong Gap

Google `invalid_client`:

- Sai `GOOGLE_CLIENT_ID` hoac `GOOGLE_CLIENT_SECRET`.

Google `redirect_uri_mismatch`:

- Google Cloud Console chua them:

```txt
http://localhost:5000/api/auth/google/callback
```

3D66 offline:

- Chua co cookie.
- Cookie thieu `PHPSESSID/login_token/login_sign`.
- Cookie het han.
- Tat ca cookie dang cooldown.
- 3D66 WAF chan request/browser.

Preview chi hien ma model va gia 1 credit:

- Backend fetch bi WAF challenge.
- Playwright fallback loi/chua cai Chromium.
- Cookie thieu `acw_sc__v2` hoac bi block.

Tai file duoc vai tram KB roi dung:

- 3D66 tra HTML/challenge thay vi file.
- Cookie/session bi khoa.
- Backend can refresh link/cookie hoac test cookie khac.

Mat data sau restart:

- Dang dung memory DB.
- Chuyen ve MongoDB that va `ALLOW_MEMORY_DB=false`.

---

## 27. Luu Y Van Hanh

- Khong public `.env`.
- Khong public cookie 3D66.
- Khong tra raw error 3D66/cookie cho user.
- Khong tang traffic 3D66 dot ngot.
- Nen co nhieu cookie du phong.
- Nen backup MongoDB hang ngay neu co user that.
- Nen dung HTTPS khi public.
- Nen dat backend sau reverse proxy co rate limit.
- Nen theo doi log webhook va getlink loi.
