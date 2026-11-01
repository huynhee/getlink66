# Manual Getlink Verification

## Scope

For `rewritten_footprint` resolution, an upstream verification error retains the
actual failed Playwright page and context. It does not launch another browser,
change proxy, solve a CAPTCHA, purchase a model, or retry a charged job.

In Admin, open **Getlink > Cookie > Getlink verification sessions**, then select
**Open session**. If the page initially only shows a verification heading, select
**Reload page**. The same page reloads with the widget resources enabled by a
temporary, restricted request gate. Complete any verification yourself and select
**Verify and save session**.

Completion requires a signed URL for the entire expected `sof`, an actual loaded
model page, and an authenticated upstream account matching the configured account
ID. A signature is never synthesized. The source cookie is updated atomically only
if it has not been replaced or disabled in the meantime. Browser cookies never
leave the backend. The verified context and signed target are retained briefly
for an explicit retry of the failed Getlink request.

## Boundaries

- Admin authentication, allowlist, 2FA, CSRF, exclusive operator leases, rate
  limits and audit logging protect the control API.
- Only human pointer events are relayed. There is no script execution, arbitrary
  URL navigation, cookie export, automated dragging, or challenge solver API.
- A restricted HTTPS request gate admits widget assets while verification is
  pending and remains in place while a verified context is idle. Source-site
  mutations and purchase/download endpoints are blocked outside a normal Getlink
  task's separately validated request scope.
- At most two contexts can be retained. A pending session expires after 15 minutes;
  its operator lease expires after 90 seconds without activity. Closing the dialog
  releases control; **Discard session** closes the context.
- Verified contexts expire after five idle minutes, with a 15-minute lifetime.
  They are reused only for the same account, configuration and model.
- Sessions exist only in process memory. Backend restart closes them; retry the
  original request to generate another session. This implementation assumes the
  existing single backend process. Multiple backend replicas require sticky
  routing for this control API and for retries.
- Failed verification does not authorize a download or modify credits/quota.
  Atlas failures preserve the pending browser for a manual retry until expiry.
- If no interactive challenge is offered, the source session may instead be
  blocked or unauthenticated. This UI cannot guarantee that 3D66 offers a way to
  verify, and must not be used to bypass an access restriction.

## Validation

Automated tests use mocked upstream responses and a local, harmless image fixture.
They cover exact-page retention, signed model matching, unchanged-cookie compare
and swap, ownership/lease expiry, CSRF/2FA, queueing, rate limiting, browser reuse,
and blocked purchase/download requests. Browser smoke covers VI/EN, light/dark,
desktop/mobile and pointer coordinate scaling. A real verification must be done
by the operator after deployment; automated tests never solve a real CAPTCHA.

For a focused rerun of this UI, set `QA_3D66_VERIFICATION_ONLY=true` when running
the existing `qa:smoke` command against a fresh frontend build. Its result identifies
the focused scope rather than claiming the other UI workflows were tested.

No new environment variables or public control ports are required. Deploy both
backend and frontend together after review. The previous temporary noVNC helper
and SSH tunnel are not used by this flow.
