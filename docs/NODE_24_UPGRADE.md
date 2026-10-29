# Node 24 Runtime Upgrade

Target: Node **24.22.2 LTS**, bundled npm **11.19.1**. No application dependency versions, secrets, payment routing, database schemas, or archive-tracing keys change in this upgrade.

Sources: [Node 24.22.2 release](https://nodejs.org/en/blog/release/v24.22.2), [October 2026 security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

## Runtime Contract

- `.nvmrc` pins the development and GitHub Actions runtime.
- All application manifests and lockfile root records require `>=24.22.2 <25`.
- Backend uses `node:24.22.2-bookworm-slim`; the frontend build uses `node:24.22.2-alpine`. Frontend delivery remains Nginx, not Node.
- `backend/test/runtime-contract.test.js` checks the pins and verifies tests actually run on a supported Node version.
- Historical audit reports still describe the runtime that was audited at that time.

## Verification

Activate Node 24.22.2 using the local version manager, then check `node --version` and `npm --version` before running:

```bash
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix backend
npm ci --ignore-scripts --prefix frontend
npm run check
npm run build:release
npm run qa:smoke --prefix backend -- ../frontend/dist /tmp/3dipl-node24-qa/screenshots /tmp/3dipl-node24-qa/smoke.json
```

Use a local temporary path instead of `/tmp` on Windows. QA uses an isolated in-memory database and mock payments. Never pass production env files into automated tests. Also verify a clean install, native Sharp, and critical download/payment mocks on the Linux candidate image before promotion.

Windows verification on 2026-10-29 used the official Node ZIP with SHA-256 checked against the release announcement: all 666 tests, lint, release build verification, and fresh installs of all three lockfiles passed. Native Sharp encoded a JPEG successfully. Browser/API/load/memory smoke passed for 7 routes and 2 viewports (VI/EN and light/dark); 300 fixture requests at concurrency 20 had median 11.56 ms and p95 18.52 ms, with zero external failures. These are isolated QA results, not production latency guarantees. One initial dev-launcher timeout was not reproduced in its isolated run or the subsequent full run; no test was removed or timeout increased.

## VPS Deployment

The host does not need Node installed. Preserve the exact running backend/frontend images before building, and record their image IDs. Do not print Docker environment arrays or credentials.

```bash
cd /opt/3dipl/app
git pull --ff-only origin main

sudo docker image tag "$(sudo docker inspect --format '{{.Image}}' 3dipl-backend)" 3dipl-backend:before-node24-20261029
sudo docker image tag "$(sudo docker inspect --format '{{.Image}}' 3dipl-frontend)" 3dipl-frontend:before-node24-20261029

sudo docker compose --progress plain -f compose.production.yml build --pull backend frontend </dev/null
sudo docker compose -f compose.production.yml run --rm --no-deps --interactive=false -T -e NODE_ENV=production backend npm run env:check </dev/null
```

Build and smoke must pass before activating the new containers:

```bash
sudo docker compose -f compose.production.yml up -d --no-deps --force-recreate --wait --wait-timeout 180 backend frontend </dev/null
sudo docker compose -f compose.production.yml exec -T backend node --version </dev/null
sudo docker compose -f compose.production.yml exec -T backend npm --version </dev/null
curl -fsS http://127.0.0.1:5000/ready
curl -fsS http://127.0.0.1:8080/healthz
```

Verify account bootstrap, Model/Scene search, bounded Drive downloads and encrypted comments, and worker health. Payment validation must remain read-only; do not create real charges as a deployment test. Keep the existing `.env` files, volumes, Mongo/Meilisearch containers, and encryption keys unchanged.

## Emergency Rollback

If the new runtime fails, retag the preserved images to the image names resolved by Compose (normally `3dipl-backend:local` and `3dipl-frontend:local`), then recreate only backend/frontend with `--no-deps --wait`. Do not rebuild, reset Git, alter secrets, roll back databases, or disable archive marks. Runtime-only rollback preserves the same application behavior and pending payments. Node 20 is EOL: this is a temporary recovery step, not a long-term supported configuration.
