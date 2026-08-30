# 3DiPL Plugin API

Tài liệu này là contract chính thức cho `3DiPL Asset Manager` và các client plugin
được 3DiPL cấp quyền. Contract hiện tại tương ứng release `0.3.1`, protocol bridge
`1`, và 3ds Max `2026`.

Nguồn chuẩn khi tài liệu và implementation có khác biệt:

1. `backend/src/routes/pluginRoutes.js` — Bearer API của plugin.
2. `backend/src/routes/pluginActivationRoutes.js` — activation/challenge trên web.
3. `backend/src/controllers/pluginAuthController.js` — auth, account và release feed.
4. `backend/src/utils/marketplaceDownloadService.js` — quota, Credit, session và idempotency.
5. `backend/test/plugin-*.test.js` — contract regression bắt buộc.

## 1. Phạm vi và base URL

| Môi trường | Base URL | Ghi chú |
|---|---|---|
| Production | `https://3dipl.org` | Client Production khóa cứng origin này. |
| Staging | `https://staging.3dipl.org` | Database, storage, secrets và release feed tách Production. |
| Development | `http://127.0.0.1:<PORT>` | Chỉ Desktop/DevHost Debug được dùng HTTP localhost. |

Desktop `0.3.1` chỉ hiển thị Models Online. Backend cũng đã có route Scene để giữ
contract tương lai; client hiện tại không được suy diễn Scene là Model.

Plugin API bị fail-closed. Nếu `PLUGIN_API_ENABLED` khác `true`, mọi route dưới
`/api/plugin` và `/api/plugin-activation` trả:

```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{
  "message": "Plugin API is not enabled",
  "code": "PLUGIN_API_DISABLED"
}
```

## 2. Quy ước HTTP

### Header chung

```http
Accept: application/json
User-Agent: 3DiPL-AssetManager/0.3.1 (3ds Max 2026; Windows)
X-Correlation-Id: <8-96 ký tự A-Z a-z 0-9 . _ : ->
```

Server luôn trả `X-Correlation-Id`. Nếu client không gửi hoặc gửi sai format,
server tự sinh UUID. Không log access token, refresh token, challenge token hoặc
signed download URL.

Route private dùng:

```http
Authorization: Bearer <accessToken>
```

Access token là JWT HS256, audience `3dipl-plugin`, issuer `3dipl.org`, sống 900
giây. Refresh token là opaque token, rotate ở mỗi lần refresh và có hạn tuyệt đối
30 ngày. Access token chỉ giữ trong memory; refresh token phải được bảo vệ bằng
DPAPI CurrentUser trên Windows.

### Error envelope

```json
{
  "message": "Thông báo an toàn cho client",
  "code": "MACHINE_READABLE_CODE",
  "details": {},
  "correlationId": "b7d7e7b6-..."
}
```

`details` chỉ có ở lỗi dưới 500 khi service cung cấp public details. Với `429`,
client phải ưu tiên header `Retry-After` (giây), sau đó mới đọc
`details.retryAfter`.

Các lỗi auth nền tảng:

| HTTP | Code | Hành vi client |
|---:|---|---|
| 401 | `BEARER_TOKEN_REQUIRED` | Gửi Bearer token. |
| 401 | `INVALID_ACCESS_TOKEN` | Thử refresh một lần. |
| 401 | `SESSION_REVOKED` | Xóa toàn bộ session local và đăng nhập lại. |
| 401 | `INVALID_REFRESH_TOKEN` | Xóa toàn bộ session local. |
| 401 | `REFRESH_REPLAY` | Session thiết bị đã bị revoke; không retry token cũ. |
| 403 | `ACCOUNT_BANNED` | Dừng download; vẫn cho dùng cache local. |
| 429 | `RATE_LIMITED` | Chờ `Retry-After`. |
| 503 | `PLUGIN_API_DISABLED` | Chuyển Online sang offline snapshot. |

## 3. Catalog công khai

Catalog không dùng Bearer token và nằm dưới marketplace API hiện hữu.

### Danh sách Models

```http
GET /api/marketplace/models?page=1&limit=24&sort=newest
```

Query được Desktop sử dụng:

| Query | Giá trị |
|---|---|
| `page` | Số trang, bắt đầu từ `1`. |
| `limit` | `1..60`; Desktop mặc định `24`. |
| `q` | Từ khóa. |
| `category` | Taxonomy key. |
| `render` | Renderer key. |
| `style` | Style key. |
| `accessType` | `free` hoặc `pro`. |
| `sort` | `relevance`, `newest`, `popular`, `oldest`, `title_asc`, `title_desc`. |

Response tối thiểu client phải chấp nhận:

```json
{
  "models": [
    {
      "_id": "<asset-id>",
      "assetType": "model",
      "title": "Chair",
      "description": "...",
      "accessType": "free",
      "fileSize": 104857600,
      "assetRevision": "<revision>",
      "sha256": "<64 hex>",
      "renderers": ["corona"],
      "styles": ["modern"],
      "parentCategorySourceId": "furniture",
      "categorySourceId": "chairs",
      "coverImage": { "url": "/...", "width": 800, "height": 800 },
      "previewImages": [{ "url": "/...", "width": 1200, "height": 900 }],
      "updatedAt": "2026-08-30T00:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 24, "total": 1 }
}
```

Backend có thể dùng key `assets` thay cho `models`; client `0.3.1` hiểu cả hai.

### Chi tiết Model

```http
GET /api/marketplace/models/:slug-or-id
```

Response có thể bọc asset trong `asset`, `model` hoặc `scene`. Client không được
dựa vào URL ảnh đã ký để định danh asset.

### Taxonomy

```http
GET /api/marketplace/taxonomy/export?assetType=model
```

Response chứa `taxonomyVersion`, `assets.model.categories` và
`assets.model.filters`. Category có `key`, `parentKey`, `labelVi`, `labelEn`,
`position`. Filter có `value`, `labelVi`, `labelEn`, `position` theo từng facet.

Catalog, detail, taxonomy và release feed hỗ trợ `ETag`/`If-None-Match`. Client lưu
snapshot JSON + ETag và được phép đọc snapshot khi offline.

## 4. Device authentication

### 4.1 Bắt đầu đăng nhập

```http
POST /api/plugin/auth/device/start
Content-Type: application/json

{
  "deviceName": "WORKSTATION-01",
  "pluginVersion": "0.3.1",
  "maxVersion": "2026"
}
```

Response `201`:

```json
{
  "deviceCode": "<opaque>",
  "userCode": "ABCD-EFGH",
  "verificationUri": "https://3dipl.org/plugin/activate",
  "verificationUriComplete": "https://3dipl.org/plugin/activate?code=ABCD-EFGH",
  "expiresIn": 600,
  "interval": 5
}
```

Client mở `verificationUriComplete` bằng browser mặc định và poll không nhanh hơn
`interval`.

### 4.2 Poll token

```http
POST /api/plugin/auth/device/token
Content-Type: application/json

{ "deviceCode": "<opaque>" }
```

Trong lúc chờ, server trả lỗi `AUTHORIZATION_PENDING`. Poll quá nhanh trả
`SLOW_DOWN` cùng `Retry-After`. Các trạng thái kết thúc là `ACCESS_DENIED` hoặc
`EXPIRED_TOKEN`.

Response thành công:

```json
{
  "accessToken": "<jwt>",
  "expiresIn": 900,
  "refreshToken": "<opaque>",
  "refreshExpiresAt": "2026-09-29T00:00:00.000Z",
  "sessionId": "<session-id>",
  "user": {
    "id": "<user-id>",
    "name": "User",
    "avatar": "",
    "isPro": false,
    "proUntil": null,
    "credit": 0,
    "downloadQuota": {
      "used": 0,
      "limit": 5,
      "remaining": 5,
      "resetAt": "2026-08-31T00:00:00+07:00"
    }
  }
}
```

### 4.3 Refresh

```http
POST /api/plugin/auth/refresh
Content-Type: application/json

{ "refreshToken": "<current-refresh-token>" }
```

Response có cùng shape với token thành công và luôn trả refresh token mới. Sau khi
persist token mới thành công, client phải loại token cũ. Replay token cũ revoke toàn
bộ device session.

### 4.4 Account và logout

```http
GET    /api/plugin/me
DELETE /api/plugin/auth/session
Authorization: Bearer <accessToken>
```

`GET /me` trả object user như `user` trong token response. Logout thành công trả
`204 No Content`.

## 5. Activation và quản lý thiết bị trên web

Các route này dùng cookie login của website, không dùng plugin Bearer token. POST
và DELETE phải đi qua CSRF middleware của web.

```http
GET    /api/plugin-activation/device/:userCode
POST   /api/plugin-activation/device/:userCode/approve
POST   /api/plugin-activation/device/:userCode/deny
GET    /api/plugin-activation/sessions
DELETE /api/plugin-activation/sessions/:sessionId
GET    /api/plugin-activation/challenge/:code
POST   /api/plugin-activation/challenge/:code/approve
```

Trang frontend tương ứng:

- `/plugin/activate?code=ABCD-EFGH`
- `/plugin/sessions`
- `/plugin/challenge?code=<challenge-code>`

## 6. Download contract

### 6.1 Xem phương thức tải

```http
GET /api/plugin/models/:id/download-options
Authorization: Bearer <accessToken>
```

Response:

```json
{
  "assetType": "model",
  "accessType": "free",
  "quotaCost": 1,
  "creditPrice": 0,
  "creditBalance": 0,
  "entitlementUntil": null,
  "defaultMethod": "free_quota",
  "quota": { "used": 0, "limit": 5, "remaining": 5, "resetAt": "..." },
  "options": [
    {
      "method": "free_quota",
      "available": true,
      "cost": 1,
      "remaining": 5,
      "reason": ""
    },
    {
      "method": "credit",
      "available": true,
      "cost": 0,
      "configuredCost": 0,
      "balance": 0,
      "reason": ""
    }
  ]
}
```

Model tốn `1` quota unit; Scene contract hiện tại tốn `5`. Free account không được
dùng quota cho asset Pro. Những lý do chính: `PRO_REQUIRED`,
`DOWNLOAD_QUOTA_EXCEEDED`, `INSUFFICIENT_CREDIT`.

### 6.2 Tạo download session

```http
POST /api/plugin/models/:id/download-session
Authorization: Bearer <accessToken>
Idempotency-Key: 01HZY2R6N8Q6_MODEL_123
Content-Type: application/json

{ "paymentMethod": "free_quota" }
```

`Idempotency-Key` bắt buộc, dài `8..128`, chỉ gồm `[A-Za-z0-9._:-]`. Một operation
phải giữ nguyên key khi retry. Dùng cùng key cho asset khác trả
`IDEMPOTENCY_KEY_REUSED`; operation đã hết hạn trả
`IDEMPOTENCY_OPERATION_EXPIRED`.

Response:

```json
{
  "session": {
    "_id": "<download-session-id>",
    "expiresAt": "...",
    "fileName": "chair.zip",
    "fileSize": 104857600,
    "sha256": "<64 hex>",
    "assetRevision": "<revision>",
    "mainMaxFile": "chair/chair.max",
    "archiveFormat": "zip"
  },
  "downloadUrl": "/api/plugin/download/session/<id>/file?t=<token>",
  "remaining": 4,
  "quotaCost": 1,
  "resetAt": "...",
  "paymentMethod": "free_quota",
  "billingStatus": "not_applicable",
  "creditCost": 0,
  "creditEntitlementUntil": null
}
```

Client chỉ được merge `mainMaxFile` sau khi verify `fileSize`, SHA-256, safe extract
và xác nhận path vẫn nằm trong staging/content root.

### 6.3 Browser challenge

Risk session hoặc mode `always` có thể trả:

```http
HTTP/1.1 403 Forbidden

{
  "code": "CHALLENGE_REQUIRED",
  "message": "Approve this download in your browser.",
  "details": {
    "challengeToken": "<one-time-token>",
    "challengeUrl": "https://3dipl.org/plugin/challenge?code=<code>",
    "expiresIn": 600
  },
  "correlationId": "..."
}
```

Client mở `challengeUrl`. Sau khi user approve, retry đúng asset, session và
`Idempotency-Key`, đồng thời gửi token một lần:

```json
{
  "paymentMethod": "free_quota",
  "challengeToken": "<one-time-token>"
}
```

Hoặc gửi `X-3DiPL-Challenge-Token`. Token gắn với user/session/asset/operation và
chuyển sang `consumed` khi dùng. Retry cùng operation sau khi consumed không yêu
cầu challenge lại; replay token trả `CHALLENGE_INVALID`.

### 6.4 Tải file và resume

```http
GET /api/plugin/download/session/:id/file?t=<download-token>
Authorization: Bearer <accessToken>
Range: bytes=<offset>-
```

Server có thể:

- trả `206`, `Accept-Ranges: bytes`, `Content-Range` và `Content-Length`;
- trả `200` nếu storage không hỗ trợ range — client phải tải lại `.partial` từ đầu;
- trả `302` đến signed HTTPS URL — client không được log URL/query token.

Billing/quota được idempotent theo download session. Retry cùng operation không
được trừ quota lần hai.

## 7. Release và Desktop update

```http
GET /api/plugin/release
If-None-Match: "sha256:..."
```

Manifest V2:

```json
{
  "manifestVersion": 2,
  "channel": "production",
  "version": "0.3.1",
  "minimumVersion": "0.2.1",
  "maxVersions": ["2026"],
  "downloadUrl": "https://3dipl.org/.../3dipl-0.3.1.mzp",
  "sha256": "<64 hex>",
  "signature": "<ES256 P1363 base64>",
  "signatureAlgorithm": "ES256",
  "publishedAt": "2026-08-30T00:00:00.000Z",
  "desktopArtifact": {
    "component": "desktop",
    "channel": "production",
    "version": "0.3.1",
    "downloadUrl": "https://3dipl.org/.../desktop-0.3.1.zip",
    "sha256": "<64 hex>",
    "protocolMinimum": 1,
    "protocolMaximum": 1,
    "requiresMaxRestart": false,
    "signature": "<ES256 P1363 base64>",
    "signatureAlgorithm": "ES256",
    "publishedAt": "..."
  },
  "maxBridge2026Artifact": {
    "component": "maxBridge2026",
    "requiresMaxRestart": true
  }
}
```

Client chỉ nhận update khi channel, semantic version, Max version, protocol range,
HTTPS URL, SHA-256, component signature và manifest signature đều hợp lệ. Desktop
artifact còn phải có Authenticode hợp lệ trước khi đổi `current.json`. Update
Desktop tương thích không restart Max; update bridge yêu cầu cài MZP và restart Max.

## 8. Rate limits

| Nhóm | Giới hạn mặc định |
|---|---:|
| Device start theo IP | 10/phút |
| Device token poll theo IP + device code | 30/phút |
| Refresh theo IP + refresh prefix | 20/phút |
| Private `/me`, logout, options | 120/phút/user/session/IP |
| Download session/file | 30/phút/user/session/IP |
| Web activation | 30/phút/user/IP |

Không loop retry ngay khi gặp `429`, `SLOW_DOWN` hoặc lỗi có `Retry-After`.

## 9. Biến môi trường bắt buộc

| Biến | Production |
|---|---|
| `PLUGIN_API_ENABLED` | `true` chỉ sau khi Staging E2E pass. |
| `PLUGIN_JWT_SECRET` | Secret riêng, tối thiểu 32 ký tự; không dùng `JWT_SECRET` web. |
| `PLUGIN_DOWNLOAD_CHALLENGE_MODE` | `risk`. |
| `PLUGIN_RELEASE_CHANNEL` | `production` hoặc `staging`. |
| `PLUGIN_RELEASE_VERSION` | Ví dụ `0.3.1`. |
| `PLUGIN_MINIMUM_VERSION` | Phiên bản cảnh báo tối thiểu. |
| `PLUGIN_RELEASE_MANIFEST_VERSION` | `2`. |
| `PLUGIN_RELEASE_URL` / `SHA256` / `SIGNATURE` | MZP legacy/combined đã ký. |
| `PLUGIN_RELEASE_PUBLIC_KEY` | ES256 SPKI public key base64 được pin ở client. |
| `PLUGIN_RELEASE_PUBLISHED_AT` | ISO-8601 UTC. |
| `PLUGIN_DESKTOP_RELEASE_*` | URL, SHA, signature, time, protocol range của Desktop. |
| `PLUGIN_MAX_BRIDGE_RELEASE_*` | URL, SHA, signature, time, protocol range của bridge. |
| `PLUGIN_DEPLOYMENT_ENV` | `production` hoặc `staging`. |
| `PLUGIN_QA_RISK_SECRET` | Chỉ Staging; để trống/không tồn tại ở Production. |

Production phải chạy:

```powershell
$env:NODE_ENV = "production"
npm run env:check
npm run check
```

Không commit `.env`, JWT secret, refresh token, Turnstile secret, Authenticode
certificate hoặc ES256 private key.

## 10. Contract tests và acceptance

```powershell
npm run lint
npm test
npm run build:check
```

Các suite trực tiếp bảo vệ plugin contract:

- `backend/test/plugin-auth.test.js`
- `backend/test/plugin-download-challenge.test.js`
- `backend/test/plugin-download-idempotency.test.js`
- `backend/test/plugin-rate-limit-contract.test.js`
- `backend/test/plugin-release-etag.test.js`
- `backend/test/plugin-release-signature.test.js`
- `backend/test/production-readiness.test.js`

Thay đổi route, response field, error code, quota cost, signature canonicalization
hoặc idempotency semantics phải cập nhật test và tài liệu này trong cùng PR.
