# Getlink reliability review - 2026-11-02

## Scope and fixes

- Separate in-flight file resolution by model, page and selected format. Identical
  requests still share work, but concurrent VRay/Corona requests cannot share the
  wrong result.
- Bind a new job's idempotency key to its original input, preview option, price
  confirmation and format. Conflicting replays return 409 before executing work.
  Existing jobs without fingerprints remain readable and replayable.
- Exclude disabled cookies and compare the stored cookie value before recording
  health. An older request cannot reactivate a disabled or replaced credential.
- Cancel obsolete preview requests and ignore late responses after editing input.
  Browser drafts preserve input, but only reuse previews for 30 seconds, for the
  same input and resolver mode. Legacy drafts must be checked again.
- Keep the selected format during job polling. Dismissed terminal jobs cannot
  overwrite a newer preview when the UI language changes or polling repeats.
- Wait for the configured resolver mode before checking a model. Admin Getlink
  settings cannot be edited before the initial server configuration is loaded.
- Report pending Direct verification with the direct-model stage, while keeping
  the existing error code compatible with the worker's no-automatic-retry rules.

## Verification

- Node 24.22.2: `npm run check` passed, 808 tests, no failures or skips.
- Focused Getlink Playwright smoke passed in VI/EN, light/dark, desktop/mobile.
- Full browser/API/load smoke passed: seven routes, two viewports, no external
  request failures. Includes delayed previews, expired drafts, delayed job
  acknowledgement, format polling and delayed initial Admin settings.
- Test data, file resolution and payments were mocked or in-memory. No source
  model was purchased or downloaded. These results do not claim that 3D66 will
  accept a particular production browser session.
- Local evidence: `.cache/getlink-review/`, `getlink-review-check.log`,
  `getlink-review-formats.log` and `getlink-review-smoke.log` under `.cache/`.

## Deployment and operational boundaries

- Build and deploy backend and frontend together. No new env values, indexes,
  data migration, history deletion or cache purge is needed.
- Run production `env:check` on the new image before recreating containers.
  Check for active Getlink jobs first and retain the previous image tags.
- Confirm `/ready`, the public frontend asset hash, and the public Getlink status
  after deployment. Compare cookie count/value digests without logging secrets.
- Database cookies, a temporary noVNC profile and a retained verification tab are
  separate states. Closing a tab does not delete database cookies. Restoring a
  saved manual session into the cookie pool requires explicit authorization and
  account validation; this patch does not do it automatically.
- Real source verification still requires the operator. No CAPTCHA solver,
  fingerprint spoofing, relaxed account/sign checks or automatic purchase was
  introduced.
- Rollback can recreate backend/frontend from the retained images. The optional
  requestFingerprint field does not require a database rollback. Drain running
  jobs before either deployment or rollback.
