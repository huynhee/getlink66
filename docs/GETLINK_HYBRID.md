# Hybrid Getlink

## Explicit Activation

`hybrid` is an additional `THREED66_MODEL_RESOLVE_MODE` value. Select it explicitly
through the environment or the admin Getlink setting `threed66ModelResolveMode`.
Stored site settings remain the runtime authority after initialization. Existing
`search`, `footprint`, `direct`, `collection`, and `rewritten_footprint` modes do not
switch automatically. The example environments retain `search`.

The required account marker and clean-link checks still apply. No migration,
payment, credit debit, or download-history entry is part of preview/preparation.

## Preview API

Both endpoints are authenticated POST requests under `/api`, reject banned users,
use the existing global CSRF protection, and share the same per-user and per-IP
preview rate-limit buckets.

### Fast Metadata

```http
POST /api/getlink/preview
Content-Type: application/json
X-CSRF-Token: <session token>

{"url":"<3D66 model URL>","progressive":true}
```

Hybrid requires a real 3D model page URL, not an ID-only/placeholder model page.
`modelId` remains an alternative to `url` in other modes that support it.
`progressive` is optional and must be a JSON boolean if present. Strings, numbers,
null, arrays, and objects are rejected with HTTP 400.

Hybrid input validation runs before cache access and service invocation, including
mock mode. Duplicate `sof`/`sign`/`id` fields and conflicting IDs return HTTP 400
with `THREED66_HYBRID_INPUT_INVALID`. Unsigned real model URLs may provide metadata
but are not download authorization.

In hybrid mode only, `progressive:true` requests lightweight metadata without
browser preparation. HTTP 200 includes `preparationStatus:"pending"`,
`metadataIncomplete`, and any actual API format choices available at that stage.
Missing choices stay empty rather than being guessed. An unknown price is `null`.
Missing metadata is allowed at this stage and must not be treated as a verified
price or a download-ready result. API format metadata alone does not authorize a
download or prove that every choice has loaded.

Fast metadata bypasses the shared ProductCache gate and is not persisted at all.
It cannot overwrite `resolvedSourceUrl`, an existing purchased download, its
`fileUrl`, format data, or verified source context. No source/download URL is
exposed in this response.

The pending response's `imageUrl` is a direct HTTPS URL validated with the existing
3D66 host allowlist, or an empty string when missing or unsafe. Relative images are
normalized. It is deliberately not `/api/getlink/preview-cache/:productId`, since
no cache record was written. Rendering may depend on upstream hotlink rules; a
missing image is safe to display until preparation replaces the preview. Do not
persist unverified metadata solely to make the image proxy work.

### Full Preparation

```http
POST /api/getlink/preview/prepare
Content-Type: application/json
X-CSRF-Token: <session token>

{"url":"<same 3D66 model URL>"}
```

The prepare endpoint rejects `progressive`, including `false`. It calls the same
full-preview handler as `/preview` with `progressive` omitted or `false`, preserving
compatibility for existing clients. Other getlink operations do not accept the
new flag. In non-hybrid modes a valid `progressive:true` still follows the existing
full-preview behavior and does not change modes.

Hybrid full preview never returns early from the shared ProductCache, even when
its metadata and formats are fresh. It always enters the service with the active
cookie, allowing only the service's credential/configuration-bound two-minute
verification cache to skip repeated preparation. Verification failures propagate;
shared product data cannot substitute for verification.

Fast metadata has a separate bounded queue (`THREED66_METADATA_CONCURRENCY=1`,
`THREED66_METADATA_QUEUE_MAX=200` by default), so API reads do not wait behind a
browser preparation. Concurrent reads/preparations for the same credential/model
share their pending operation. These are process-local caches, not persistent
authorization records. Pending metadata expires after 30 seconds; verified links
expire after exactly two minutes. Credentials, account marker, browser and proxy
configuration all scope the cache. A changed configuration during preparation
invalidates the result rather than accepting it under the new configuration.

Model matching compares the complete normalized asset identity, not merely a
shared five-digit suffix. Duplicate/conflicting URL identity fields are rejected
before any upstream request. Redirected account-specific paths remain valid only
for the exact expected model. No failure falls back to downloading the raw user
URL. API verification failures stop the operation instead of switching cookies or
proxy routes; browser challenges retain the exact page for manual Admin handling.

On success, hybrid full preview returns `preparationStatus:"ready"`,
`formatsChecked:true`, plus the normal
sanitized formats and image proxy URL, and may persist verified preview metadata.
Existing purchased `fileUrl` and ownership/history are not replaced by preview.
Incomplete full metadata retains HTTP 422 behavior. Preparation does not reserve
a price, purchase a file, or bypass normal download authorization and clean-link
validation.

A verified model page may legitimately have no inline selector. It returns an
empty list with `formatsChecked:true`; an unreadable or challenged page instead
fails preparation. The normal server-side format-selection contract remains
authoritative when creating a download job.

## Service Integration Contract

The controller invokes the existing service as follows:

```js
fetch3D66Preview(url, cookieValue, {
  includeFormatOptions: !progressive,
  progressive,
});
```

`progressive` is true here only for explicit hybrid fast-preview requests. The
service must not launch a browser or claim clean-link readiness for that branch;
it supplies `preparationStatus:"pending"` and `metadataIncomplete` when needed.
Default/full calls include formats and complete account-bound clean validation,
returning `preparationStatus:"ready"` in hybrid mode. Verification cache isolation,
invalidation, and the two-minute TTL belong to the service, not ProductCache.

Frontend integration should render the pending metadata, request preparation for
the same input, discard responses for superseded inputs, and enable download only
after the prepared result. Replace pending metadata/formats with the full result;
do not reuse pending fields as readiness or authorization evidence.

## Focused Verification

Use the pinned Node version and run:

```sh
node --test backend/test/getlink-progressive-preview.test.js
npx eslint backend/src/controllers/getlinkController.js backend/src/routes/getlinkRoutes.js backend/src/controllers/settingsController.js backend/src/models/SiteSetting.js backend/src/config/productionReadiness.js backend/test/getlink-progressive-preview.test.js
```

Tests use in-memory models and module hooks that replace upstream service/cookie
entry points before controller import. They perform no real upstream reads,
browser work, database connections, or payments. Before deployment, run the full
repository checks and production environment validation; this change does not
deploy or enable hybrid mode.

## Rollout And Rollback

Local verification on 2026-11-04: `npm run check` passed (941 backend tests, ESLint
and release build verification). The full `qa:smoke` suite passed with 7 routes,
desktop/mobile, VI/EN, light/dark and zero external request failures. Hybrid UI
fixtures cover early choices, preparation failures, price/format review,
insufficient-credit retention, stale responses and restored drafts. All tests use
mock upstream data; these timings are not real 3D66 performance measurements.

Deploy backend and frontend together. No migration or cookie replacement is
required. Retain the existing `THREED66_BROWSER_HEADLESS=false`, encrypted profile
volume and browser-state key on a headed VPS. Do not clear profiles to roll out
this feature. A backend restart ends any currently open manual verification tab;
open a fresh handoff after restarting if needed.

After readiness and public-settings checks, the owner can explicitly select
Admin -> Getlink -> Tasks -> Automatic hybrid and save. Verify the configured
account ID before enabling it. A read-only check must never call the purchase
endpoint, debit credit, or create a user download. Stop on verification errors;
complete verification manually in Admin, not through repeated alternate routes.

To stop using hybrid, restore the previously selected Admin task mode. Existing
clean-link account checks must remain enabled. For a code rollback, retain both
previous container images before rebuilding and restore backend/frontend as a
pair. Do not revert cookies, credit balances, or download history. Keep the new
code while investigating if returning to the previous mode is sufficient.
