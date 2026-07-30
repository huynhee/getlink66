# Deployment checklist - Get Link 3D66

Cap nhat: 2026-07-10

Checklist nay danh cho staging truoc, sau do production. Moi o `HUMAN CONFIRMATION` can nguoi co tham quyen xac nhan; agent audit khong tu dong deploy, migrate, thay secret hoac phe duyet giao dich.

Cau hinh bien moi truong: `docs/ENV_CONFIGURATION.md`.

## A. Change record va pham vi

- [ ] Ghi commit SHA, branch/tag release, backend image digest va frontend image digest.
- [ ] Link audit: `docs/NEW_MODEL_AUDIT.md`.
- [ ] Link plan: `docs/UPGRADE_PLAN.md`.
- [ ] Xac nhan thay doi chi nam trong pham vi da review; khong kem secret hay artifact ngoai y muon.
- [ ] Xac nhan owner, change window, kenh lien lac va nguoi co quyen rollback.
- [ ] **HUMAN CONFIRMATION:** phe duyet staging.

## B. Backup va database preflight

- [ ] Tao backup/snapshot Mongo ngay truoc change window; ghi id/thoi gian/noi luu ma khong ghi credential.
- [ ] Restore thu backup vao moi truong tach biet va chay truy van sanity.
- [ ] Xac nhan `MONGO_CORE_URI` tro den Atlas Core va `MONGO_MARKETPLACE_URI` tro den MongoDB VPS rieng.
- [ ] Xac nhan MongoDB VPS la replica set/sharded cluster va ho tro transaction.
- [ ] Xac nhan hai URI khong tro cung database.
- [ ] Xac nhan primary/secondary healthy, replication lag, disk headroom va quyen tao index.
- [ ] Kiem tra khong co collection/index build dang treo.
- [ ] Review index additive se tao:
  - [ ] `PaymentReceipt.gatewayTransactionId` unique.
  - [ ] `PaymentReceipt.topupId` unique.
  - [ ] `NotificationReceipt(notificationId,userId)` unique.
  - [ ] `Topup(userId,idempotencyKey)` unique partial.
  - [ ] Cac index `Topup` query theo status/user/time/package/voucher.
- [ ] Khong drop collection/index legacy trong release nay.
- [ ] Khong bulk migrate/decrypt TOTP trong release nay.
- [ ] **HUMAN CONFIRMATION:** backup restore duoc va database preflight pass.

## C. Secrets va cau hinh

- [ ] `NODE_ENV=production`; Node 20.20.1/npm 10.8.2 hoac runtime tuong thich engines.
- [ ] Secret bat buoc duoc nap tu secret manager, khong bake vao image/log:
  - [ ] `JWT_SECRET`, `CSRF_HMAC_SECRET`, `COOKIE_SIGNATURE_SECRET`.
  - [ ] `DOWNLOAD_TOKEN_SECRET`, `COOKIE_ENCRYPTION_KEY`.
  - [ ] `GOOGLE_CLIENT_SECRET`, SePay secret va credential Telegram neu bat.
- [ ] Secret noi bo dat toi thieu 32 ky tu va khong dung fallback/dev value.
- [ ] `CLIENT_URL`, `PUBLIC_BASE_URL`, `CORS_ORIGINS` la HTTPS/domain dung.
- [ ] `TRUST_PROXY` khop voi so hop reverse proxy; khong bat rong hon ha tang thuc.
- [ ] `ALLOW_MEMORY_DB=false` va `THREED66_MOCK=false` tren production.
- [ ] `MARKETPLACE_DB_TARGET=vps` va `MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED=true`.
- [ ] Drive OAuth hien `Automatic refresh: yes`; khong phu thuoc access token tam.
- [ ] Root folder Model, Scene va history archive da co ID va tai khoan Drive co quyen Editor.
- [ ] Volume `/var/lib/3dipl/media/covers` duoc backend mount read-write, Nginx mount read-only va con it nhat 30 GB.
- [ ] `MARKETPLACE_COVER_CACHE_ENABLED=true`; worker cover bat va Nginx tra `/media/covers/*` voi immutable cache.
- [ ] `GOOGLE_CLIENT_ID`, callback `/api/auth/google/callback` va allowed origin khop staging/prod.
- [ ] SePay environment, merchant, success/error/cancel URL va IPN `/api/payments/sepay/ipn` khop moi truong.
- [ ] 3D66 cookie/proxy duoc nap tu secret store; khong dua gia tri vao ticket/checklist.
- [ ] Neu override `THREED66_MODEL_ID_BASE_URL`, review HTTPS va host `*.3d66.com`; de trong de dung mapping mac dinh theo model.
- [ ] **HUMAN CONFIRMATION:** security/config owner da review ten bien va nguon secret.

## D. Build va supply chain

- [ ] Chay cai dat sach:

```bash
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix backend
npm ci --ignore-scripts --prefix frontend
```

- [ ] Chay quality gate:

```bash
npm run check
npm audit
npm audit --omit=dev --prefix backend
npm audit --prefix frontend
```

- [ ] Tat ca test pass; lint khong error/warning; frontend production build pass.
- [ ] CI GitHub Actions pass tren commit can deploy.
- [ ] Build backend container tu `backend/Dockerfile` va quet CVE/image.
- [ ] Build frontend container voi `VITE_API_URL` production/staging ro rang:

```bash
docker build -t get-link-3d66-backend:<sha> backend
docker build --build-arg VITE_API_URL=https://api.example.com -t get-link-3d66-frontend:<sha> frontend
```

- [ ] Test container chay user khong phai root va healthcheck pass.
- [ ] Ghi image digest; khong deploy tag mutable nhu `latest` neu khong kem digest.
- [ ] **HUMAN CONFIRMATION:** artifact va scan da duoc phe duyet.

## E. Staging validation

- [ ] `/health` tra 200 va `/ready` tra 200 khi Mongo connected.
- [ ] `MARKETPLACE_DB_TARGET=vps`; Core/VPS khac database va VPS `rs.status().ok == 1`.
- [ ] `npm run backup:databases` va `npm run backup:verify` thanh cong truoc migration/deploy.
- [ ] Bat bon timer trong `ops/systemd`; web dat `HISTORY_RETENTION_JOB_ENABLED=false`.
- [ ] `npm run storage:status` khong co alert critical; backup Core/VPS duoi 26 gio.
- [ ] `npm run marketplace:covers:dry-run`, backfill va verify cover cache khong con file ready bi thieu/hong.
- [ ] Restore drill gan nhat dung database tach biet va hoan tat duoi 24 gio.
- [ ] Rut ket noi DB co kiem so: `/ready` tra 503; ket noi lai thi tra 200.
- [ ] Gui SIGTERM tren Linux/container: instance ngung ready/nhan request, dong HTTP/browser/proxy/Mongo trong 30 giay.
- [ ] Google login dung state thanh cong; callback thieu/sai/replay state bi tu choi.
- [ ] Admin 2FA setup/verify dung secret encrypted; admin legacy test neu co fixture duoc phe duyet.
- [ ] Guest `/api/settings` chi nhan landing allowlist; admin da 2FA nhan runtime settings can thiet.
- [ ] History/admin user/cookie preview khong lo URL noi bo, TOTP secret hay credential fragment.
- [ ] Preview/file redirect ngoai `*.3d66.com` bi tu choi; luong 3D66 hop le van chay.
- [ ] Getlink loi sau deduct duoc rollback/compensate; concurrent request khong lam credit am/mat history.
- [ ] Hai request topup cung `Idempotency-Key` tra cung mot order.
- [ ] SePay sandbox: signed IPN approve mot lan; duplicate IPN khong cong lai; late signed payment hop le approve theo policy.
- [ ] Referral/manual credit failure injection khong tao delta credit-ledger.
- [ ] Notification mark-read khong tang `Notification.readBy`; receipt unique/idempotent.
- [ ] Redownload, voucher, guide, admin CRUD va responsive smoke pass.
- [ ] **HUMAN CONFIRMATION:** product/payment/security owner ky staging evidence.

## F. Production rollout

- [ ] Dat maintenance/change window va tam dung thao tac admin nhay cam neu can.
- [ ] Deploy mot backend canary voi readiness probe `/ready` va termination grace > 30 giay.
- [ ] Kiem tra index initialization hoan thanh truoc khi mo traffic.
- [ ] Smoke canary khong dung giao dich that neu chua co phe duyet; dung account/test flow duoc quy dinh.
- [ ] Mo traffic canary theo tung buoc, quan sat it nhat mot cua so payment/polling.
- [ ] Mo rong backend con lai, sau do frontend.
- [ ] Khong rotate/xoa secret cu dong thoi voi deploy neu khong co ke hoach dual-key rieng.
- [ ] **HUMAN CONFIRMATION:** nguoi dieu hanh cho phep full rollout.

## G. Post-deploy monitoring va reconciliation

- [ ] Theo doi 2xx/4xx/5xx, latency, memory, CPU, Mongo pool/lag va restart loop.
- [ ] Theo doi queue/browser/proxy agent, timeout 3D66 va cookie cooldown.
- [ ] Theo doi OAuth state invalid spike, 2FA failure/rate-limit va CORS/CSRF reject.
- [ ] Theo doi topup pending/rejected/approved, payment receipt conflict va late approval.
- [ ] Doi soat tong gateway amount, approved topup, credit delta va manual/referral ledger.
- [ ] Kiem tra `PaymentReceipt` khong duplicate transaction/topup.
- [ ] Kiem tra `NotificationReceipt` growth/index va query latency.
- [ ] Xac nhan public settings/history/admin response khong co field nhay cam.
- [ ] Ghi lai anomaly, owner va deadline; khong dong change khi credit/payment chua doi soat.
- [ ] **HUMAN CONFIRMATION:** post-deploy reconciliation pass.

## H. Rollback trigger va thao tac

Rollback ngay khi co mot trong cac dau hieu:

- Credit bi cong/tru hoi, duplicate payment, receipt conflict khong giai thich.
- Login/admin 2FA bi khoa tren dien rong.
- Readiness khong on dinh, restart loop, DB/index lock anh huong dich vu.
- 5xx/latency/queue saturation vuot nguong van hanh.
- Ro ri secret/URL signed/credential trong response hoac log.

Thao tac:

- [ ] Dung rollout va cat traffic khoi instance loi.
- [ ] Luu log/metrics/request id; khong sao chep secret/gateway payload day du vao chat/ticket.
- [ ] Rollback frontend/backend bang image digest da ghi.
- [ ] Backend rollback phai giu kha nang decrypt TOTP moi; khong dung ban chi doc plaintext.
- [ ] Khong drop `PaymentReceipt`, `NotificationReceipt` hay index Topup trong rollback khan cap.
- [ ] Khong downgrade topup approved/khong tru credit tu dong; dong bang thao tac credit thu cong neu can va doi soat.
- [ ] Verify `/health`, `/ready`, login va read-only flows sau rollback.
- [ ] Mo incident va lap reconciliation/payment correction duoc phe duyet rieng.
- [ ] **HUMAN CONFIRMATION:** rollback hoan thanh va du lieu da doi soat.

## I. Lenh read-only huu ich

```bash
git rev-parse HEAD
npm run check
npm audit --omit=dev --prefix backend
curl -fsS https://api.example.com/health
curl -fsS https://api.example.com/ready
```

Khong dua output `.env`, cookie 3D66, token, TOTP secret hoac gateway payload nhay cam vao deployment evidence.
