# Drive queue intervention

## Confirmed issues

- Production had 6,549 pending model changes and no failed items at inspection.
  The worker polled up to 100 changes but processed only 20 folders per cycle.
- A failed cross-process lock claim entered the generic error handler, which
  overwrote the existing owner's state with `error`. This could admit another
  worker on retry and generate misleading sync failure alerts.
- The interval scheduler could start another model/scene cycle before the
  previous cycle completed.

## Changes

- Track successful lock ownership before writing error state.
- Skip overlapping scheduled cycles and treat expected 409 conflicts as debug
  events, without changing the database owner's lock.
- Production `MARKETPLACE_DRIVE_QUEUE_BATCH_SIZE` changed from 20 to 100.
  Processing remains serial; no checkpoint or pending task was deleted.
- A controlled 100-item run completed in 231,166 ms with 100 successful updates
  and zero failures. It also queued 50 changes. This is a sample, not an SLA.
- Backend was rebuilt with the patch and recreated only after observing both
  Drive workers idle. Mongo, Meilisearch and frontend were not restarted.

The first controlled attempt exposed the old failed-claim bug. Do not run
parallel drain commands against older versions of the worker.

## Verification

- `npm run check`: lint, 273 tests and frontend build verification passed.
- Production `env:check` passed with four pre-existing optional-search warnings.
- Running container contains the lock guard and reports batch size 100.
- Post-deployment direct search returned HTTP 200 in 146 ms.
- Storage health reported only the corrupt-cover warning, with no critical or
  Drive failure alert. All three checked application/database containers were
  healthy. A subsequent queue sample showed 6,460 pending and one processing,
  with no failed items; five-minute logs contained no overlapping-worker errors.
- Follow-up at 2026-09-08T02:12Z found zero pending items and one failed item.
  Both workers were idle with no worker-level error.

## Final stale-folder conflict

The remaining failure was source model `3232530`, Brooks Collection Sofa,
Gatsby Soffbord, Fandi carpet. Drive metadata confirmed that its old folder
was trashed, while the replacement folder was active.

The synchronization service now permits replacement only with valid metadata,
the same source ID, an explicitly trashed old folder, and no publication
blockers. Active folders and unverified/missing old folders remain conflicts.
The database write compares the old binding and deletion state to avoid
overwriting a concurrent change. Tests cover replacement, active folders,
incomplete replacements, concurrent writes and an old-folder 404.

The production model was synchronized with this guarded path. Its existing
ID, slug and download count were preserved; it remained published and synced.
Only its matching failed queue generation was removed after verification.
No Drive files were edited or deleted.

After deploying the replacement guard, the 2026-09-08T02:21:52Z health check
reported no failed Drive jobs, 26 newly pending changes and only the existing
corrupt-cover warning. The large historical backlog had drained; the remaining
pending count represents ongoing change ingestion, not failed work.

## Corrupt image

`cabildo 2` has a cover containing exactly 11,378 zero bytes, despite its
`image/jpeg` content type. All three preview sources also failed decoding in
the earlier inspection. Valid original images are required; retrying cache
generation cannot reconstruct missing image data. No Drive source was changed.

## Operations

The patch is present in the VPS checkout as an uncommitted change and also in
the local repository. Coordinate its commit/release before the next git pull;
do not discard the VPS change without deploying the same fix from main.

Read-only inspection on VPS:

```bash
cd /opt/3dipl/app
sudo docker compose -f compose.production.yml ps backend
sudo docker compose -f compose.production.yml logs --since=15m backend \
  | grep -E 'Drive changes sync finished|Drive changes sync failed'
```

Rollback assets, for a reviewed rollback only:

- Image: `3dipl-backend:before-drive-lock-fix-20260908`.
- Environment backup: `/etc/3dipl/production/backend.env.before-drive-tuning-20260908`
  (root-owned, mode 600). Restore only the batch setting if unrelated env changes
  have occurred since the backup.
- Rolling back the image reintroduces the lock bug. Prefer keeping the fix and
  lowering batch size if Drive latency increases.
