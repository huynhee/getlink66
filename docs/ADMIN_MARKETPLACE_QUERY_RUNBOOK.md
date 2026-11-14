# Admin Marketplace Query Timeouts

## Diagnosis

On 2026-11-14, Admin regex searches selected the public multikey `searchTokens`
index. A completed slow query examined 6,490,960 keys and 202,738 documents,
returning two models after 57 seconds. Other requests reached the 60-second
socket timeout. Concurrent searches and repeated global statistics made this worse.

The Admin list now uses the nonunique `admin_asset_created_page` index
(`assetType`, descending `createdAt`, descending `_id`) and one aggregate pass
for the exact count and requested page. Legacy missing deletion statuses,
drafts, trash, reports and search semantics remain unchanged. Public search is
not used for Admin assets. No model data or existing indexes are removed.

Queries have a 10-second server budget and cancel on client disconnect. The UI
cancels superseded searches and does not fetch global statistics on each keystroke.
Import progress polls wait for the previous request to finish before scheduling
another poll. Manual refreshes and completed edits still refresh statistics.

## Deployment

Install the index **before** replacing the backend. From `/opt/3dipl/app`, after
pulling and building the images:

```bash
sudo docker compose -f compose.production.yml run --rm --no-deps -T \
  backend node scripts/marketplace-admin-index.js </dev/null
sudo docker compose -f compose.production.yml run --rm --no-deps -T \
  backend node scripts/marketplace-admin-index.js --apply </dev/null
sudo docker compose -f compose.production.yml run --rm --no-deps -T \
  -e NODE_ENV=production backend npm run env:check </dev/null
sudo docker compose -f compose.production.yml up -d --no-deps \
  --force-recreate --wait --wait-timeout 180 backend frontend </dev/null
curl -fsS http://127.0.0.1:5000/ready
```

The index script defaults to dry-run and never drops indexes. A missing required
index produces `ADMIN_MARKETPLACE_INDEX_REQUIRED`; do not suppress that error or
raise socket timeouts. Rollback may leave this additive read index in place.

## Verification

- Check Model and Scene search, pagination, unpublished/free filters and trash.
- Type a search, replace it before completion, then clear it. Only the latest
  result should display. Searching should not request stats or sync state again.
- Compare a sanitized slow-query filter using the new index; record elapsed
  time and counts, not the search text, source URLs or credentials.
- If `ADMIN_MARKETPLACE_QUERY_TIMEOUT` persists, inspect Mongo CPU, I/O and slow
  logs. Narrow substring searches still require scanning matching asset types.

Local regression commands:

```bash
npm run check
node backend/scripts/qa-admin-mobile.js <frontend-build> <evidence-directory>
```

Tests use mock APIs and memory data. Never replay payment or charged download
requests to diagnose list performance.
