# System Review and Hardening: 2026-09-07

Baseline: `8144d19`. This is a source review and local regression pass, not a
production certification. No production database, payment, Drive file, environment,
or migration was modified. Changes are local until reviewed and deployed.

## Implemented

| Area | Confirmed issue | Change |
| --- | --- | --- |
| Account balance | A completed Getlink job reapplied its historical credit whenever the live balance changed, including after top-up and page remount. | Job completion invalidates the account snapshot; App and GetlinkBox no longer replay old balances. |
| Account races | Cross-tab invalidations could reuse a read started before payment. | Coalesced refresh retries when invalidated, discards old responses and stale failures. |
| Realtime account | Only Credit top-ups notified subscribers. | Post-commit invalidations for Pro approval, Getlink debit, marketplace debit, and manual Credit adjustments. No events for compensated/failed writes. |
| SSE | Stream cleanup followed the incoming request, and old unsubscribe callbacks could delete newer connections. Slow clients had no backpressure bound. | Cleanup follows response close; unsubscribe checks group identity; blocked writers disconnect. Reconnect refreshes the authoritative account. |
| Getlink requests | Late responses could restore jobs after logout/account switch; polling could overwrite action results. | Identity/version guards, abort superseded reads, avoid overlapping polling/actions, stop polling hidden tabs, slower idle polling. |
| Credit download | A worker crash left a pending billing claim without a recovery deadline. | Two-minute reclaimable lease, conditional ownership updates, same Atlas operation ID and entitlement reused. Legacy claims use their update timestamp. |
| Autocomplete | Case-insensitive title/token OR plus popularity sort could scan the catalog without a deadline. Optional analytics could delay Meilisearch results. | Normalized token prefix using the existing index, bounded candidate reads, 200 ms Mongo execution budget and 250 ms response budget; popular-query budget 150 ms. Degraded suggestions are explicitly identified. |
| CI security | Regex classification could interpret `503` in an advisory as a service failure and suppress a failed security audit. | Parse JSON reports. Critical findings always fail. Only recognized service failures/timeouts can warn; malformed/config errors fail. Unavailable audit is not reported as clean. |
| Initial page load | All visitors downloaded the full Admin implementation. | Lazy-load Admin with a loading boundary. |
| Test fidelity | Memory regex queries did not match individual array elements like MongoDB. Browser smoke accepted an unloaded Admin root. | Correct regex array matching, wait for Admin, test real HTTP/SSE account updates, close proxy connections, disable production-facing jobs/ads during smoke. |

## Evidence

- Baseline: 252 passing Node tests.
- Updated: 265 passing Node tests; lint and release artifact verification pass.
- Initial JavaScript: 637.91 kB -> 411.65 kB (35.5% smaller).
- Initial JavaScript gzip: 177.29 kB -> 120.62 kB (32.0% smaller).
- Admin chunk: 227.82 kB, fetched only when Admin is rendered.
- Browser smoke covers six public routes and Admin at 1440x900 and 390x844.
- Live-balance scenario uses the actual local API, CSRF, account SSE endpoint and
  a separate HTTP client to grant Credit. A mocked *old completed job* must not
  overwrite the balance, including after remount. Update deadline: four seconds,
  shorter than the normal 15-second polling fallback.
- The load smoke uses an empty in-memory catalog: its latency does **not** establish
  performance on the production MongoDB/Meilisearch catalog or image delivery.
- Financial concurrency tests use memory fixtures, not a real Atlas replica set.
  They verify application invariants but do not certify Mongo transaction behavior.
- Actual npm registry vulnerability scanning was not part of this pass; classification
  is tested with deterministic structured reports, including critical findings.

Reproduce from the repository root:

```bash
npm run check
npm run build --prefix frontend -- --outDir ../qa-report/test-results/audit-release --emptyOutDir
npm run qa:smoke --prefix backend -- ../qa-report/test-results/audit-release ../qa-report/screenshots/system-audit ../qa-report/performance-results/system-audit-smoke.json
```

## Still Requires Staging or Production Evidence

1. Run representative typo/ID/category searches against the real catalog. Verify
   Meilisearch rollout, task backlog, index parity, timeout rate, zero-result rate,
   and Mongo query plans. Do not infer readiness from the local empty-catalog test.
2. Test concurrent Credit downloads on an isolated replica set, including process
   termination after Atlas commit but before VPS session update. Verify one ledger
   entry, one debit, preserved entitlement, and recovered download history.
3. Test payment webhooks and zero-price Pro checkout in staging, including replay,
   quota grants, multiple tabs, SSE reconnect, session revocation, and plugin reads.
4. The account event bus is process-local. Multiple backend replicas or standalone
   workers need shared pub/sub or a durable outbox. Polling is still the fallback;
   it is not an exactly-once realtime event system.
5. SSE authorization is checked on connection; connections expire after ten minutes.
   Immediate server-side stream termination on session revocation remains a gap.
6. Check Drive sync/migration leases, cover conversion failures, signed plugin
   release configuration, database health and an actual backup restore drill.
   Existing automated tests do not prove these production integrations are healthy.
7. The Meilisearch service currently receives the backend env file. Separate its
   environment to reduce credential exposure in a reviewed infrastructure change.

## Deployment

No new environment variables, catalog rebuild, Drive migration, or manual database
reset is required for this patch. `creditBillingLockedAt` is an additive optional
field. Existing pending sessions remain readable. Keep MongoDB and Meilisearch up.

After these changes are committed and merged into `main`, on the VPS:

```bash
cd /opt/3dipl/app
git pull --ff-only origin main
sudo docker compose -f compose.production.yml build backend frontend
sudo docker compose -f compose.production.yml run --rm --no-deps backend npm run env:check
```

Only if the environment check passes:

```bash
sudo docker compose -f compose.production.yml up -d --no-deps backend frontend
sudo docker compose -f compose.production.yml ps backend frontend
sudo docker compose -f compose.production.yml logs --since=5m backend
```

Verify a test-account top-up/debit without F5, then reconnect and open a second tab.
Check search suggestions and an existing Credit entitlement. If rolling back, deploy
the previous reviewed application images; do not delete entitlements or ledger rows.
