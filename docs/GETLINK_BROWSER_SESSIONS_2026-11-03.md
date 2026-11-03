# Getlink native browser sessions

The browser runs full Chromium (`channel: chromium`, headed or new headless
mode) instead of Playwright's separate headless-shell binary. It uses its native
User-Agent and a stable context per
source-cookie/configuration/proxy key. It does not impersonate another browser,
override automation properties, solve verification challenges, or import a
separate noVNC account session automatically.

## Lifecycle

- Requests for the same profile are serialized; ordinary contexts are bounded by
  the configured browser concurrency. Different source cookies and routing
  configurations never share state. Idle contexts block all network requests
  until a task installs its scoped routes again.
- Cookie and source-domain localStorage snapshots are kept in bounded process
  memory, including across Chromium recycling. Idle contexts expire after ten
  minutes; memory snapshots expire after thirty minutes. Optional encrypted disk
  snapshots survive backend restarts. Database cookies remain unchanged.
- Snapshots read existing frames only. They do not call Playwright storageState()
  or create/focus auxiliary tabs, including in headed/manual environments.
- Failed tasks discard their ordinary context. A real challenge transfers the
  exact context to the existing Admin verification flow and blocks more work for
  that credential until the operator handles it or the verification session
  expires. Payment and account/signature validation rules are unchanged.
- Explicit manual completion persists state under the refreshed credential key
  before declaring success. Pending challenge state is also saved at handoff and
  before the verification context closes, without approving the challenge.
- Cancelling a tab or restarting the backend does not delete saved profiles.
  Cookie expiry is still enforced by the browser/source. Corrupt/unreadable
  profiles fail closed; they are not silently cleared or overwritten.

## Assets and configuration

The browser loads page images/fonts/media by default. HTTPS resources under
alicdn.com, aliyuncs.com and aliyun.com are allowed for provider widgets, but
these domains are not allowed as top-level browser destinations. Main model
navigation remains restricted to the configured source allowlist.

Use `THREED66_BROWSER_BLOCK_ASSETS=false` to ensure a previous explicit `true`
does not retain the old asset blocking behavior. No new secret is required.
Headless/headed mode follows `THREED66_BROWSER_HEADLESS`. The backend container
starts a private Xvfb display when headed mode is requested without an existing
DISPLAY. X11 TCP is disabled and a private temporary Xauthority cookie protects
the local display. Node receives shutdown first so it can drain jobs and save
state before Xvfb stops. No VNC/debugging port is exposed. The Admin frame and
pointer relay operate the same retained Getlink context, not a separate login.

## Durable authentication profiles

Set `THREED66_BROWSER_PROFILE_DIR=/var/lib/3dipl/getlink-profiles` to enable
encrypted persistence. The existing COOKIE_ENCRYPTION_KEY protects AES-256-GCM
files, each bound to its opaque credential/configuration/proxy key. The private
host directory must belong to UID/GID 1000 with mode 0700; files use mode 0600
and atomic, serialized replacement. Do not publish, commit, or serve this volume.
Production and staging have separate host volumes. Do not rotate the encryption
key without a reviewed profile migration/backup.

These are cookie/localStorage authentication profiles, not full Chromium user
data directories. Browser history/cache, sessionStorage and IndexedDB are not
persisted. No localStorage helper tabs are created. Disk snapshots have no
automatic deletion timer; normal cookie expiration still applies. A backend
restart closes pending tabs; a later task restores saved authentication state,
not the old page or a guarantee that source verification remains valid.

Before a headed trial, create the private directory and back up backend.env,
then set THREED66_BROWSER_HEADLESS=false and the profile directory. Build the
backend, run production env:check, test the new image with local-only browser
fixtures and recreate only the backend when Getlink jobs are idle. Do not merge
the independent noVNC archive into production cookies automatically.

For rollback, restore the previous environment (especially headless=true for an
older image without display support), retag the saved prior backend image and
recreate the backend. Leave the private profile volume intact; disabling the
profile directory stops loading it without deleting data. No database migration
or payment change is required.

## Verification and limits

Pending Admin verification sessions emit `THREED66_VERIFICATION_NETWORK` logs
for application-policy blocks, failed requests, HTTP errors and API response
status codes. Logs contain only the internal verification session ID, trusted
host (or `external`), HTTP method, resource type, event kind and safe error/status
code. They never contain paths, queries, headers, cookies, tokens or bodies.
Duplicate events are suppressed, with at most twenty distinct records per
context per minute. Observers detach when the guard is removed or the context
closes. No request allowlist or purchase/download rule is relaxed.

An accepted pointer request or an upstream HTTP 200 does not prove that the
source accepted manual verification. A person must still operate the challenge;
these logs diagnose the transport without inspecting or solving the challenge.

Run `npm run check`. Regression tests cover same-profile serialization,
cross-profile isolation, native context options, source-only snapshots, memory
expiry/capacity, browser recycling, shutdown races and exact manual verification
handoff. Tests mock source requests; they do not purchase or download real models.

This change reduces session inconsistencies. It does not promise CAPTCHA-free
access. The separate preview/format coupling regression is not changed here;
when the format step requires source verification, it still fails closed.

Deploy the backend only after review, production env validation and a low-traffic
window. Do not overwrite or merge production cookies with a noVNC archive while
deploying. A backend restart ends warm contexts and pending verification tabs.
