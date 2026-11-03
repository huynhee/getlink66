# Getlink native browser sessions

The background browser now runs full Chromium (`channel: chromium`, new headless
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
  minutes; snapshots expire after thirty minutes. These snapshots do not survive
  a backend process restart. Database cookies remain unchanged.
- Snapshots read existing frames only. They do not call Playwright storageState()
  or create/focus auxiliary tabs, including in headed/manual environments.
- Failed tasks discard their ordinary context. A real challenge transfers the
  exact context to the existing Admin verification flow and blocks more work for
  that credential until the operator handles it or the verification session
  expires. Payment and account/signature validation rules are unchanged.
- Successful reuse of an operator-verified context also seeds an in-memory
  snapshot for later ordinary tasks with the same credential/configuration key.

## Assets and configuration

The browser loads page images/fonts/media by default. HTTPS resources under
alicdn.com, aliyuncs.com and aliyun.com are allowed for provider widgets, but
these domains are not allowed as top-level browser destinations. Main model
navigation remains restricted to the configured source allowlist.

Use `THREED66_BROWSER_BLOCK_ASSETS=false` to ensure a previous explicit `true`
does not retain the old asset blocking behavior. No new secret is required.
Headless/headed mode still follows `THREED66_BROWSER_HEADLESS`; noVNC display
infrastructure and its separate temporary control session are not changed by
this patch.

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
