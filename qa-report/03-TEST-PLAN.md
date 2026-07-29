# Test Plan

## Gates

1. **Static:** lockfile, Node engine, lint, dependency tree, audit.
2. **Build:** Vite production build, bundle scan, source-map/secret/localhost.
3. **Backend:** auth, CSRF/CORS, admin, payment, getlink, quota, download,
   Turnstile, plugin và production config.
4. **Browser:** Chromium desktop/mobile cho public routes và admin.
5. **Runtime:** `/health`, `/ready`, security headers, graceful shutdown.
6. **Load/memory:** 300 catalog requests, concurrency 20, heap trước/sau GC.
7. **Data:** migration dry-run memory mode, confirmation guard.
8. **External:** Drive read-only; staging OAuth/Turnstile/SePay/download thủ công.

## Test Isolation

Smoke dùng Mongo memory fixture, port `5511/5512`, dev-login test và static build
riêng. Không gọi thanh toán thật, không ghi Drive và không kết nối database
production. Diagnostic memory chỉ bật khi non-production.

## Exit Criteria

- Không còn Critical/High code defect chưa xử lý.
- Lint/test/build/verifier pass.
- Production env gate pass bằng secret/config thật.
- Staging smoke đầy đủ OAuth, payment sandbox, Turnstile và download.
- Backup restore drill pass và monitoring/alerts hoạt động.

Hiện hai tiêu chí cuối chưa hoàn thành nên release là `NOT READY`.
