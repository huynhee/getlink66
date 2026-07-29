# Changed Files

## Security và Runtime

- `backend/server.js`
- `backend/src/config/httpSecurity.js`
- `backend/src/config/productionReadiness.js`
- `backend/src/config/secrets.js`
- `backend/src/middleware/{jwtAuth,adminOnly,requireNotBanned,auditLog}.js`
- `backend/src/controllers/{authController,marketplaceController}.js`
- `backend/src/utils/{getlinkJobService,marketplaceDownloadService}.js`
- `backend/src/models/{User,DownloadSession,MarketplaceModel}.js`

## Plugin

- `backend/src/controllers/pluginAuthController.js`
- `backend/src/middleware/{pluginBearerAuth,pluginDownloadChallenge}.js`
- `backend/src/models/Plugin*.js`
- `backend/src/routes/{pluginRoutes,pluginActivationRoutes}.js`
- `backend/src/services/pluginAuthService.js`
- `frontend/src/pages/PluginAccess.jsx`

## Build, Config và CI

- `.github/workflows/ci.yml`
- `backend/.env.example`, `backend/.env.production.example`
- `frontend/.env.production.example`, `frontend/src/api.js`, `frontend/index.html`
- `frontend/Dockerfile`
- `package.json`, `backend/package.json`, `eslint.config.js`
- `scripts/verify-frontend-build.js`
- `backend/scripts/{env-check,qa-smoke,marketplace-asset-migration}.js`

## Test

Thêm test auth hardening, session revocation, request security, HTTP security,
production readiness, plugin auth/challenge/download và mở rộng marketplace/getlink.

## Documentation/Evidence

Toàn bộ `qa-report/00..25`, screenshots và performance JSON. Danh sách chính xác
trước commit phải lấy bằng `git diff --name-status` vì worktree còn thay đổi từ
nhánh `main` được tích hợp trong lúc audit.
