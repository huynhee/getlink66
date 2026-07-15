# Tai lieu he thong Get Link 3D66

Cap nhat: 2026-07-11
Pham vi doc: toan bo source backend, frontend, route, controller, model, middleware, utility, cau hinh mau va public assets trong repo.

Luu y bao mat: tai lieu nay khong sao chep gia tri that trong `backend/.env`. Cac muc cau hinh duoc mo ta theo ten bien trong `backend/.env.example`.

## 1. Tong quan

Day la he thong full-stack cho dich vu 3DIPL/Getlink 3D66. Nguoi dung dang nhap bang Google, nap credit qua SePay, dung credit de tao link tai model tu 3D66, sau do tai file qua backend proxy. He thong co admin panel de quan ly user, credit, goi nap, voucher, cookie 3D66, bai huong dan, thong bao, log va cac tham so runtime lien quan den 3D66.

Muc tieu nghiep vu chinh:

- Xac thuc nguoi dung bang Google OAuth.
- Luu credit cho tung user.
- Kiem tra thong tin model 3D66: product id, ten, anh, gia credit.
- Ho tro chon dinh dang file 3D66 khi model co popup format, gom fileFormat, version, renderer va dung luong nen.
- Tru credit an toan khi user tao getlink.
- Luu lich su getlink va cho phep tai lai mien phi trong cua so thoi gian/gioi han cau hinh.
- Cho phep tai kem anh preview cua model bang link noi bo rieng, khong luu binary anh tren DB/server.
- Tao checkout SePay cho cac goi nap credit.
- Nhan IPN/webhook de duyet topup va cong credit.
- Ho tro voucher giam gia hoac cong credit bonus.
- Ho tro chuong trinh gioi thieu ban be.
- Quan tri cookie 3D66, fallback Playwright, proxy rieng cho 3D66 va hang doi request de giam nguy co bi 3D66 chan.
- Hien thi frontend React cho user va admin.

## 2. Cau truc thu muc

```text
.
|-- package.json
|-- eslint.config.js
|-- .github/workflows/ci.yml
|-- docs/
|-- backend/
|   |-- server.js
|   |-- package.json
|   |-- Dockerfile
|   |-- .env.example
|   `-- src/
|       |-- config/
|       |-- controllers/
|       |-- middleware/
|       |-- models/
|       |-- routes/
|       `-- utils/
`-- frontend/
    |-- index.html
    |-- package.json
    |-- Dockerfile
    |-- nginx.conf
    |-- public/
    |-- dist/
    `-- src/
        |-- api.js
        |-- App.jsx
        |-- i18n.js
        |-- styles.css
        |-- components/
        |-- pages/
        `-- utils/
```

Root `package.json` chi dong vai tro orchestration:

- `npm run install:all`: cai dependencies cho backend va frontend.
- `npm run dev`: chay backend va frontend song song bang `concurrently`.
- `npm start`: start backend.
- `npm run lint`: ESLint backend/test/frontend.
- `npm test`: Node test runner cho backend.
- `npm run build`: Vite production build.
- `npm run check`: lint + test + build.

Backend va frontend la 2 package rieng:

- Backend: Node.js ESM, Express, Mongoose, Passport Google OAuth, JWT, Playwright, SePay SDK, Pino, Undici/ProxyAgent.
- Frontend: React 18, Vite, lucide-react.

## 3. Backend

### 3.1 Entry point `backend/server.js`

`server.js` khoi tao Express app va thuc hien cac viec sau:

- Load `.env` bang `import "dotenv/config"` truoc cac import doc env de `LOG_LEVEL` va runtime config co hieu luc dung thu tu.
- Kiem tra cac secret bat buoc trong production:
  - `JWT_SECRET`
  - `CSRF_HMAC_SECRET`
  - `COOKIE_SIGNATURE_SECRET`
  - `DOWNLOAD_TOKEN_SECRET`
  - `COOKIE_ENCRYPTION_KEY`
  - `CLIENT_URL`
  - `PUBLIC_BASE_URL`
  - Cac bien SePay neu `SEPAY_ENABLED` khac `false`.
- Ket noi MongoDB qua `connectDb()`.
- Import model/controller/route sau khi DB san sang.
- Goi `ensureTopupIndexes()`, `ensurePaymentReceiptIndexes()` va `ensureNotificationReceiptIndexes()` truoc khi listen.
- Goi `initializeSettings()` de tao/cap nhat document settings mac dinh va apply runtime env.
- Cau hinh Express security:
  - `helmet`
  - CSP trong production
  - HSTS trong production
  - `compression`
  - `permissions-policy`
  - JSON body limit qua `JSON_BODY_LIMIT`
  - CORS voi allowlist tu `CLIENT_URL`, localhost va `CORS_ORIGINS`
  - signed cookie parser bang `COOKIE_SIGNATURE_SECRET`
- Cau hinh Passport Google OAuth neu co `GOOGLE_CLIENT_ID` va `GOOGLE_CLIENT_SECRET`.
- Mount middleware chung:
  - `jwtAuth`
  - `requestGuard`
  - `csrfProtection`
- Mount route:
  - `/health`
  - `/ready`: 200 khi khong drain va Mongo connected (hoac dev memory mode), nguoc lai 503.
  - `/api/user`
  - `/api/auth`
  - `/api`
  - `/api/admin`
- Global error handler:
  - Log loi server bang Pino.
  - Gui Telegram alert neu la loi 5xx.
  - An message noi bo trong production.
- SIGINT/SIGTERM graceful shutdown:
  - Dung nhan ket noi HTTP moi va dat readiness false.
  - Cho request dang chay ket thuc, dong Playwright browser, proxy agents va Mongo.
  - Force timeout sau 30 giay.

### 3.2 Database va memory fallback

File `backend/src/config/db.js` ket noi MongoDB bang `MONGO_URI`.

Neu khong co `MONGO_URI` hoac MongoDB khong ket noi duoc:

- Neu `ALLOW_MEMORY_DB=true` va khong phai production, he thong dung memory store.
- Neu production ma `ALLOW_MEMORY_DB=true`, server throw error.
- Neu khong cho phep memory DB, server throw error.

`backend/src/config/memoryStore.js` la in-memory model adapter cho dev/test local. Adapter nay mo phong mot phan API Mongoose:

- `create`
- `insertMany`
- `find`
- `findOne`
- `findById`
- `findOneAndUpdate`
- `findByIdAndUpdate`
- `findByIdAndDelete`
- `findOneAndDelete`
- `countDocuments`
- `exists`
- `deleteMany`
- `deleteOne`
- chain helpers: `sort`, `limit`, `select`, `lean`, `populate`
- query/update operators can cho service production nhu `$expr`, `$in`, `$nin`, `$unset`, `$push`, nested path va regex.

Memory store khong thay the MongoDB production. No chi dung khi cau hinh dev cho phep.

### 3.3 Models

#### `User`

Luu tai khoan Google va credit:

- `email`, `name`, `avatar`
- `role`: `user` hoac `admin`
- `credit`
- referral:
  - `referralCode`
  - `referredBy`
  - `referralRewardedAt`
- 2FA:
  - `twoFactorSecret`: secret moi duoc ma hoa AES-256-GCM; plaintext legacy duoc dual-read va re-encrypt sau verify thanh cong.
  - `isTwoFactorEnabled`
- ban:
  - `isBanned`
  - `banReason`
  - `bannedAt`
  - `bannedBy`

#### `Getlink`

Luu lich su user tao link:

- `userId`
- `productId`
- `fileUrl`
- `sourceUrl`
- `resolvedSourceUrl`: URL model 3D66 da duoc resolve theo cookie/sign cua he thong; uu tien dung khi refresh/tai lai.
- `title`
- `imageUrl`
- `creditUsed`
- `downloadFormat`:
  - `key`
  - `label`
  - `fileFormat`
  - `formatVersion`
  - `rendererType`
  - `rendererLabel`
  - `size`
- `initialDownloadAt`
- `redownloadCount`
- `lastRedownloadAt`

Co index theo user, product va createdAt de truy van lich su va admin.

#### `ProductCache`

Cache metadata/file link cua 3D66:

- `productId`
- `fileUrl`
- `sourceUrl`
- `resolvedSourceUrl`: URL sach/sign cua tai khoan 3D66 trong cookie pool, dung lai de tranh resolve footprint/browser lap lai.
- `title`
- `imageUrl`
- `creditCost`
- `priceKnown`
- `formatOptions`
- `formatOptionsVersion`
- format selection da mua/cache:
  - `downloadFormatKey`
  - `fileFormat`
  - `formatVersion`
  - `rendererType`
  - `rendererLabel`
  - `formatLabel`
  - `formatSize`
- `isPurchased`

Cache giup tranh mua/lay lai link khong can thiet va tang toc preview.

#### `Topup`

Luu giao dich nap credit:

- `userId`
- `packageId`
- `originalAmount`
- `discountAmount`
- `voucherCode`
- `voucherDiscountPercent`
- `voucherCreditBonus`
- `amount`
- `credit`
- `type`: `manual`, `auto`, `fake`, `vnpay`, `vietqr`, `sepay`
- `status`: `pending`, `approved`, `rejected`
- `paymentCode`
- `qrUrl`
- `checkoutUrl`
- `gatewayProvider`
- thong tin ngan hang/gateway
- `expiresAt`, `paidAt`, `canceledAt`
- `gatewayTransactionId`
- `gatewayPayload`
- `idempotencyKey`: client key de replay request tao topup ma khong tao them order.

Index quan trong:

- Unique partial index `paymentCode` khi `status=pending` de tranh 2 don dang cho cung ma thanh toan.
- Unique partial index `(userId, idempotencyKey)` cho request co key.
- Index theo user, status, paidAt, package va voucher.

#### `PaymentReceipt`

Receipt bat bien de enforce payment idempotency o database:

- `gatewayTransactionId`: unique.
- `topupId`: unique.
- `provider`, `amount`, timestamps.

Receipt duoc claim trong cung transaction approve topup khi production dung Mongo replica set.

#### `NotificationReceipt`

Luu trang thai da doc theo tung user ma khong lam mang `Notification.readBy` tang vo han:

- `notificationId`, `userId`, `readAt`.
- Unique compound index `(notificationId, userId)`.
- Index `(userId, readAt)` cho read path.

Read path van hop nhat `readBy` legacy de rollout tuong thich; write moi dung receipt.

#### `TopupPackage`

Goi nap credit:

- `name`
- `price`
- `credit`
- `salePercent`
- `salePrice`
- `maxTopupsPerUser`
- `badge`
- `features`
- `isActive`
- `sortOrder`

Backend có 5 gói Credit mặc định: Trải nghiệm, Starter, Basic, Pro Credit và Team. `TOPUP_PACKAGE_CATALOG_MIGRATION_ENABLED=true` chạy migration theo revision đúng một lần; chỉnh sửa của admin sau revision không bị ghi đè khi tải lại trang.

#### `Voucher`

Ma voucher:

- `code`
- `description`
- `targetKind`: `credit`, `pro`, hoac `all`
- `isActive`
- `archivedAt`
- `creditBonus`
- `discountPercent`
- `usageLimit`
- `perUserLimit`
- `applicablePackageIds`
- `usedCount`
- `expireAt`

Quy tac voucher:

- Voucher `credit` chi dung cho topup Credit; co the giam gia, tang credit, hoac ca hai.
- Voucher `pro` chi dung cho MembershipOrder; chi giam phan tram, khong cong credit.
- Voucher `all` dung chung Credit va Pro; chi giam phan tram.
- Voucher da co Topup/MembershipOrder khong duoc doi `code` hoac `targetKind`.
- DELETE voucher da co giao dich chi archive (`isActive=false`), khong xoa document de cac don pending va audit cu van doi soat duoc.
- Voucher archive bi chan o checkout moi, nhung don pending da tao van giu snapshot gia/voucher cua don.

#### `VoucherRedemption`

Luu slot redeem voucher theo user:

- `userId`
- `voucherCode`
- `topupId`
- `slot`

Index unique:

- `topupId`
- `userId + voucherCode + slot`

Dung de tranh voucher bi dung qua `perUserLimit` trong race condition.

#### `Cookie`

Luu cookie 3D66 da ma hoa:

- `value`
- `label`
- `isActive`
- `status`: `active`, `warning`, `cooldown`, `disabled`
- `failureCount`, `useCount`
- `cooldownUntil`
- `lastUsedAt`
- `lastErrorAt`
- `lastErrorMessage`
- `lastTestAt`
- `lastTestOk`
- `lastTestMessage`

Cookie can co cac key 3D66 bat buoc: `PHPSESSID`, `login_token`, `login_sign`.

#### `SiteSetting`

Luu text trang chu va tham so runtime:

- Text landing page: hero, pricing, guide, CTA, footer.
- Referral mode: `both`, `referrer_only`, `off`.
- Tham so 3D66:
  - che do resolve model: `search`, `footprint`, `direct`
  - concurrency getlink/preview/refresh
  - paytype value
  - request interval
  - account marker/search config
  - proxy rieng cho 3D66
  - browser fallback flags
  - proxy 3D66 rieng cho preview/API/download/browser
  - timeout
  - cookie failure/cooldown
  - download concurrency limits
  - redownload window/limit

`threed66ProxyUrl` duoc ma hoa bang `secretBox` truoc khi luu. Public `/api/settings` chi tra `threed66ProxyUrlConfigured`, khong tra URL that.

Khi settings duoc load/cap nhat, backend apply cac field runtime vao `process.env`.

#### `Notification`

Thong bao user:

- `title`
- `body`
- `displayType`: `dropdown`, `fullscreen`
- `imageUrl`
- `actionLabel`, `actionUrl`
- `targetType`: `all`, `users`
- `userIds`
- `readBy`
- `createdBy`
- `isActive`
- `startsAt`, `expiresAt`

#### `GuideArticle`

Bai huong dan:

- `title`
- `slug`
- `summary`
- `coverImage`
- `content`
- `language`: `vi`, `en`
- `isPublished`
- `sortOrder`

#### `Referral`

Luu thuong gioi thieu:

- `referrerId`
- `referredUserId`
- `referralCode`
- `rewardCredit`
- `referrerRewardCredit`
- `referredRewardCredit`
- `rewardMode`: `both`, `referrer_only`
- `status`: `rewarded`, `ignored`
- `rewardedAt`

#### `AuditLog`

Luu audit admin action:

- `actor`, `actorEmail`
- `action`
- `target`, `targetId`
- `details`
- `ip`, `userAgent`
- `statusCode`

#### `SystemLog`

Luu log he thong:

- `type`: `getlink`, `download`, `cookie`, `payment`, `security`, `system`
- `level`: `info`, `warn`, `error`
- `message`
- `userId`
- `productId`
- `historyId`
- `status`
- `ip`
- `path`
- `details`

### 3.4 Middleware

#### `jwtAuth`

Dung JWT trong httpOnly cookies:

- `accessToken`: 15 phut.
- `refreshToken`: 7 ngay.
- Token co `tokenType`, `id`, `is2FAVerified`, `fp`, `loginAt`.
- Fingerprint dua tren User-Agent va tuy chon IP:
  - `SESSION_FINGERPRINT_BIND_IP`
  - `SESSION_FINGERPRINT_ENFORCE`
- Neu access het han va refresh hop le, middleware rotate token.
- Neu fingerprint thay doi:
  - mac dinh rotate token moi.
  - neu enforce bat, clear cookie va tra 401.

#### `csrfProtection`

Bao ve request ghi:

- Safe methods: `GET`, `HEAD`, `OPTIONS`.
- Skip paths:
  - `/api/auth/csrf`
  - `/api/payments/vietqr/webhook`
  - `/api/payments/sepay/ipn`
- Backend tao `csrfSecret` httpOnly cookie.
- Frontend goi `/api/auth/csrf`, nhan HMAC token va gui header `x-csrf-token`.

#### `requestGuard`

Chan payload/query nguy hiem:

- Key bat dau bang `$`.
- Key co dau `.`.
- `__proto__`, `prototype`, `constructor`.

Muc tieu: giam rui ro prototype pollution va NoSQL injection.

#### `createRateLimit`

Rate limiter in-memory theo bucket:

- Cau hinh per route bang `windowMs`, `max`, `keyPrefix`.
- Default key la user id hoac IP.
- `RATE_LIMIT_MAX_BUCKETS` gioi han so bucket.
- Tra headers:
  - `x-ratelimit-limit`
  - `x-ratelimit-remaining`
  - `x-ratelimit-reset`
  - `retry-after` khi bi limit.

#### `requireAuth`

Yeu cau `req.user` va `req.isAuthenticated()` hop le.

#### `adminOnly`

Admin hop le khi:

- `req.user.role === "admin"`
- Email nam trong `ADMIN_EMAILS`
- Neu admin da bat 2FA thi JWT session phai co `is2FAVerified`.

#### `requireFreshLogin`

Bao ve hanh dong nhay cam, hien dung cho setup/enable 2FA. Yeu cau `loginAt` trong JWT con moi hon gioi han, mac dinh 5 phut.

#### `requireNotBanned`

Chan user bi ban dung getlink.

#### `webhookIpGuard`

Bao ve VietQR webhook theo IP allowlist:

- `VIETQR_WEBHOOK_IPS`
- `VIETQR_WEBHOOK_REQUIRE_IP_ALLOWLIST`

Neu allowlist rong va require flag false, webhook van cho qua nhung controller van check secret.

#### `auditAdmin`

Ghi `AuditLog` cho route admin write. Body duoc sanitize de redacted field nhay cam nhu password, secret, token, cookie, value.

## 4. Backend routes va API

### 4.1 Auth routes `/api/auth`

| Method | Path | Middleware | Y nghia |
|---|---|---|---|
| GET | `/google` | auth rate limit | Bat dau Google OAuth, sinh state CSPRNG, luu `returnTo` va referral code tam vao cookie |
| GET | `/google/callback` | OAuth state, Passport | Verify/consume state, tao JWT cookies va redirect ve frontend |
| GET | `/csrf` | none | Cap CSRF token |
| POST | `/logout` | CSRF | Clear auth cookies |
| GET | `/user` | JWT optional | Lay user hien tai |
| POST | `/2fa/generate` | auth, fresh login, rate limit | Tao TOTP secret va QR |
| POST | `/2fa/enable` | auth, fresh login, rate limit | Verify TOTP va bat 2FA |
| POST | `/2fa/verify` | auth, rate limit | Verify TOTP trong login session admin |

Google OAuth callback:

- Tao user moi neu email chua ton tai.
- Role admin duoc gan neu email nam trong `ADMIN_EMAILS`.
- Tao referral code neu chua co.
- Neu user moi co `oauthReferralCode`, goi `awardReferralSignup`.

### 4.2 Getlink routes `/api`

| Method | Path | Middleware | Y nghia |
|---|---|---|---|
| POST | `/getlink/preview` | auth, not banned, rate limit user+IP | Lay metadata model: productId, title, image, creditCost |
| POST | `/getlink/inspect` | auth, admin | Debug/inspect trang 3D66 |
| POST | `/getlink` | auth, not banned, rate limit user+IP | Tao download link, tru credit |
| POST | `/getlink/redownload/:id` | auth, not banned, rate limit user+IP | Chon dinh dang va chuan bi link tai lai record cua chinh user |
| GET | `/getlink/download/:id` | download rate limit | Proxy stream file 3D66 |
| GET | `/getlink/preview-image/:id` | download rate limit | Proxy tai anh preview |
| GET | `/getlink/history` | auth | Lich su getlink cua user |

### 4.3 Topup routes `/api`

| Method | Path | Middleware | Y nghia |
|---|---|---|---|
| GET | `/credit` | auth | Lay credit hien tai |
| GET | `/topup/packages` | public | Lay goi nap active |
| POST | `/topup` | auth, rate limit user+IP | Tao don nap SePay; ho tro header `Idempotency-Key` |
| GET | `/topup/history` | auth | Lich su nap cua user |
| GET | `/topup/:id/status` | auth, rate limit | Poll trang thai topup |
| POST | `/topup/:id/cancel` | auth, rate limit | Huy don SePay pending |

### 4.4 Payment routes `/api/payments`

| Method | Path | Middleware | Y nghia |
|---|---|---|---|
| POST | `/vietqr/webhook` | IP guard, rate limit | Nhan webhook VietQR/transaction provider |
| POST | `/sepay/ipn` | rate limit | Nhan IPN SePay |

SePay IPN yeu cau:

- Content-Type JSON.
- Header `x-secret-key` bang `SEPAY_SECRET_KEY`.
- `notification_type === "ORDER_PAID"`.
- `transaction_status === "APPROVED"`.
- `order_invoice_number` trung `paymentCode` topup pending.
- Amount >= `topup.amount`.

VietQR webhook yeu cau:

- Content-Type JSON.
- Secret trong `Authorization: Bearer`, `x-webhook-secret` hoac `x-vietqr-secret`.
- Noi dung giao dich co ma dang `NAP...` hoac `3D66...`.
- Amount >= topup amount.

### 4.5 Voucher routes `/api`

| Method | Path | Middleware | Y nghia |
|---|---|---|---|
| POST | `/voucher/apply` | auth, rate limit | Kiem tra voucher truoc khi tao topup |

Endpoint nay khong leak `usageLimit`, `usedCount`, `_id`, `createdAt`.

### 4.6 Settings routes `/api`

| Method | Path | Middleware | Y nghia |
|---|---|---|---|
| GET | `/settings` | public/admin-aware | Guest chi nhan homepage allowlist va resolve mode; admin da 2FA nhan runtime settings sanitized |
| POST | `/settings` | auth, admin, 2FA, rate limit, audit | Cap nhat settings |

### 4.7 Guide routes `/api`

| Method | Path | Middleware | Y nghia |
|---|---|---|---|
| GET | `/guides` | public | Lay danh sach bai huong dan published theo ngon ngu |
| GET | `/guides/:slug` | public | Lay mot bai published |

### 4.8 Notification routes `/api`

| Method | Path | Middleware | Y nghia |
|---|---|---|---|
| GET | `/notifications` | auth | Lay thong bao active cho user |
| POST | `/notifications/:id/read` | auth | Danh dau da doc |

### 4.9 Referral routes `/api`

| Method | Path | Middleware | Y nghia |
|---|---|---|---|
| GET | `/referral/me` | auth | Link/referral summary cua user |
| GET | `/referral/history` | auth | Lich su thuong referral |

### 4.10 System route `/api`

| Method | Path | Middleware | Y nghia |
|---|---|---|---|
| GET | `/system/3d66-status` | public | Check cookie pool va trang thai san sang tai 3D66 |

### 4.11 Admin routes `/api/admin`

Tat ca admin routes dung `requireAuth` va `adminOnly`.

| Method | Path | Y nghia |
|---|---|---|
| GET | `/overview` | KPI tong quan, revenue chart, cookie/queue status |
| GET | `/users` | Danh sach user co search/sort/pagination |
| GET | `/users/:id/profile` | Ho so va KPI van hanh cua user |
| GET | `/users/:id/timeline` | Timeline hop nhat Credit, Pro, Getlink, Model, Referral, Voucher |
| GET | `/users/:id/quota` | Quota download va image search trong ngay |
| POST | `/users/:id/pro-adjust` | Chinh han/quota Pro thu cong |
| POST | `/users/:id/ban` | Ban user |
| POST | `/users/:id/unban` | Go ban user |
| GET | `/referrals` | Danh sach referral admin |
| GET | `/audit-logs` | Audit admin actions |
| GET | `/system-logs` | System logs |
| GET | `/getlinks` | Lich su getlink admin |
| GET | `/topups` | Lich su topup admin |
| GET | `/transactions` | Bang giao dich server-side, filter `credit`, `pro`, `all` |
| POST | `/topups/:id/approve` | Duyet Credit pending bang approval service dung chung |
| POST | `/topups/:id/cancel` | Huy Credit pending |
| POST | `/membership-orders/:id/approve` | Duyet Pro pending bang approval service dung chung |
| POST | `/membership-orders/:id/cancel` | Huy Pro pending |
| POST | `/add-credit` | Cong credit thu cong |
| POST | `/set-credit` | Set credit user |
| GET | `/cookies` | Danh sach cookie 3D66 da mask |
| GET | `/cookies/status` | Cookie pool status |
| POST | `/cookie` | Luu cookie 3D66 moi |
| POST | `/cookie/test` | Test cookie raw hoac moi nhat |
| POST | `/cookies/:id/test` | Test cookie da luu |
| DELETE | `/cookies/:id` | Xoa cookie |
| POST | `/voucher` | Tao voucher |
| GET | `/vouchers` | List voucher |
| PUT | `/vouchers/:id` | Update voucher |
| DELETE | `/vouchers/:id` | Xoa voucher chua dung; archive voucher da co giao dich |
| GET | `/notifications` | List notification admin |
| POST | `/notifications` | Tao notification |
| PUT | `/notifications/:id` | Update notification |
| DELETE | `/notifications/:id` | Delete notification |
| GET | `/topup-packages` | List goi nap |
| POST | `/topup-packages` | Tao goi nap |
| POST | `/topup-packages/reorder` | Doi thu tu goi nap |
| PUT | `/topup-packages/:id` | Update goi nap |
| DELETE | `/topup-packages/:id` | Delete goi nap |
| GET | `/articles` | List bai guide admin |
| POST | `/articles` | Tao bai guide |
| PUT | `/articles/:id` | Update bai guide |
| DELETE | `/articles/:id` | Delete bai guide |

## 5. Luong nghiep vu chinh

### 5.1 Dang nhap Google

1. Frontend tao URL `/api/auth/google?returnTo=...&ref=...`.
2. Backend validate `returnTo` va referral code, sinh OAuth state bang CSPRNG, luu cac gia tri tam trong httpOnly cookie.
3. Passport redirect sang Google kem state.
4. Google callback tra profile/state ve backend; backend so sanh timing-safe va consume cookie state truoc khi Passport xu ly profile.
5. Backend tim user theo email:
   - Chua co: tao user credit 0.
   - Da co: update role/name/avatar.
6. Role admin duoc gan theo `ADMIN_EMAILS`.
7. Tao referral code neu chua co.
8. User moi co referral cookie thi goi `awardReferralSignup`.
9. Backend tao `accessToken` va `refreshToken` httpOnly cookie.
10. Redirect ve frontend.

### 5.2 Admin 2FA

1. Admin vao `/admin`.
2. `adminOnly` kiem tra role/email.
3. Neu admin da bat 2FA nhung JWT chua verify, backend tra `403 code=2FA_REQUIRED`.
4. Frontend hien modal nhap OTP.
5. POST `/api/auth/2fa/verify` thanh cong thi backend generate token moi co `is2FAVerified=true`.

Bat 2FA:

1. Admin goi `/api/auth/2fa/generate`.
2. Middleware yeu cau auth va fresh login.
3. Backend tao TOTP secret, QR code, luu secret tam trong httpOnly cookie `temp2FASecret`.
4. Admin scan QR va nhap OTP.
5. POST `/api/auth/2fa/enable`.
6. Backend verify OTP, ma hoa `twoFactorSecret` bang AES-256-GCM, set `isTwoFactorEnabled=true`, log security event va rotate JWT verified.

### 5.3 Preview model 3D66

1. User nhap model ID hoac URL 3D66 tuy theo che do trong admin.
2. Frontend lay `/api/settings` de biet `threed66ModelResolveMode`, doi placeholder/validate input, nhung khong hien ten che do cho user.
3. Frontend POST `/api/getlink/preview`.
4. Backend validate input va extract product id.
   - `search`: chi nhan model ID, backend ghep marker tai khoan he thong neu can.
   - `footprint`: preview dung link goc user gui de lay metadata nhanh.
   - `direct`: dung truc tiep URL dau vao.
5. Neu `ProductCache` da co title/gia tin cay, tra cache.
6. Neu chua co, backend chon cookie 3D66 bang `with3D66Cookie`.
7. Request vao queue preview.
8. `fetch3D66Preview` lay metadata:
   - Neu `THREED66_MOCK !== "false"`: tra mock metadata.
   - Neu production/real mode: uu tien download pop API, fetch HTML, parse dynamic fields, parse metadata, fallback Playwright khi can.
9. Cache metadata vao `ProductCache`.
10. Tra productId, title, imageUrl, creditCost.

### 5.4 Tao getlink va tru credit

1. Frontend goi POST `/api/getlink` voi `modelId` va `includePreviewImage`.
   - Truong `modelId` co the la model ID hoac full URL da duoc UI validate theo che do runtime.
   - Gui `downloadFormat` neu user da chon dinh dang file.
2. Backend validate input.
3. Lay `productId`.
4. Tao lock theo `userId:productId` trong Set de chan request dong thoi cung user/cung model.
5. Tim lich su tai lai mien phi con hop le:
   - Neu co va khong can chon lai format, tra downloadUrl khong tru credit.
   - Neu model co nhieu dinh dang, co the tra `requiresFormatSelection=true` de frontend cho user chon format truoc khi confirm.
6. Lay/refresh preview metadata de biet credit can tru.
7. Check user credit.
8. Neu user chua gui `downloadFormat`, backend kiem tra popup dinh dang file 3D66:
   - Neu co nhieu format hop le, tra danh sach `formatOptions` gom label, fileFormat, version, renderer va size.
   - Chua tru credit o buoc nay.
   - User chon format va goi lai POST `/api/getlink` kem `downloadFormat`.
   - Neu model khong co popup/chi co 1 format, tiep tuc luong cu.
9. Resolve product cache:
   - Neu cache fresh co `fileUrl`, dung cache.
   - Neu chua co hoac het han, goi `fetchFrom3D66` de mua/lay file URL.
   - Voi che do `footprint`, truoc khi download backend mo link user gui bang Playwright, vao footprint cua tai khoan cookie, F5/reload, lay card model vua xem va click de lay URL co sign cua tai khoan he thong.
   - URL sign cua he thong duoc luu vao `resolvedSourceUrl`; `sourceUrl` van giu link/input goc de audit va match model.
   - Co per-product lock de tranh nhieu task refresh cung product.
10. Kiem tra lai redownload sau khi cache xong de tranh race.
11. Goi `chargeAndCreateGetlink`: tru credit va tao `Getlink` voi URL, metadata va `downloadFormat` trong cung Mongo transaction.
12. Neu Mongo standalone/memory khong ho tro transaction, fallback co compensation: insert history loi thi tra lai dung credit da tru.
13. Tao download token HMAC va public URL:
    - `/api/getlink/download/:id?t=...`
    - neu user chon anh preview: `/api/getlink/preview-image/:id?t=...`
14. Tra URL va credit moi cho frontend.

Neu user getlink lai cung model:

- Neu history cu con trong han va con luot tai lai, backend tra link mien phi `creditUsed=0`.
- Luot tai lai khong bi tru ngay luc POST `/api/getlink`; no chi tang khi user mo link download va server bat dau stream file.
- Neu het han tai lai hoac het luot tai lai, backend xu ly nhu getlink moi: check credit, mua/generate link, tru credit va tao history moi.

### 5.5 Download file

1. Browser/IDM mo `/api/getlink/download/:id?t=...`.
2. Backend validate id va lay history.
3. Cho phep neu:
   - User dang dang nhap la owner; hoac
   - Token HMAC hop le va chua het han.
4. Ap dung gioi han dong thoi:
   - `MAX_GLOBAL_DOWNLOADS`
   - `MAX_DOWNLOADS_PER_USER`
   - `MAX_DOWNLOADS_PER_IP`
5. Kiem tra cua so tai lai:
   - `GETLINK_REDOWNLOAD_DAYS`
   - `GETLINK_REDOWNLOAD_LIMIT`
6. Neu day la lan mo link dau tien cua history:
   - Set `initialDownloadAt`.
   - Khong tang `redownloadCount`.
7. Neu day la lan tai lai tiep theo:
   - Atomic `$inc redownloadCount + 1` neu con trong window va chua vuot limit.
   - Neu stream/upstream loi truoc khi thanh cong, rollback lai luot da reserve.
8. Ho tro range request:
   - Partial download gan nhau trong `PARTIAL_DOWNLOAD_SESSION_MS` khong tinh them luot moi.
9. Neu `fileUrl` het han hoac upstream tra 401/403/404/410/419:
   - Uu tien refresh bang `resolvedSourceUrl` neu co de dung lai link sign cua tai khoan he thong.
   - Neu sign/token/context het han, fallback ve `sourceUrl` goc de resolve footprint/search lai.
10. Request file tu 3D66 voi cookie hop le.
11. Kiem tra upstream co ve file stream, khong phai HTML/JSON.
12. Proxy headers va stream body ve client.
13. Neu loi truoc khi stream thanh cong, rollback `initialDownloadAt` hoac `redownloadCount` da reserve.

### 5.5.1 Chuan bi tai lai

1. Frontend o `/getlink` hoac `/history` goi POST `/api/getlink/redownload/:id` truoc khi mo link.
2. Backend check owner, ban state, window va limit tai lai.
3. Neu history/fileUrl cu con fresh va format khong doi, tra downloadUrl moi co HMAC token moi.
4. Neu link 3D66 het han, backend refresh bang sourceUrl nhu luong getlink cu.
5. Neu model co nhieu format va user chua chon, tra `requiresFormatSelection=true` de frontend hien popup.
6. Neu user chon format khac voi history cu, backend refresh fileUrl theo format moi va cap nhat history/cache.

Het han tai lai:

- Khi `createdAt + GETLINK_REDOWNLOAD_DAYS` da qua, download/redownload tra `canRedownload=false`.
- User phai getlink lai model; neu co credit thi he thong tru credit va tao history moi.
- History moi reset lai window va `redownloadCount=0`.

### 5.6 Nap credit SePay

1. Frontend load `/api/topup/packages`.
2. User chon goi va co the apply voucher.
3. Frontend POST `/api/topup` kem `Idempotency-Key`; double click bi UI loading guard va backend replay cung order.
4. Backend:
   - Expire cac SePay topup pending da qua han.
   - Validate body.
   - Lay package.
   - Check `maxTopupsPerUser`.
   - Check voucher neu co.
   - Tinh `originalAmount`, `discountAmount`, `amount`, `credit`.
   - Tao topup pending voi `gatewayProvider=sepay`, `expiresAt=30 phut`.
   - Tao `paymentCode` bang CSPRNG, retry neu collision.
   - Tao SePay checkout fields va `checkoutUrl`.
5. Frontend submit form an toi checkout URL cua SePay.
6. Sau redirect success/error/cancel, frontend poll `/api/topup/:id/status` hoac cancel pending.
   - Cancel/error SePay goi `/api/topup/:id/cancel`.
   - Topup pending cua SePay bi chuyen thang sang `rejected` voi `canceledAt` va `rejectionReason`, khong cho duyet thu cong nua.
7. SePay goi IPN `/api/payments/sepay/ipn`.
8. Backend verify secret, status, amount va claim unique `PaymentReceipt` de chan duplicate transaction.
9. Goi `approvePendingTopup`.
10. `approvePendingTopup` dung Mongo transaction neu co MongoDB replica set:
    - Chap nhan pending hoac rejected boi `expired`, `user_cancel`, `gateway_error` neu signed paid event den tre va van hop le.
    - Claim receipt unique theo gateway transaction/topup.
    - Check package limit.
    - Claim voucher usage neu co.
    - Update topup pending thanh approved.
    - Cong credit user.
    - Gui Telegram notification.

### 5.7 Voucher

Apply voucher:

1. User nhap code.
2. Frontend POST `/api/voucher/apply`.
3. Backend validate target chinh xac: `topup` hoac `membership`.
4. Check voucher ton tai, active, chua het han, chua het luot.
5. Check `targetKind` va applicable Credit packages bang mot service dung chung cho apply/checkout.
6. Check user da dung qua `perUserLimit` chua.
7. Tra safe voucher payload cho frontend.

Redeem voucher:

1. Voucher chua tang `usedCount` khi apply.
2. Khi topup duoc approve, `approvePendingTopup` goi `claimVoucherUsage`.
3. Backend tang `usedCount` atomic voi dieu kien chua het luot.
4. Topup Credit co `perUserLimit > 0` tao `VoucherRedemption` theo slot; Pro va voucher khong gioi han duoc dem truc tiep tu order approved.
5. Neu loi hoac vuot limit, rollback counter.

Timeline voucher:

- View `all` chi tra giao dich Credit/Pro goc, khong chen them event voucher de tranh hien hai dong cho mot checkout.
- View `voucher` chieu tu Topup/MembershipOrder approved co `voucherCode`, nen voucher Credit khong gioi han theo user van hien day du.
- Don pending/rejected co `amount=0` trong event de khong bi hieu la da cong credit/thu tien; gia tri du kien nam trong metadata.

### 5.8 Referral

1. User vao link `/?ref=CODE`.
2. Khi bam Google login, frontend gan `ref` vao URL OAuth.
3. Backend luu code vao `oauthReferralCode`.
4. Khi Google callback tao user moi, backend goi `awardReferralSignup`.
5. Service:
   - Doc `referralMode` tu settings.
   - Neu `off`, bo qua.
   - Tim referrer theo code.
   - Khong cho self-referral.
   - Tao `Referral` va cong credit referrer/referred user trong cung Mongo transaction.
   - Mongo standalone/memory dung fallback co compensation neu mot buoc ghi that bai.
   - Tao notification cho referrer va referred user neu co.

### 5.9 Notification

Admin tao notification:

- Target all user hoac danh sach email.
- Kieu dropdown hoac fullscreen.
- Co optional image/action URL/start/expires.

User frontend:

- Navbar poll `/api/notifications` moi 60 giay.
- Dropdown chi dem unread notification khong phai fullscreen.
- Fullscreen notification hien overlay va co the dong tam trong session/tab.
- Dong fullscreen khong mark read tren server; neu admin van de notification active thi F5/session moi co the hien lai.
- Dropdown notification mark read qua `/api/notifications/:id/read`.
- Mark read upsert `NotificationReceipt`; mang `Notification.readBy` legacy khong tang them.

## 6. Tich hop 3D66

### 6.1 Cookie pool

`3d66CookiePool.js` quan ly cookie:

- Cookie duoc lay tu Mongo, decrypt bang AES-GCM.
- Cookie hop le can co:
  - `PHPSESSID`
  - `login_token`
  - `login_sign`
- Cookie bi loai neu:
  - `isActive=false`
  - `status=disabled`
  - dang cooldown
  - thieu key bat buoc
- Thu tu uu tien:
  - failure count thap hon
  - last used cu hon
  - updated moi hon
- Moi request sang 3D66 duoc throttle bang `THREED66_REQUEST_INTERVAL_MS`.
- Neu loi co the switch cookie, service danh dau cookie warning/cooldown.
- Sau `THREED66_COOKIE_MAX_FAILURES`, cookie vao cooldown `THREED66_COOKIE_COOLDOWN_MS`.
- Khi tat ca cookie loi, gui Telegram alert voi cooldown rieng.

### 6.2 HTTP/API path

`3d66Service.js` xu ly:

- Validate URL chi cho phep `3d66.com` hoac subdomain.
- Validate download URL chi cho phep host 3D66 va HTTPS.
- Goi fetch rieng `fetch3D66(url, options, { stage })` cho request sang 3D66.
- Stage proxy:
  - `preview`: doc trang/metadata.
  - `api`: download/pop, download/handle, mua/generate link.
  - `file`: keo fileUrl that tu 3D66 de stream ve user.
- Fetch model page voi headers giong browser.
- Parse:
  - title
  - preview image
  - price/credit cost
  - dynamic fields: `llId`, `token`, `upTime`, `sign`, `actionId`, context fields
- Goi download pop endpoint de enrich metadata.
- Parse popup chon dinh dang file:
  - `fileFormat`
  - `formatVersion`
  - `rendererType`
  - label ten dinh dang
  - renderer label
  - size file nen
- Build payload cho download handle endpoint.
- Khi user chon format, gui format selection vao payload 3D66 de lay dung file.
- Extract file URL tu JSON response.
- Request file stream voi cookie va referer.

Mock mode:

- Neu `THREED66_MOCK !== "false"`, preview va fetch tra mock data, khong goi 3D66 that.
- `.env.example` hien dang dat `THREED66_MOCK=true`.

### 6.3 Model resolve modes

Backend co 3 che do resolve model, cau hinh bang `THREED66_MODEL_RESOLVE_MODE` hoac admin UI:

- `search`: user nhap model ID. Backend normalize ID theo `THREED66_ACCOUNT_ID`/`THREED66_ACCOUNT_MARKER`, goi search/checkKeyword bang cookie 3D66 de lay context sach.
- `footprint`: user nhap full URL. Preview lay nhanh tu link goc, nhung khi download backend dung Playwright:
  - mo link user gui mot lan bang cookie he thong;
  - vao `https://user.3d66.com/newUser/index/index/footprint`;
  - reload de cap nhat footprint;
  - tim card co cung model suffix, bo qua prefix/marker theo user;
  - click card de lay URL co `sign` cua tai khoan he thong.
- `direct`: dung URL user gui truc tiep. Chi nen dung de debug hoac khi chac chan link dau vao hop le voi cookie he thong.

Voi `footprint`, ket qua resolve duoc luu vao `resolvedSourceUrl`. Backend gan marker hash noi bo `resolved=footprint` va `logical=<productId>` trong DB de biet day la URL da resolve; marker nay duoc strip truoc khi goi 3D66 hoac gui referer, khong gui ra upstream.

Cache footprint trong memory:

- Key theo hash cookie + danh sach product id candidates.
- TTL ngan de tranh mo footprint lap lai trong cung dot thao tac.
- Neu restart PM2 thi memory cache mat, nhung `resolvedSourceUrl` da luu trong Mongo van con.

Model ID normalization:

- `parse3d66.js` co the tach marker user va ghep marker tai khoan he thong.
- `THREED66_ACCOUNT_ID=177536980` mac dinh tao marker `89635771`.
- Co the override bang `THREED66_ACCOUNT_MARKER`.

### 6.4 Proxy rieng cho 3D66

He thong co proxy layer rieng cho request toi 3D66, mac dinh tat de chua mua proxy van chay nhu cu.

- `fetch3D66()` chi gan proxy cho request 3D66 theo stage:
  - `preview`
  - `api`
  - `file`
  - `browser`
- Google OAuth, MongoDB, SePay, Telegram va user download vao `3dipl.org` khong di qua proxy nay.
- Proxy URL la secret, khong tra ra public settings.
- Admin UI chi hien da cau hinh/chua cau hinh, co the nhap URL moi hoac xoa URL.
- Neu proxy loi va `THREED66_PROXY_FAIL_CLOSED=false`, backend fallback ve route mac dinh va gui Telegram canh bao.
- Neu `THREED66_PROXY_FAIL_CLOSED=true`, request loi ro rang thay vi am tham doi route.

### 6.5 Playwright browser fallback

`3d66BrowserService.js` dung Playwright khi:

- `THREED66_BROWSER_ALWAYS=true`
- HTML/API path yeu cau fallback
- Trang co challenge/script-only shell
- Thieu dynamic fields can de download
- Download handle loi va `THREED66_DOWNLOAD_HANDLE_BROWSER_FALLBACK=true`
- `THREED66_MODEL_RESOLVE_MODE=footprint` can Playwright cho buoc resolve URL sign cua tai khoan he thong.

Co guard SSRF:

- Playwright chi navigate URL thuoc `3d66.com` hoac subdomain.
- URL noi bo co hash marker se duoc strip truoc khi navigate.

Browser lifecycle:

- Dung shared Chromium instance.
- Cau hinh:
  - `THREED66_BROWSER_HEADLESS`
  - `THREED66_BROWSER_CONCURRENCY`
  - `THREED66_BROWSER_QUEUE_MAX`
  - `THREED66_BROWSER_MAX_TASKS`
  - `THREED66_BROWSER_MAX_AGE_MS`
  - `THREED66_BROWSER_BLOCK_ASSETS`
  - `THREED66_BROWSER_WAIT_UNTIL`
  - `THREED66_BROWSER_POST_COMMIT_WAIT_MS`
  - `THREED66_BROWSER_WAIT_NETWORKIDLE`
- Tu recycle browser theo so task hoac tuoi browser.
- Co queue rieng cho task browser.

### 6.4 Proxy 3D66

He thong co proxy rieng chi ap dung cho request backend sang 3D66, khong anh huong user truy cap `3dipl.org`, MongoDB, Google OAuth, SePay hay Telegram.

Bien cau hinh:

- `THREED66_PROXY_ENABLED`
- `THREED66_PROXY_URL`
- `THREED66_PROXY_FOR_PREVIEW`
- `THREED66_PROXY_FOR_API`
- `THREED66_PROXY_FOR_DOWNLOAD`
- `THREED66_PROXY_FOR_BROWSER`
- `THREED66_PROXY_FAIL_CLOSED`

Hanh vi:

- Mac dinh proxy tat nen he thong chay nhu cu.
- Proxy URL duoc mask khi log/alert va duoc ma hoa khi luu trong `SiteSetting`.
- `/api/settings` public khong tra proxy URL that, chi tra `threed66ProxyUrlConfigured`.
- Neu proxy loi va `THREED66_PROXY_FAIL_CLOSED=false`, backend:
  - gui Telegram alert `3D66 proxy fallback`;
  - retry request bang route VPS mac dinh.
- Neu `THREED66_PROXY_FAIL_CLOSED=true`, proxy loi se tra loi ro `3D66 proxy connection failed`.
- Playwright fallback cung co proxy rieng; neu proxy browser loi va fail-closed tat, browser retry lai khong proxy.

## 7. Frontend

### 7.1 Entry va routing

Frontend la React/Vite app.

Entry:

- `frontend/index.html`
- `frontend/src/App.jsx`

Routing duoc lam thu cong bang `window.history.pushState` va `popstate`, khong dung React Router.

Mapping path:

- `/`: public landing/login page.
- `/getlink`: dashboard getlink cho user.
- `/topup`: nap credit.
- `/history`: lich su tong hop.
- `/invite`: referral.
- `/admin`: admin panel.
- `/guide`: public guide.
- `/privacy` hoac `/chinh-sach-bao-mat`: privacy page.
- `/terms` hoac `/dieu-khoan-su-dung`: terms page.

Neu path khong khop, default ve `getlink`.

### 7.2 API wrapper

`frontend/src/api.js`:

- `API_URL = VITE_API_URL || http://localhost:5000`.
- `api(path, options)`:
  - Luon gui `credentials: include`.
  - Mac dinh `Content-Type: application/json`.
  - Voi request ghi, tu lay CSRF token tu `/api/auth/csrf`.
  - Neu backend tra `403 Invalid CSRF token`, clear cache token va retry mot lan.
  - Throw `Error(data.message || "Request failed")` neu response khong OK.

Download file khong di qua `api()` ma mo URL truc tiep vi link co HMAC token rieng.

### 7.3 `App.jsx`

Quan ly state chinh:

- `user`
- `page`
- `path`
- `language`
- `theme`
- loading
- ban overlay

Luon goi `/api/auth/user` luc load de lay user.
Theme duoc luu trong localStorage key `3dipl-theme` va apply vao `document.documentElement.dataset.theme`.

Admin path:

- Hien Navbar admin.
- Neu chua dang nhap: Login admin mode.
- Neu admin da bat 2FA va session chua verify: hien modal OTP.
- Neu role admin: hien Admin page.
- Neu user thuong: hien admin required.

Public home:

- Hien landing/login.
- Hien banner group Facebook 3DIPL duoi navbar.

Authenticated user pages:

- `Home`
- `Topup`
- `History`
- `Invite`

Public pages:

- `Guide`
- `Privacy`
- `Terms`

Root render `MessengerFloatButton` o goc phai duoi, link toi `https://m.me/1079508495252841`.

### 7.4 Navbar

`Navbar.jsx`:

- Brand `3DiPL`.
- Tabs user:
  - getlink
  - topup
  - invite
  - history
  - guide
- Account menu:
  - credit
  - admin link neu role admin
  - language toggle `VI/EN`
  - theme toggle dark/light
  - logout
- Notification menu:
  - poll `/api/notifications` moi 60 giay
  - unread badge
  - fullscreen overlay
  - favicon badge qua `faviconProgress.js`
- Login button:
  - Tao Google OAuth URL kem `returnTo` va `ref` neu URL co query referral.

### 7.5 Landing/Login page

`Login.jsx` vua la landing page public, vua la admin login panel khi `adminMode=true`.

Public mode:

- Load `/api/settings` de lay text trang chu.
- Load `/api/topup/packages` de hien pricing.
- Load `/api/system/3d66-status`.
- Load `/api/guides?language=...`.
- Neu user da login, load `/api/referral/me`.
- Demo getlink input:
  - Lay `threed66ModelResolveMode` tu `/api/settings`.
  - `search`: nhan model ID.
  - `footprint`/`direct`: nhan full URL 3D66 co `sof`.
  - Khong hien ten che do cho user, chi doi placeholder/validation.
  - Neu user chua login, redirect OAuth.
  - Neu user da login, vao `/getlink?url=...`.
- Pricing cards link den `/topup` hoac OAuth.
- Guide preview tren homepage.
- CTA va footer.

Admin mode:

- Hien panel dang nhap Google vao `/admin`.

### 7.6 Home/Getlink

`Home.jsx`:

- Hien thong tin account va credit.
- Hien banner huong dan DNS.
- Mount `GetlinkBox`.
- Load lich su getlink va topup.
- Hien lich su tai gan day va topup gan day.
- Nut ho tro trong lich su tai tro ve group Facebook 3DIPL.
- Tai lai file goi POST `/api/getlink/redownload/:id` truoc khi mo link de refresh link/token va hien popup format neu can.
- Neu user bi ban, truyen `disabledReason` vao `GetlinkBox`.

`GetlinkBox.jsx`:

- Load `/api/system/3d66-status`.
- Load `/api/settings` de biet che do input.
- User paste/nhap model ID hoac link 3D66 theo che do runtime.
- Step 1: POST `/api/getlink/preview`.
- Hien model info va gia credit.
- Step 2: POST `/api/getlink`.
- Neu backend tra `requiresFormatSelection=true`, hien popup chon dinh dang file:
  - ten dinh dang, vi du 3Dmax/OBJ/FBX;
  - phien ban;
  - renderer;
  - dung luong nen.
- Sau khi user chon format, POST lai `/api/getlink` kem `downloadFormat`.
- Cap nhat credit user.
- Hien download link va copy button.
- Neu tick tai kem preview image, backend tra link `/api/getlink/preview-image/:id?t=...`; frontend co the trigger tai anh rieng.
- Preview image chi luu URL 3D66 trong DB, khong luu binary/base64 anh tren server.
- Co progress bar va dynamic favicon progress.

### 7.7 Topup

`Topup.jsx`:

- Load packages.
- User chon package.
- User apply voucher qua `/api/voucher/apply`.
- Tinh gia sau sale/voucher va credit sau bonus.
- POST `/api/topup` tao topup SePay.
- Luu pending topup id trong `sessionStorage`.
- Submit hidden form toi SePay checkout.
- Sau redirect `?payment=success/error/cancel`:
  - Poll `/api/topup/:id/status`.
  - Hoac cancel pending neu error/cancel; backend doi status thanh `rejected`.
- Neu dang o trang va co pending payment, poll status moi 5 giay.

### 7.8 History

`History.jsx` load song song:

- `/api/getlink/history`
- `/api/topup/history`
- `/api/referral/history`

Gop thanh mot timeline, filter:

- all
- download
- topup
- referral

Download history hien redownload link neu con hop le.

Khi user bam tai lai:

- Neu history co nhieu format, hien `RedownloadFormatModal` de user chon lai.
- Neu khong co nhieu format, goi prepare redownload va mo link moi.
- Hien so luot con lai dang `remaining/limit`.

### 7.9 Invite

`Invite.jsx`:

- Load `/api/referral/me`.
- Load `/api/referral/history`.
- Hien referral code, referral URL, so luot moi, credit da nhan.
- Copy/share referral URL bang Clipboard/Web Share API.
- Neu referral mode `off`, hien empty state.

### 7.10 Guide

`Guide.jsx`:

- Load `/api/guides?language=...`.
- Chon bai theo sidebar.
- Hien coverImage, summary, content.

`GuideContent.jsx` render content text voi syntax nhe:

- `# Heading`
- `## Subheading`
- `- list item`
- `![alt](https://image)`
- `@[youtube](https://youtu.be/...)` hoac youtube.com URL, embed qua youtube-nocookie.

### 7.11 Admin panel

`Admin.jsx` la man hinh lon gom nhieu section.

Data load ban dau:

- `/api/admin/overview`
- `/api/admin/topup-packages`
- `/api/admin/vouchers`
- `/api/admin/cookies`
- `/api/admin/cookies/status`
- `/api/admin/system-logs`
- `/api/admin/articles`
- `/api/admin/notifications`
- `/api/admin/referrals`
- `/api/settings`

Section chinh:

- Overview:
  - Revenue today/week/total.
  - Getlink today/week.
  - New users.
  - Cookie health.
  - Queue status.
  - Pending payments.
  - Product cache.
  - Revenue chart theo day/month/year.
  - Recent getlinks/topups/top packages.
- Data:
  - Users.
  - Getlink history.
  - Topup history.
  - Referrals.
  - Logs.
- Packages:
  - Create/update/delete/reorder packages.
- Vouchers:
  - Create/update/delete vouchers.
  - Applicable packages.
- Notifications:
  - Create/update/delete dropdown/fullscreen notification.
- Homepage text:
  - Edit hero, pricing, referral text, guide text, CTA, footer.
- Articles:
  - Uses `AdminArticles.jsx` CRUD guide articles.
- 3D66 settings:
  - Tach tab: Tac vu, Tai file, Proxy, Playwright, Cookie, Trang thai.
  - Runtime concurrency, paytype, request interval, Playwright mode, timeout, cookie cooldown, redownload limits.
  - Che do resolve model: `search`, `footprint`, `direct`.
  - Proxy Hong Kong/3D66: bat/tat proxy, proxy URL secret, stage preview/API/download/browser, fail-closed.
  - Cookie tab: save/test/delete 3D66 cookies.
  - Trang thai tab: queue va cookie pool health.
- Security:
  - 2FA setup/enable for admin.

Data tables co search/pagination:

- Users: search, sort, page.
- Getlinks: search, page.
- Topups: search, status, page.

Admin write actions duoc backend audit qua `auditAdmin`.

### 7.12 Static assets va SEO

`frontend/public`:

- `3dipl-d.jpg`
- `3dipl-icon.svg`
- favicons
- `robots.txt`
- `sitemap.xml`

`robots.txt`:

- Allow all.
- Disallow `/admin`.
- Disallow `/api/`.
- Sitemap tai `https://3dipl.org/sitemap.xml`.

`index.html` co meta SEO/OpenGraph/Twitter cho domain `https://3dipl.org/`.

## 8. Bao mat va chong abuse

### 8.1 Auth/session

- JWT nam trong httpOnly cookie.
- Access token ngan han, refresh token dai han.
- Fingerprint theo User-Agent va tuy chon IP.
- Admin access phu thuoc role va `ADMIN_EMAILS`, khong chi dua vao DB role.
- Admin 2FA bat buoc neu user da enable.
- 2FA setup yeu cau fresh login.
- Google OAuth dung nonce/state mot lan, cookie httpOnly/SameSite va timing-safe comparison.
- TOTP secret moi duoc encrypt at rest; response user/admin khong serialize secret.

### 8.2 CSRF

- Tat ca request ghi qua frontend can CSRF token.
- Token la HMAC cua httpOnly `csrfSecret`.
- Webhook payment duoc skip CSRF nhung co secret/IP guard rieng.

### 8.3 Input validation

- `requestGuard` chan key nguy hiem trong body/query.
- Controllers dung `rejectUnknownKeys` de khong chap nhan body thua field.
- `isSafeId` phu thuoc MongoDB hay memory DB.
- Voucher code regex: `^[A-Z0-9_-]{3,32}$`.
- Referral code regex: `^[A-Z0-9]{6,24}$`.
- URL 3D66 chi cho host 3d66.com/subdomain.
- Playwright fallback co SSRF guard rieng.
- Preview image va file download chi cho HTTPS tren 3d66.com/subdomain, validate lai tung redirect, gioi han redirect/timeout va concurrency.
- Notification/action/guide image URL duoc normalize.
- Guide content chi render syntax rieng, khong render HTML raw.

### 8.4 Credit safety

- Tru credit va tao Getlink trong cung transaction; fallback chi dung khi transaction khong duoc ho tro va co compensation.
- Add credit admin co max per action/max stored credit va ledger `Topup` trong cung transaction/compensated unit of work.
- Manual credit tao Topup type `manual` de co lich su.
- Getlink co lock per user/product de tranh double charge.
- Product cache co lock per product de tranh duplicate 3D66 purchase/fetch.

### 8.5 Payment safety

- Pending `paymentCode` co unique partial index.
- Payment code dung CSPRNG.
- SePay IPN verify `x-secret-key`.
- VietQR webhook verify secret va optional IP allowlist.
- Duplicate transaction enforce bang unique `PaymentReceipt.gatewayTransactionId` va `topupId`.
- Tao topup enforce unique partial `(userId, idempotencyKey)` khi client gui `Idempotency-Key`.
- Amount webhook phai >= topup amount.
- Voucher redeem chi claim khi topup approved.
- `approvePendingTopup` dung transaction MongoDB neu khong phai memory DB.
- Signed late payment co the reopen cac rejection reason cho phep; approved receipt van idempotent.

### 8.6 Download safety

- Download URL co token HMAC TTL mac dinh 15 phut.
- Owner dang nhap co the download khong can token.
- IDM/browser khong can cookie auth neu token hop le.
- Download chi trong redownload window.
- Gioi han download dong thoi global/user/IP.
- Backend history dung explicit allowlist, khong expose `fileUrl`, `sourceUrl` hoac `resolvedSourceUrl`.
- Proxy stream set `cache-control: no-store`.

### 8.7 Logging va alert

- Pino/audit logger redact recursive cookie/authorization/secret/token/proxy URL va field nhay cam.
- `SystemLog` loai bo `cookie`, `cookieValue`, `fileUrl`, `headers` khoi details.
- Telegram alert cho:
  - topup approved
  - server error 5xx
  - 3D66 cookies unavailable
  - 3D66 proxy fallback khi proxy loi va he thong tu chuyen ve route VPS mac dinh
- Telegram co dedupe window.

## 9. Cau hinh moi truong quan trong

### 9.1 Server

- `PORT`
- `NODE_ENV`
- `CLIENT_URL`
- `PUBLIC_BASE_URL`
- `TRUST_PROXY`
- `JSON_BODY_LIMIT`
- `LOG_LEVEL`

Production can:

- `CLIENT_URL` la HTTPS URL.
- `PUBLIC_BASE_URL` la HTTPS URL.
- Tat ca secret co do dai toi thieu 32 ky tu.

### 9.2 Database

- `MONGO_URI`
- `MONGO_SERVER_SELECTION_TIMEOUT_MS`
- `MONGO_MAX_POOL_SIZE`
- `MONGO_MIN_POOL_SIZE`
- `ALLOW_MEMORY_DB`

### 9.3 Auth

- `JWT_SECRET`
- `CSRF_HMAC_SECRET`
- `COOKIE_SIGNATURE_SECRET`
- `DOWNLOAD_TOKEN_SECRET`
- `COOKIE_ENCRYPTION_KEY`
- `ADMIN_EMAILS`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_FINGERPRINT_BIND_IP`
- `SESSION_FINGERPRINT_ENFORCE`
- 2FA rate limits:
  - `TWO_FA_TOTP_WINDOW`
  - `TWO_FA_VERIFY_RATE_WINDOW_MS`
  - `TWO_FA_VERIFY_RATE_LIMIT`
  - `TWO_FA_SETUP_RATE_WINDOW_MS`
  - `TWO_FA_SETUP_RATE_LIMIT`

### 9.4 3D66

- `THREED66_MOCK`
- `THREED66_DOWNLOAD_ENDPOINT`
- `THREED66_DOWNLOAD_POP_ENDPOINT` (duoc code doc neu co)
- `THREED66_ORIGIN`
- `THREED66_TIMEOUT_MS`
- `THREED66_REQUEST_INTERVAL_MS`
- `THREED66_ACCOUNT_SEARCH_ENABLED`
- `THREED66_MODEL_RESOLVE_MODE`
- `THREED66_MODEL_ID_BASE_URL`: optional override; de trong de dung host/path mac dinh theo prefix model.
- `THREED66_ACCOUNT_ID`
- `THREED66_ACCOUNT_MARKER`
- `THREED66_GETLINK_CONCURRENCY`
- `THREED66_PREVIEW_CONCURRENCY`
- `THREED66_REFRESH_CONCURRENCY`
- `THREED66_GETLINK_QUEUE_MAX`
- `THREED66_PREVIEW_QUEUE_MAX`
- `THREED66_REFRESH_QUEUE_MAX`
- `THREED66_PAYTYPE_VALUE`
- `THREED66_SITE_CONTEXTS`
- `THREED66_DOWNLOAD_SEND_ORIGIN`
- `THREED66_PROXY_ENABLED`
- `THREED66_PROXY_URL`
- `THREED66_PROXY_FOR_PREVIEW`
- `THREED66_PROXY_FOR_API`
- `THREED66_PROXY_FOR_DOWNLOAD`
- `THREED66_PROXY_FOR_BROWSER`
- `THREED66_PROXY_FAIL_CLOSED`
- `THREED66_COOKIE_MAX_FAILURES`
- `THREED66_COOKIE_COOLDOWN_MS`

Proxy rieng cho 3D66:

- `THREED66_PROXY_ENABLED`
- `THREED66_PROXY_URL`
- `THREED66_PROXY_FOR_PREVIEW`
- `THREED66_PROXY_FOR_API`
- `THREED66_PROXY_FOR_DOWNLOAD`
- `THREED66_PROXY_FOR_BROWSER`
- `THREED66_PROXY_FAIL_CLOSED`

Browser fallback:

- `THREED66_BROWSER_HEADLESS`
- `THREED66_BROWSER_CONCURRENCY`
- `THREED66_BROWSER_QUEUE_MAX`
- `THREED66_BROWSER_MAX_TASKS`
- `THREED66_BROWSER_MAX_AGE_MS`
- `THREED66_BROWSER_ALWAYS`
- `THREED66_BROWSER_BLOCK_ASSETS`
- `THREED66_BROWSER_WAIT_UNTIL`
- `THREED66_BROWSER_NAV_RETRIES`
- `THREED66_BROWSER_RETRY_DELAY_MS`
- `THREED66_BROWSER_POST_COMMIT_WAIT_MS`
- `THREED66_BROWSER_WAIT_NETWORKIDLE`
- `THREED66_DISABLE_BROWSER_PAGE_FALLBACK`
- `THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK`
- `THREED66_DOWNLOAD_HANDLE_BROWSER_FALLBACK`

### 9.5 Credit/pricing/download

- `VND_PER_CNY`
- `WEB_CREDIT_PER_CNY`
- `REFERRAL_REWARD_CREDIT`
- `GETLINK_REDOWNLOAD_DAYS`
- `GETLINK_REDOWNLOAD_LIMIT`
- `MAX_DOWNLOADS_PER_USER`
- `MAX_DOWNLOADS_PER_IP`
- `MAX_GLOBAL_DOWNLOADS`
- `MIN_TOPUP_AMOUNT`
- `MAX_MANUAL_CREDIT`
- `MAX_STORED_CREDIT`
- `MAX_VOUCHER_DISCOUNT_PERCENT`

### 9.6 Payment

VietQR:

- `VIETQR_BANK_ID`
- `VIETQR_ACCOUNT_NO`
- `VIETQR_ACCOUNT_NAME`
- `VIETQR_TEMPLATE`
- `VIETQR_IMAGE_HOST`
- `VIETQR_IMAGE_EXT`
- `VIETQR_WEBHOOK_SECRET`
- `VIETQR_WEBHOOK_IPS`
- `VIETQR_WEBHOOK_REQUIRE_IP_ALLOWLIST`

SePay:

- `SEPAY_ENABLED`
- `SEPAY_ENV`
- `SEPAY_MERCHANT_ID`
- `SEPAY_SECRET_KEY`
- `SEPAY_PAYMENT_METHOD`
- `SEPAY_SUCCESS_URL`
- `SEPAY_ERROR_URL`
- `SEPAY_CANCEL_URL`

### 9.7 Telegram

- `TELEGRAM_NOTIFICATIONS_ENABLED`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_COOKIE_ALERT_COOLDOWN_MS`
- `TELEGRAM_DEDUP_WINDOW_MS`

### 9.8 Marketplace Google Drive

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_OAUTH_REDIRECT_URI`
- `GOOGLE_DRIVE_ACCESS_TOKEN`
- `GOOGLE_DRIVE_BEARER_TOKEN`
- `MARKETPLACE_DRIVE_ROOT_FOLDER_ID`
- `MARKETPLACE_DRIVE_BACKUP_FOLDER_ID`
- `MARKETPLACE_DRIVE_WRITE_ENABLED`
- `MARKETPLACE_DRIVE_CHANGES_ENABLED`
- `MARKETPLACE_DRIVE_CHANGES_POLL_SECONDS`
- `MARKETPLACE_DRIVE_CHANGES_BATCH_SIZE`
- `MARKETPLACE_DRIVE_QUEUE_BATCH_SIZE`
- `MARKETPLACE_DRIVE_QUEUE_MAX_ATTEMPTS`
- `MARKETPLACE_DRIVE_QUEUE_RETRY_BASE_SECONDS`

Marketplace dung Google Drive lam canonical source cho metadata, archive, cover va
preview. MongoDB chi la catalog index va noi luu state van hanh. Admin metadata save
ghi Drive, verify read-back, sau do moi sync Mongo. Changes API poll theo folder;
automatic full root scanner cu khong con duoc dung.

Production nen dung refresh token co scope `https://www.googleapis.com/auth/drive`.
Access token tinh chi nen dung test ngan han. Hai feature flag write/changes mac dinh
false de rollout migration an toan. Contract day du:
`MARKETPLACE_DATA_CONTRACT.md`.

#### 9.8.1 Cau hinh Drive token tu gia han

`GOOGLE_DRIVE_ACCESS_TOKEN` chi song ngan han (thuong khoang mot gio). Cau hinh production
phai dung bo ba OAuth Client ID, Client Secret va Refresh Token. Backend se tu doi refresh
token lay access token moi, cache token trong RAM va retry mot lan neu Drive tra HTTP 401.

1. Bat Google Drive API trong Google Cloud project.
2. Trong Google Auth Platform, chuyen Publishing status tu `Testing` sang `In production`.
3. Tao OAuth Client loai `Web application` va them Authorized redirect URI chinh xac:
   `http://127.0.0.1:53682/oauth2/callback`.
4. Dien `GOOGLE_DRIVE_CLIENT_ID` va `GOOGLE_DRIVE_CLIENT_SECRET` vao `backend/.env`.
5. Chay lenh sau tu root repository:

```bash
npm run drive:auth --prefix backend
```

Trinh duyet se mo trang Google cap scope Drive. Sau khi dong y, script kiem tra Drive API,
ghi `GOOGLE_DRIVE_REFRESH_TOKEN` vao `backend/.env` va xoa access token tinh. Khong copy
refresh token vao source code, log hoac frontend. Khoi dong lai backend, sau do kiem tra:

```bash
npm run drive:check --prefix backend
```

Ket qua dung phai la `Drive auth mode: oauth_refresh`, `Automatic refresh: yes` va
`Drive API: ok`. Admin Marketplace cung hien `Xac thuc Drive: Tu gia han`.

Neu refresh token bi `invalid_grant`, kiem tra OAuth app con o `In production`, tai khoan
chua thu hoi quyen ung dung va khong tao refresh token lap lai qua nhieu lan. Sau do chay
lai `drive:auth` de cap mot token moi.

## 10. Van hanh local

Cai dependencies:

```bash
npm run install:all
```

Chay dev backend + frontend:

```bash
npm run dev
```

Chay backend:

```bash
npm start
```

Backend mac dinh:

```text
http://localhost:5000
```

Frontend Vite mac dinh:

```text
http://localhost:5173
```

Build frontend:

```bash
npm run build --prefix frontend
```

Production can dam bao:

- MongoDB dang chay va `MONGO_URI` dung.
- Google OAuth callback tro ve `/api/auth/google/callback`.
- `CLIENT_URL` va `PUBLIC_BASE_URL` la HTTPS.
- SePay dashboard cau hinh IPN URL: `https://<api-domain>/api/payments/sepay/ipn`.
- Neu dung Playwright fallback, can cai browser Chromium cho Playwright.
- Neu dung marketplace Google Drive, can cau hinh refresh token Drive thay vi chi dung access token tinh.

Test footprint resolve tren VPS, khong mua/tai file:

```bash
cd /var/www/3dipl/backend

MODEL_URL='DAN_LINK_MODEL_3D66_DAY' node --input-type=module <<'NODE'
import dotenv from "dotenv";
dotenv.config();

const mongoose = (await import("mongoose")).default;
const { connectDb } = await import("./src/config/db.js");
const { with3D66Cookie } = await import("./src/utils/3d66CookiePool.js");
const { resolve3D66ModelUrlFromFootprint } =
  await import("./src/utils/3d66BrowserService.js");

await connectDb();

try {
  const input = process.env.MODEL_URL;
  const requested = new URL(input).searchParams.get("sof");
  const result = await with3D66Cookie((cookie) =>
    resolve3D66ModelUrlFromFootprint(input, cookie, [requested]),
  );

  console.log({
    requested,
    resolved: result.productId,
    resolvedUrl: result.url,
    usedFootprint: result.usedFootprint,
  });
} finally {
  await mongoose.disconnect();
}
NODE
```

Ket qua hop le:

- `usedFootprint: true`.
- `resolvedUrl` co `sign` cua tai khoan cookie he thong.
- `requested` va `resolved` co cung duoi model, co the khac prefix/marker user.

## 11. Cac diem can luu y

### 11.1 Encoding text

Nhieu chuoi tieng Viet trong source hien thi dang mojibake khi doc qua terminal. App co the van hien dung neu file/browser encoding khop, nhung khi sua text can kiem tra lai encoding UTF-8 de tranh nhan doi loi.

### 11.2 Session legacy

`sessionIntegrity.js` ton tai nhung khong duoc mount trong `server.js`. He thong hien tai dung JWT cookie thay vi Express session.

### 11.3 VietQR code con ton tai nhung luong topup mac dinh la SePay

Code co `vietqr.js` va `/api/payments/vietqr/webhook`, nhung `createTopup` hien set `type = "sepay"` va tao SePay checkout. VietQR co ve la luong cu/du phong.

### 11.4 `dist/` la build output

`frontend/dist` co asset build san, nhung `.gitignore` ignore `dist/`. Khi phan tich source, nen uu tien `frontend/src` va `frontend/public`.

### 11.5 Rate limit va queue la in-memory

Rate limiter, 3D66 request throttle, product locks, user/product locks va download counters deu nam trong memory cua process Node. Neu scale nhieu instance, can dua cac lock/rate limit/counter quan trong sang Redis hoac mot shared store.

### 11.6 Download token phu thuoc `PUBLIC_BASE_URL`

Neu production khong set `PUBLIC_BASE_URL`, backend fallback tu `req.protocol + Host`. Code da ghi chu day chi nen dung dev vi co rui ro Host header injection.

## 12. Tom tat theo module file

### Backend config

- `src/config/db.js`: ket noi Mongo, memory fallback.
- `src/config/memoryStore.js`: adapter model in-memory.
- `src/config/secrets.js`: lay secret voi fallback dev.

### Backend controllers

- `authController.js`: Google OAuth, logout, current user, CSRF alias, TOTP 2FA.
- `getlinkController.js`: preview, inspect, create getlink, popup chon format, redownload prepare, download proxy, preview image download, history.
- `topupController.js`: packages, create SePay topup, history/status/cancel.
- `paymentController.js`: VietQR webhook va SePay IPN.
- `voucherController.js`: apply voucher.
- `referralController.js`: referral summary va history.
- `settingsController.js`: site settings, runtime 3D66 settings, proxy 3D66 va encrypted proxy URL.
- `systemController.js`: public 3D66 cookie/system status.
- `guideController.js`: public/admin guide articles.
- `notificationController.js`: user/admin notifications.
- `adminController.js`: dashboard, data tabs, user/credit, cookie, voucher, package, logs, topups/getlinks/referrals.
- `marketplaceController.js`: public marketplace list/detail, cover/preview proxy, image search quota va download session.
- `marketplaceImageSearchProvider.js`: adapter HTTP cho similarity engine ben ngoai; chuan hoa ranking theo `source.modelId`, timeout va loi provider.
- `marketplaceAdminController.js`: admin import/sync Google Drive folder, attach asset/file va marketplace stats.

### Backend utils

- `3d66Service.js`: HTTP/API integration voi 3D66, parse metadata/popup format, resolve mode, proxy routing, cache `resolvedSourceUrl` va download URL.
- `3d66BrowserService.js`: Playwright fallback, browser proxy va footprint resolver lay URL sign cua tai khoan he thong.
- `3d66CookiePool.js`: cookie selection, status, failure/cooldown.
- `3d66Queue.js`: concurrency queues.
- `asyncLimiter.js`: queue primitive.
- `creditService.js`: atomic add/deduct credit.
- `downloadToken.js`: HMAC token cho download.
- `parse3d66.js`: extract product id tu URL, normalize model ID theo account marker, tao URL search tu model ID.
- `pricingService.js`: credit conversion/normalization.
- `secretBox.js`: AES-256-GCM encrypt/decrypt cookie values va proxy URL secret.
- `validators.js`: id, voucher, number, string, HTML stripping.
- `sepay.js`: SePay SDK fields/checkout URL.
- `vietqr.js`: VietQR config va payment code.
- `topupApprovalService.js`: approve topup trong transaction, voucher redeem, add credit.
- `topupExpiryService.js`: expire pending SePay topups.
- `referralService.js`: referral code/reward/summary.
- `logger.js`: Pino logger, security/audit event.
- `systemLog.js`: persistent system log.
- `telegramNotifier.js`: Telegram notifications, cookie alert va proxy fallback alert.
- `storageProvider.js`: local/Google Drive storage stream, Google Drive token refresh/retry 401.
- `marketplaceDownloadService.js`: tao va verify download session marketplace.

### Frontend

- `api.js`: API wrapper va CSRF.
- `App.jsx`: routing/state chinh, theme, Facebook group banner va floating Messenger button.
- `Navbar.jsx`: tabs, auth links, notifications, language.
- `Login.jsx`: landing page va admin login.
- `Home.jsx`: user dashboard/getlink history, support link, redownload prepare va format modal.
- `GetlinkBox.jsx`: preview/getlink UX, popup chon format, optional preview image download.
- `Topup.jsx`: package selection, voucher, SePay checkout polling.
- `History.jsx`: unified history, redownload prepare va chon lai format khi tai lai.
- `Invite.jsx`: referral page.
- `Guide.jsx` va `GuideContent.jsx`: public guide rendering.
- `Admin.jsx`: admin dashboard, Data group, 3D66 settings tabs, proxy/cookie/runtime controls.
- `AdminMarketplace.jsx`: admin marketplace model/file/Drive import controls.
- `Models.jsx`: public marketplace model list/detail/download UX.
- `AdminArticles.jsx`: guide article CRUD.
- `faviconProgress.js`: favicon progress/badge.
- `styles.css`: toan bo visual style.

## 13. Cap nhat audit va van hanh 2026-07-10

Muc nay ghi cac thay doi cross-cutting sau dot audit `docs/NEW_MODEL_AUDIT.md`. Neu mot mo ta cu o tren mau thuan voi muc nay, hanh vi moi trong source va muc nay duoc uu tien.

### 13.1 Service va model moi

- `getlinkChargeService.js`: unit of work tru credit + tao history bang transaction, co compensation fallback cho dev/Mongo standalone.
- `manualCreditService.js`: unit of work cong credit admin + ledger Topup.
- `PaymentReceipt.js`: unique gateway transaction/topup receipt cho payment idempotency.
- `NotificationReceipt.js`: unique per-user read receipt, thay cho viec tiep tuc day vao `Notification.readBy`.
- `referralService.js`: referral va credit rewards dung transaction; notification la best-effort sau commit.
- `topupApprovalService.js`: transaction approve topup gom receipt, state transition, voucher va credit; ho tro signed late payment voi rejection reason cho phep.

### 13.2 API contract va privacy

- Guest `/api/settings` chi nhan cac field landing page can thiet va `threed66ModelResolveMode`; runtime concurrency/proxy/internal metadata chi danh cho admin da qua 2FA va van duoc sanitize.
- User history khong tra upstream/signed URL. Admin user response dung explicit allowlist va cookie preview chi tra marker `[stored]`.
- `POST /api/topup` nhan optional `Idempotency-Key`; key hop le bi replay se tra order cu voi `idempotentReplay=true`.
- `POST /api/getlink/redownload/:id` la route chon format/tai lai cho record thuoc user.
- `/health` la liveness; `/ready` la readiness co DB/drain state.

### 13.3 Security lifecycle

- OAuth state la nonce CSPRNG mot lan, verify timing-safe va clear cookie sau callback.
- TOTP encrypt at rest va dual-read legacy. Khong bulk migrate trong deployment.
- Preview image/file proxy validate HTTPS + host `3d66.com`/subdomain tai moi redirect, co redirect limit, timeout va queue slot.
- Proxy agent cache gioi han 5 entries; eviction va shutdown deu close agent/socket.
- Audit settings write co rate limit, admin/2FA guard va persistent audit event; sanitizer recursive khong log credential fragment/proxy URL.
- Rate limiter khong scan toan bo map tren moi request; cleanup theo chu ky va reset bucket het han.

### 13.4 Runtime, CI va container

- Runtime contract: Node `>=20.18 <21`; CI dung Node 20.20.1 va npm 10.8.2.
- `eslint.config.js` bao phu backend, test va frontend React/hooks.
- `.github/workflows/ci.yml` cai dat bang lockfile, chay lint, test, build va dependency audit tren pull request/main.
- Backend Docker image dung Node 20.20.1, Chromium Playwright, user `node`, port 5000 va healthcheck `/ready`.
- Frontend Docker build yeu cau `VITE_API_URL`, serve SPA bang nginx unprivileged port 8080 va co `/healthz`.
- Server xu ly SIGINT/SIGTERM, ngung nhan connection, dong browser/proxy/Mongo va force timeout 30 giay.

Lenh quality gate:

```bash
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix backend
npm ci --ignore-scripts --prefix frontend
npm run check
npm audit
npm audit --omit=dev --prefix backend
npm audit --prefix frontend
```

May audit 2026-07-10 khong co Docker CLI, vi vay image manifests phai duoc build/scan va smoke test tren CI/staging truoc production.

### 13.5 Yeu cau database va rollout

- Production phai dung MongoDB replica set de transaction payment/credit/referral co atomicity day du.
- Startup khoi tao index cho `Topup`, `PaymentReceipt` va `NotificationReceipt` truoc khi listen.
- Cac collection/index moi la additive. Khong drop trong rollback khan cap; khong downgrade topup approved hoac sua credit tu dong.
- `Notification.readBy` legacy van duoc doc de tuong thich; write moi dung `NotificationReceipt`.
- TOTP plaintext legacy duoc re-encrypt sau verify; ban rollback backend phai van co dual-read decrypt.
- Ke hoach rollout/rollback: `docs/UPGRADE_PLAN.md`.
- Checklist staging/production va diem human confirmation: `docs/DEPLOYMENT_CHECKLIST.md`.

### 13.6 Gioi han con lai

- Rate limit, product/user lock, download counter va mot so 3D66 queue van theo process; can shared Redis/store truoc khi scale ngang nhieu instance.
- Admin overview van can aggregation/index benchmark tren dataset production-like.
- Chua co retention policy duoc phe duyet cho system/audit/gateway payload; khong tu dong them TTL/xoa data trong dot nay.
- Can staging integration test voi Mongo replica set, Google OAuth, SePay sandbox, 3D66 mock/real flow duoc phe duyet va SIGTERM tren Linux.
- Frontend con no bao tri/accessibility: tach Admin/styles, lazy load, focus trap/Escape, 404/SEO va E2E async states.
- Major upgrade Express/Mongoose/React/Vite duoc tach khoi dot patch bao mat nay.

## 14. Cap nhat merge marketplace va main 2026-07-11

- Da merge thay doi tu `main` vao nhanh marketplace, giu dong thoi OAuth state, payment receipt, graceful shutdown, marketplace, membership va Drive sync.
- Credit va Pro checkout deu co idempotency key. Payment receipt dung chung `gatewayTransactionId`, ngan mot giao dich ngan hang duyet ca Credit va Pro.
- Signed late payment hop le co the kich hoat lai don Pro bi `expired`, `user_cancel` hoac `gateway_error`; `admin_cancel` van la terminal.
- Kich hoat Pro, cap nhat order, voucher, quota add-on va payment receipt chay trong Mongo transaction. Memory DB co compensation cho test/local.
- Daily Pro add-on chi tang `bonusLimit` trong ngay neu user dang co Pro; khong ghi de `proUntil` cua goi dai han.
- Gói Credit mặc định được migrate theo `defaultRevision`; gói Pro chỉ đồng bộ giá/quyền lợi khi bật `SYNC_DEFAULT_MEMBERSHIP_PLANS=true`.
- Model public bat buoc `isPublished=true`, `metadataStatus=complete` va `fileStatus=ready`. Admin khong the publish model thieu archive.
- Quota download/image search rollback khi request vuot quota hoac tao session/log that bai. Image search khong tru quota khi similarity engine chua cau hinh hoac provider loi.
- Timeline va admin transaction dung total count that, khong con cap tong o 500 record; timeline khong tra source URL/source model ID.
- Voucher Pro duoc ghi nhan trong filter Voucher cua timeline.
- Drive sync co process lock, DB lock co stale timeout, batch startup sau 5 giay va dung timer khi graceful shutdown.
- Admin cu duoc bo sung filter user, KPI Pro/marketplace/model thieu file va tab Audit co search/phan trang.
- Voucher admin tach scope Credit/Pro/dung chung, co search/status, archive lifecycle va khoa doi code/scope sau khi co giao dich.
- Lich su credit admin cu da duoc bo; user detail va `/history` dung duy nhat timeline hop nhat, chia nhom Thanh toan/Tai xuong/Tai khoan.
- Bootstrap backend import auth/model sau `connectDb`, vi vay `ALLOW_MEMORY_DB=true` fallback local thuc su hoat dong khi Atlas khong truy cap duoc.

## 15. Cap nhat split Atlas/VPS/Drive va retention 2026-07-15

### 15.1 Ownership bat buoc

- Atlas Core giu tai khoan, tai chinh, quyen loi, Getlink, SiteSetting, GuideArticle va
  taxonomy `MarketplaceCategory`/`MarketplaceFilterOption`.
- MongoDB VPS giu catalog Model/Scene, quota, marketplace session/download history,
  Drive sync state, cache va log van hanh.
- Drive giu binary asset, metadata goc, backup va history archive da verify.
- `MarketplaceModel` khong tham chieu ObjectId category Atlas. Record chi luu
  `categorySourceId`, `parentCategorySourceId` va facet English key.
- `ModelPurchase` da bi loai bo. Marketplace chi co Free/Pro; Model tru 1 luot,
  Scene tru 5 luot.

### 15.2 Connection va deploy

- `src/config/db.js` mo hai connection sau khi doc env; model VPS bind qua
  `src/config/modelFactory.js`.
- Production `MARKETPLACE_DB_TARGET=vps` bat buoc co `MONGO_MARKETPLACE_URI` va
  backend tu choi neu hai connection tro cung database.
- VPS Mongo can replica set/sharded transaction support. Khong deploy bang Mongo
  standalone vi download count va daily quota grant can transaction exact-once.
- `/health` va `/ready` tra trang thai rieng cho core va marketplace database, khong tra URI.

### 15.3 Taxonomy

- Seed source chi tao key con thieu qua `$setOnInsert`; restart khong ghi de nhan admin.
- Admin Model/Scene co tab `Danh muc & bo loc`, chi sua nhan Viet/Anh, vi tri va active.
- Key/hierarchy/facet bi khoa; metadata key unknown/inactive bi tu choi truoc khi ghi Drive.
- Public category/filter API khong doi, backend hydrate nhan Atlas vao catalog VPS.

### 15.4 History va cumulative download count

- Retention job chay 02:30 Asia/Saigon, archive `.jsonl.gz` theo thang, verify SHA-256
  bang cach doc lai Drive va chi sau do moi xoa Mongo.
- Setting `0` giu vinh vien; admin cau hinh detail Getlink, history Getlink va history
  marketplace trong Cài dat.
- Manifest VPS cho phep resume deletion neu process dung sau upload/verify.
- Download session chi tang `MarketplaceModel.downloadCount` khi backend thuc su cap
  redirect Drive hoac mo stream lan dau; retry cung session khong tang lai.
- Public Model/Scene tra `downloadCount`; card hover va detail hien so luot tai.

### 15.5 Migration

Chay lan luot `data:split:dry-run`, `data:split:execute`, review/backup, sau do moi chay
`data:split:finalize` voi `MIGRATION_CONFIRM=split-marketplace-data`. Execute idempotent,
co checkpoint va khong xoa Atlas. Chi finalize moi xoa collection da chuyen sau khi count
duoc verify. Contract chi tiet nam trong `MARKETPLACE_DATA_CONTRACT.md` muc 15.
