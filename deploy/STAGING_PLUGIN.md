# 3DiPL plugin staging

## V3 Release Update

Use `docs/PLUGIN_RELEASES_RUNBOOK_2026-10-02.md` for the current 1.0.1/1.0.2
signed release workflow. The RC sections below are historical. New database
releases are uploaded/verified/published through Admin; do not copy files into
frontend static storage or revive an old env feed after database cutover.

## RC 0.5.0 status

Templates are prepared, but a live staging deployment is NOT verified. Do not
point this stack at Production Atlas, Drive folders, payment accounts or secrets.
The unsigned RC is for manual staging installation only. Keep
`PLUGIN_RELEASE_ENABLED=false` until signed artifacts are available.

On the VPS, after the reviewed source changes have been committed and pulled:

```bash
cd /opt/3dipl/app
sudo install -d -m 700 /etc/3dipl/staging
sudo cp -n backend/.env.staging.example /etc/3dipl/staging/backend.env
sudo chmod 600 /etc/3dipl/staging/backend.env
sudoedit /etc/3dipl/staging/backend.env
sudo docker compose -f compose.staging.yml build
sudo docker compose -f compose.staging.yml up -d mongo-staging
sudo docker compose -f compose.staging.yml exec -T mongo-staging mongosh --quiet --eval '
try { rs.status() } catch (error) {
  if (error.code !== 94) throw error;
  rs.initiate({_id:"rs0",members:[{_id:0,host:"mongo-staging:27017"}]});
}'
sudo docker compose -f compose.staging.yml run --rm --no-deps backend-staging npm run env:check
```

Stop if env check fails. The example intentionally omits credentials: supply
independent JWT/cookie/CSRF/encryption keys, OAuth callback, Turnstile, isolated
Drive roots and backup configuration required by the validator. Never copy the
Production env wholesale. Only start the application after that check passes:

```bash
sudo docker compose -f compose.staging.yml up -d backend-staging frontend-staging
sudo docker compose -f compose.staging.yml ps
sudo docker compose -f compose.staging.yml logs --since=5m backend-staging
curl -fsS http://127.0.0.1:15000/ready
```

Use the existing reverse proxy to route the staging hostname to the loopback
ports in `deploy/Caddyfile.staging`; do not start a second proxy on occupied
ports 80/443. DNS, TLS and Google OAuth allowed redirect origins must be set up
separately. Verify SSE without proxy buffering and measure latency with test
accounts. Do not paste Bearer tokens into chat or URLs.

Rollback: use the recorded previous staging image tag with `APP_VERSION` and
`docker compose -f compose.staging.yml up -d --no-build`; never use `down -v` or
delete staging/Production data to roll back a container. RC Desktop rollback is
still a release gate requiring an installed 0.4.0-to-0.5.0 update test.

## Signed release checklist

1. Point `staging.3dipl.org` to the VPS and install Docker Compose plus Caddy.
2. Copy `backend/.env.staging.example` to `/etc/3dipl/staging/backend.env`, replace every placeholder, and restrict the file to the deploy account.
3. Keep staging MongoDB, storage, JWT, Turnstile and release keys separate from Production. Do not enable production payments.
4. Start the isolated stack with `docker compose -f compose.staging.yml up -d --build` and install `deploy/Caddyfile.staging` in the host Caddy configuration.
5. Initialize the staging replica set once, then run `NODE_ENV=production npm run env:check` inside the backend container.
6. Publish the signed staging MZP under `/var/lib/3dipl-staging/plugin-releases`, copy SHA/signature/timestamp from the generated release manifest into the staging env, and recreate the backend container.
7. Run DevHost Live and the Max 2026 E2E checklist before changing Production.

The `x-3dipl-qa-risk-secret` header only marks a device authorization as risky when `PLUGIN_DEPLOYMENT_ENV=staging`. Production readiness rejects `PLUGIN_QA_RISK_SECRET` when deployment environment is Production.
