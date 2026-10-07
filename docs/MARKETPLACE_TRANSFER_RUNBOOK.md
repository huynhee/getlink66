# Model and Scene File Transfer

Model/Scene proxy downloads use the same bounded streaming pipeline and shared
connection capacity as Getlink. This changes file transport, not prices, quotas,
archive contents or Drive metadata.

## Delivery and Limits

- Keep `MARKETPLACE_DOWNLOAD_DELIVERY=proxy` to avoid exposing Drive URLs.
  Existing explicit redirect mode remains available, but is not this pipeline.
- Web and plugin keep their existing authentication, ownership and session-token
  checks. A token is not a replacement for authentication.
- Default shared capacity: 20 global connections, 2 full downloads per account,
  4 per IP, up to 6 total connections per account and 12 per IP for byte ranges.
  These limits include Getlink and marketplace downloads together, per backend
  process. They are not a distributed limiter across replicas.
- Existing `MAX_GLOBAL_DOWNLOADS`, `MAX_DOWNLOADS_PER_USER`,
  `MAX_DOWNLOADS_PER_IP`, `MAX_DOWNLOAD_RANGE_CONNECTIONS_PER_USER` and
  `MAX_DOWNLOAD_RANGE_CONNECTIONS_PER_IP` control capacity. Do not increase
  limits without measuring Drive throttling, bandwidth, CPU and memory first.
- Streams use 256 KiB high-water marks and backpressure, never a whole-file RAM
  buffer. Disconnecting cancels the upstream request even before headers arrive.
- Valid Range/If-Range and upstream ETag/Last-Modified are preserved. A stale
  validator returns a full response rather than joining two different files.
  Invalid or multipart ranges return 416; capacity exhaustion returns 429 with
  Retry-After. Download managers can segment or resume without another charge.
- Credit is finalized after opening the source; HEAD probes, invalid ranges,
  upstream-open failures and rejected connections do not charge Credit or count
  a download. Quota still charges when creating the session, as before. Retrying
  an issued session does not charge or count again. If Drive fails after billing,
  the existing 24-hour Credit entitlement permits retry without another debit.
- Browser downloads are not automatically split into six connections. A single
  transfer remains limited by Drive, the VPS, Cloudflare and the user's network.

## Deploy

After the tested changes have been committed and pushed:

```bash
bash <<'BASH'
set -euo pipefail
cd /opt/3dipl/app
git pull --ff-only origin main
git log -1 --oneline
sudo docker compose -f compose.production.yml build backend </dev/null
sudo docker compose -f compose.production.yml run --rm --no-deps \
  --interactive=false -T -e NODE_ENV=production \
  backend npm run env:check </dev/null
sudo docker compose -f compose.production.yml up -d \
  --no-deps --force-recreate --wait --wait-timeout 180 backend </dev/null
curl -fsS http://127.0.0.1:5000/ready
BASH
```

No migration, price change or new storage volume is required. Keep existing
secrets in `/etc/3dipl/production/backend.env`.

## Nginx and Monitoring

Check the active host configuration, not only the repository template:

```bash
sudo nginx -T 2>&1 | grep -A 24 'location ~.*download/session'
sudo docker compose -f compose.production.yml exec -T backend \
  printenv MARKETPLACE_DOWNLOAD_DELIVERY
```

The streaming location in `ops/nginx/3dipl.conf` already covers
`/api/download/session/:id/file` and `/api/plugin/download/session/:id/file`.
It forwards Range/If-Range, disables gzip, proxy buffering and temporary-file
buffering, and allows one-hour idle timeouts. Merge missing directives into the
active server block without replacing existing TLS/upload/plugin-release
configuration. Run `sudo nginx -t` before `sudo systemctl reload nginx`.

```bash
sudo docker compose -f compose.production.yml logs --since=30m backend \
  | grep 'MARKETPLACE_DOWNLOAD_TRANSFER'
```

Each transfer records asset/client type, partial/full response, received bytes,
upstream-open time, first-byte time, duration, completion and proxy MiB/s. No
Drive URL or download token is included. These are application-to-Nginx metrics,
not proof of the user's last-mile throughput. Compare the same file and network
before/after deploying; do not create paid sessions merely to benchmark.

## Verification and Rollback

Automated tests use only mocked Drive responses and memory databases. They cover
six concurrent ranges, exact bytes, Credit/count idempotency, quota retries,
HEAD, ownership, stale validators, 416/429/502, early cancellation, truncation,
local storage and bounded stream buffers.

After deployment, use a legitimate download to compare size/hash, resume, and
observed speed on web/plugin. Do not claim a production speedup from mock tests.
If necessary, redeploy the prior backend image while preserving current env and
databases. No data/schema rollback is needed; do not reset paid entitlements or
download counters. Lower connection limits if upstream throttling increases.

Reference: [HTTP If-Range](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.5).
