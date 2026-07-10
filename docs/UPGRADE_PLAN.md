# Ke hoach nang cap he thong Get Link 3D66

Cap nhat: 2026-07-10

Tai lieu nay chuyen cac phat hien trong `NEW_MODEL_AUDIT.md` thanh lo trinh co the rollout va rollback. Dot hien tai chi thay doi source trong branch `upgrade/new-model-system-review`; khong deploy, khong chay migration production va khong thay doi secret production.

## 1. Nguyen tac rollout

- Production phai dung MongoDB replica set. Cac transaction credit/payment/referral khong nen phu thuoc vao compensation mode cua Mongo standalone.
- Moi batch chi rollout sau khi lint, test, build, dependency audit va smoke staging pass.
- Database thay doi theo huong additive truoc: tao collection/index moi, deploy code tuong thich, theo doi, sau do moi xem xet cleanup du lieu legacy.
- Khong in secret vao log/CI. Secret production dai toi thieu 32 ky tu theo validation trong server.
- Payment, credit va TOTP khong duoc rollback data tu dong. Rollback code phai van doc duoc record da ghi boi version moi.

## 2. Trang thai cac batch

| Batch | Pham vi | Trang thai source | Dieu kien truoc rollout |
|---|---|---|---|
| 1 | OAuth state, TOTP encryption, serializer, SSRF/redirect, atomic getlink, payment receipt, late payment | Hoan thanh | Mongo replica-set integration test; SePay sandbox; Google OAuth staging |
| 2 | Manual credit/referral unit of work, graceful shutdown, memory adapter, double-submit guard | Hoan thanh | Test SIGTERM tren Linux; fault injection transaction that |
| 3 | Public settings allowlist, audit log, notification receipt, topup idempotency, readiness, proxy cache bound | Hoan thanh | Preflight index; load test polling/read receipt; readiness probe |
| 4 | Dependency patch, Node/npm contract, ESLint, CI, Docker/nginx manifests | Hoan thanh | CI xanh; build container trong registry/staging vi may audit khong co Docker CLI |
| 5 | React hooks, env sample, tai lieu rollout/rollback | Hoan thanh mot phan | Visual/keyboard regression test; xac nhan noi dung tai lieu |

## 3. Thay doi database additive

### `PaymentReceipt`

- Unique `gatewayTransactionId` de chong mot giao dich gateway cong credit nhieu lan.
- Unique `topupId` de mot topup chi co mot receipt.
- Tao cung transaction approve topup khi Mongo ho tro transaction.
- Collection moi, khong can backfill bat buoc de code chay. Topup legacy van duoc doi soat bang record `Topup`; nen backfill chi sau khi co script dry-run va doi soat ke toan.

### `NotificationReceipt`

- Unique cap `(notificationId, userId)`.
- Read path hop nhat receipt moi voi `Notification.readBy` legacy.
- Khong bulk xoa `readBy` trong dot nay. Co the migrate/compact sau khi theo doi it nhat mot chu ky retention.

### `Topup`

- Them `idempotencyKey` va unique partial index `(userId, idempotencyKey)`.
- Them index theo user/status/time/package/voucher cho cac query hien co.
- Record legacy khong co `idempotencyKey` khong vi pham partial index.
- Startup goi model initialization de dam bao index; staging can kiem tra thoi gian build index va duplicate preflight truoc khi nhan traffic.

### TOTP

- Secret moi duoc AES-256-GCM encrypt bang `COOKIE_ENCRYPTION_KEY`.
- Secret plaintext legacy duoc doc tuong thich va re-encrypt sau lan verify thanh cong.
- Khong bulk migration de tranh khoa admin ngoai y muon.

## 4. Thu tu rollout de xuat

1. Tao backup Mongo va kiem tra restore tren moi truong tach biet.
2. Xac nhan Mongo replica set, quyen tao index, dung luong va replication lag.
3. Build image backend/frontend tu commit da duyet; quet image va ghi digest.
4. Deploy staging voi secret rieng, Google callback staging va SePay sandbox.
5. Chay `npm run check`, smoke `/health`, `/ready`, auth, preview, topup idempotency, signed duplicate/late IPN va redownload.
6. Kiem tra unique indexes/collections va quan sat log security/audit khong lo secret.
7. Canary mot backend instance; readiness phai 503 trong drain/DB disconnect va 200 khi san sang.
8. Mo rong backend, sau do frontend; giu version truoc va image digest de rollback.
9. Theo doi credit delta, duplicate receipt, payment pending/rejected, OAuth state error, queue saturation va 5xx.
10. Chi ket thuc change window sau khi post-deploy reconciliation pass.

Chi tiet thao tac va diem xac nhan cua con nguoi nam trong `DEPLOYMENT_CHECKLIST.md`.

## 5. Rollback theo thanh phan

- Frontend: rollback image/static artifact doc lap; backend moi van tuong thich voi frontend cu, tru header idempotency se khong duoc gui.
- Backend: rollback ve ban hotfix co dual-read TOTP va khong xoa collection/index moi. Khong rollback ve code chi doc plaintext TOTP.
- Payment/credit: khong downgrade topup approved, khong xoa receipt va khong tru credit tu dong. Doi soat thu cong neu phat hien sai lech.
- Index/collection: giu lai vi additive. Chi drop sau backup, truy van xac nhan va phe duyet rieng.
- Neu readiness moi gay loi probe, tam chuyen probe ve `/health` chi trong rollback co thoi han; van phai dieu tra ket noi DB truoc khi mo traffic.

## 6. Cong viec tiep theo theo uu tien

### P1 truoc khi scale nhieu instance

- Chuyen rate limit, product/user locks, download counters va request queue can chia se sang Redis hoac shared store.
- Them integration test Mongo replica set cho concurrent getlink, referral, manual credit va duplicate/late IPN.
- Them refresh-token rotation/revocation store neu yeu cau security can logout/revoke tren nhieu thiet bi.
- Chot chinh sach voucher reservation cho late payment va payment het han.

### P2 van hanh va hieu nang

- Thay admin overview scan in-memory bang Mongo aggregation co index va golden-result test.
- Dinh nghia retention duoc phe duyet cho system log, audit log va gateway payload; sau do moi them TTL/archive.
- Them metrics/alert: p95 API, queue depth, browser recycle, payment approval latency, receipt conflict, credit compensation va shutdown timeout.
- Chay load test co gioi han cho notification receipts, topup polling va proxy download.
- Them backup schedule, restore drill va image/container scanning trong pipeline ha tang.

### P3 frontend/bao tri

- Tach `Admin.jsx` va `styles.css` theo module; lazy-load admin route.
- Them focus trap, focus restore, Escape handling va axe/Lighthouse test cho modal/page chinh.
- Them 404/route metadata, image dimensions/optimization va bundle budget.
- Bo sung E2E cho double click, reload trong payment, mat mang, empty/error/loading state.

## 7. Nang cap dependency bi hoan

Dot nay chi cap nhat patch/minor tuong thich va lockfile da duoc audit. Cac major sau can branch/test rieng:

- Express 5.
- Mongoose 9.
- React 19.
- Vite 8 va plugin React major tuong ung.
- dotenv 17, lucide-react 1 va cac major transitive khac.

Moi major phai co compatibility matrix Node/runtime, migration notes, regression tests va rollout/rollback doc rieng.

## 8. Tieu chi hoan thanh chuong trinh

- Khong con P0/P1 chua co owner hoac staging evidence.
- CI la required check va khong co dependency advisory trong pham vi da chon.
- Payment/credit reconciliation khong co duplicate hay delta khong giai thich.
- Restore drill dat RPO/RTO da duoc chu he thong phe duyet.
- Runbook incident, on-call/alert owner va rollback image da duoc xac nhan.
- Tai lieu he thong va checklist deployment khop voi artifact dang chay.
