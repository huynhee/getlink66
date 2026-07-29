# Environment Variables

Không đưa secret thật vào Git. Dùng `backend/.env.production.example` và secret
manager của VPS/CI làm nguồn cấu hình.

## Bắt buộc Production

| Nhóm | Biến chính |
|---|---|
| URL/proxy | `NODE_ENV`, `CLIENT_URL`, `PUBLIC_BASE_URL`, `CORS_ORIGINS`, `TRUST_PROXY` |
| Database | `MONGO_CORE_URI`, `MONGO_MARKETPLACE_URI`, `MARKETPLACE_DB_TARGET=vps`, `MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED=true` |
| Crypto | `JWT_SECRET`, `CSRF_HMAC_SECRET`, `COOKIE_SIGNATURE_SECRET`, `DOWNLOAD_TOKEN_SECRET`, `COOKIE_ENCRYPTION_KEY` |
| Admin | `ADMIN_EMAILS`, `ADMIN_2FA_REQUIRED=true` |
| OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, HTTPS `GOOGLE_CALLBACK_URL` |
| Drive | client ID/secret/refresh token và 5 folder ID |
| Turnstile | enabled, site/secret key, expected hostname/action |
| Payment | `SEPAY_ENABLED`, `SEPAY_ENV`, merchant/secret/callback URLs |
| Delivery | `MARKETPLACE_DOWNLOAD_DELIVERY=proxy`, public links false |
| Image search | HTTPS URL, API key, required flag |

## Phải Tắt

`ALLOW_MEMORY_DB`, `ALLOW_DEV_LOGIN`, `ALLOW_DEV_ADMIN_LOGIN`, `THREED66_MOCK`,
`MARKETPLACE_STARTUP_MIGRATIONS_ENABLED`.

## Plugin khi bật

Điền API enabled, JWT/refresh secrets riêng, activation URL, challenge mode
`always`, release HTTPS URL, version/min version, SHA-256, detached signature và
published time. Plugin client phải pin public verification key.

## Frontend

`VITE_API_URL` để rỗng cho same-origin. `VITE_3DSMAX_PLUGIN_DOWNLOAD_URL` là URL
HTTPS của installer đã ký. Biến `VITE_*` là public, tuyệt đối không chứa secret.

## Kiểm tra

```powershell
$env:NODE_ENV='production'
npm.cmd run env:check
```

Chỉ deploy khi lệnh trả exit code 0.
