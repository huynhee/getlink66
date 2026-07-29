# Deployment Guide

Không chạy các lệnh này trên production trước khi `17-PRODUCTION-CHECKLIST.md`
được duyệt. Repo chưa có Compose/systemd; các lệnh Docker dưới đây là quy trình
an toàn được suy ra từ hai Dockerfile hiện có.

## 1. Preflight

Chạy bằng release operator trong thư mục checkout:

```bash
git status --short
git rev-parse HEAD
node --version
npm --version
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix backend
npm ci --ignore-scripts --prefix frontend
npm run check
NODE_ENV=production npm run env:check
npm run drive:check
```

Mong đợi: worktree/release SHA đúng, Node 20, quality gate và env/Drive đều pass.
Nếu một lệnh lỗi: dừng release, không bỏ qua gate.

## 2. Backup và Migration

Tạo snapshot Atlas/VPS và Drive manifest; restore thử theo
`22-BACKUP-RESTORE-GUIDE.md`. Sau đó:

```bash
npm run marketplace:asset:dry-run
```

Review counts/diff. Chỉ execute trong change window khi có approval:

```bash
MIGRATION_CONFIRM=marketplace-asset-v1 npm run marketplace:asset:execute
```

Không bật startup migrations.

## 3. Build Immutable Images

```bash
SHA="$(git rev-parse --short=12 HEAD)"
docker build --pull -t 3dipl-backend:"$SHA" backend
docker build --pull \
  --build-arg VITE_API_URL= \
  --build-arg VITE_3DSMAX_PLUGIN_DOWNLOAD_URL=https://3dipl.org/plugin/download \
  -t 3dipl-frontend:"$SHA" frontend
docker image inspect 3dipl-backend:"$SHA" --format '{{.Id}}'
docker image inspect 3dipl-frontend:"$SHA" --format '{{.Id}}'
```

Quét CVE bằng scanner của hạ tầng và lưu digest. Không dùng tag `latest`.

## 4. Staging Run

Backend cần env-file ngoài repo, permission 600:

```bash
docker run -d --name 3dipl-backend-staging \
  --restart unless-stopped \
  --env-file /etc/3dipl/staging/backend.env \
  -p 127.0.0.1:5000:5000 \
  --stop-timeout 45 \
  3dipl-backend:"$SHA"

docker run -d --name 3dipl-frontend-staging \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  3dipl-frontend:"$SHA"
```

Reverse proxy phải route `/api`, `/health`, `/ready` tới backend và phần còn lại
tới frontend, dùng HTTPS và giữ `X-Forwarded-Proto/For`. Chỉ chạy **một backend
replica** ở release này.

## 5. Verify Staging

```bash
curl -fsS https://staging.example.com/health
curl -fsS https://staging.example.com/ready
docker inspect --format '{{json .State.Health}}' 3dipl-backend-staging
docker logs --since=10m 3dipl-backend-staging
```

Chạy smoke trong `19-POST-DEPLOY-CHECKLIST.md`: OAuth, Turnstile, SePay sandbox,
Free/Pro, getlink, plugin, Drive preview/download và admin. Không dùng tiền thật.

## 6. Production Rollout

Sau approval, tạo container mới cạnh container cũ, kiểm tra `/ready`, đổi upstream
reverse proxy atomically, theo dõi 30 phút rồi mới dừng bản cũ. Frontend triển
khai sau backend. Không rotate secret trong cùng change nếu chưa có dual-key plan.

## 7. Failure Handling

- Env gate/build/migration fail: dừng trước rollout.
- `/ready` fail: không đưa instance vào upstream.
- Credit/payment/download sai: ngắt traffic và chạy rollback ngay.
- Không xóa DB/container cũ trong change window; giữ evidence đã redact.
