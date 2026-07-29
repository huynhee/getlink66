# Regression Results

| Gate | Lệnh/Bài test | Kết quả |
|---|---|---|
| Lint | `npm run lint` | Pass |
| Backend | `npm test` | 139/139 pass |
| Release build | alternate clean outDir + verifier | Pass |
| Artifact scan | `npm run verify:frontend-build` | Pass, 9 files |
| Browser smoke | `node backend/scripts/qa-smoke.js` | Pass |
| Responsive | 6 routes x desktop/mobile + admin | Pass |
| Security HTTP | CORS/CSRF/headers/NoSQL | Pass |
| Load | 300 requests, c=20 | p95 21.44 ms |
| Memory | before/after GC | +634,216 B heap |
| Migration | asset `--memory` dry-run | Pass |
| Migration guard | execute thiếu confirm | Rejected đúng |
| Drive | `npm run drive:check` | API ok |
| Dependency | `npm audit --offline` | 0 known |
| Production env | `NODE_ENV=production npm run env:check` | Fail đúng, 11 blockers |

Lệnh build mặc định vào `frontend/dist` bị Windows trả `EPERM` vì file sinh
`3dipl-d.jpg` đang được process ngoài giữ handle. Quyền file hợp lệ và không tìm
thấy dev server của repo. Build cùng source vào outDir sạch `release-dist-v5`
pass; đây là blocker môi trường local, cần xác nhận lại trên Linux CI.

## Browser Evidence

- `screenshots/desktop-models.png`
- `screenshots/mobile-models.png`
- `screenshots/desktop-admin.png`
- `screenshots/mobile-admin.png`

## Blocked

Firefox/WebKit, Docker image build, HTTPS staging OAuth, Turnstile thật, SePay
sandbox, getlink upstream thật, Drive file download và backup restore chưa chạy.
