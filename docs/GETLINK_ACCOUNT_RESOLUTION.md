# Mandatory Getlink Account Validation

## Required Account Marker

Real Getlink downloads require marker `89635771` in the model URL's `sof` ID.
The marker must immediately follow the three-letter prefix, with an asset suffix
of at least five digits. A marker in another query parameter, fragment, title,
or later in the ID does not pass validation.

`THREED66_REQUIRED_ACCOUNT_MARKER` defaults to `89635771` when absent. An explicit
blank, `false`, comment, or malformed value is an error, not a way to disable the
guard. Administrators may configure a different numeric marker of 6-12 digits,
but the intended deployment for this account is:

```dotenv
THREED66_ACCOUNT_ID=177536980
THREED66_ACCOUNT_MARKER=89635771
THREED66_REQUIRED_ACCOUNT_MARKER=89635771
```

Keep comments on separate lines. `THREED66_ACCOUNT_ID` and the optional
`THREED66_ACCOUNT_MARKER` configure account search; the required marker is the
independent download guard. Setting these values does not log in to or switch a
3D66 account. Authentication still comes from the intended account's cookie.

The old numeric parser extracted digits from comment text, including `66` from
`THREED66_ACCOUNT_ID`. It now accepts only numeric configuration before a comment
and treats blank/comment-only optional markers as unset.

## Validation Boundaries

The same guard checks all of the following:

- Resolution from search, footprint history, and direct input.
- Model context and payload before download/pop API requests or browser purchase.
- Browser-generated download requests, including their model IDs and source URL.
- Purchased cache and paid history before reuse, refresh, or streaming.
- Resolved context before Credit debit and history creation.

A model context must be HTTPS on a 3D66 host and model path, with exactly one
`sof`, the required marker, and exactly one nonempty `sign`. Conflicting `id`
values, duplicate parameters, credentials, or nonstandard ports are rejected.
The download payload's ID must equal the validated URL's ID. The existing
asset-family/trailing-ID check also rejects a different apparent asset.

Validation errors use `THREED66_CLEAN_LINK_REQUIRED`. They do not trigger another
cookie, cookie degradation, proxy fallback, automatic job retry, or browser
download fallback. Invalid required-marker configuration is a terminal `503`;
invalid download context is `422`.

This is structural account/context validation, not cryptographic verification of
3D66's signature or proof that an account is unrestricted. The upstream service
must still accept the cookie and signature. Tests use mocks; passing them is not
evidence of a successful live 3D66 transaction.

## Resolution Rules

With marker `89635771`, an incoming ID such as `BCH01077971442400` is looked up as
`BCH89635771442400`. Pasted URLs and typed model IDs use the same normalization.
The original ID remains the logical cache/history identity; a newly resolved URL
supplies the actual upstream ID and signature.

Search tries only normalized account IDs, at most four unique candidates. If it
cannot resolve a clean signed context, it stops. It never retries the original
foreign-account ID, synthesizes an unsigned download URL, or replaces `sof` while
keeping an old signature. A URL returned by 3D66 must pass the guard unchanged.

`footprint` mode may obtain context from account history, but the result must have
the required marker and matching apparent asset. Its search fallback follows the
same strict rules. `direct` mode is not an opt-out: it accepts only an already
clean signed URL. Internal footprint hash flags cannot bypass validation.

Existing records are not rewritten or deleted. A paid cache/history item lacking
a validated `resolvedSourceUrl`, or carrying another account's context, is blocked
for administrator review. The system does not automatically purchase the model
again to repair that record. Its original `sourceUrl` alone is not download proof.

`THREED66_MOCK` only bypasses stored-record validation in local mocked workflows;
production readiness requires it to be `false`.

## VPS Check And Deployment

Print only non-secret resolution settings:

```bash
cd /opt/3dipl/app
sudo docker compose -f compose.production.yml exec -T backend \
  node -e 'console.log({mode:process.env.THREED66_MODEL_RESOLVE_MODE,accountId:process.env.THREED66_ACCOUNT_ID,marker:process.env.THREED66_ACCOUNT_MARKER,requiredMarker:process.env.THREED66_REQUIRED_ACCOUNT_MARKER,searchEnabled:process.env.THREED66_ACCOUNT_SEARCH_ENABLED})'
```

After this code has been reviewed and pushed, update the backend:

```bash
cd /opt/3dipl/app
git pull --ff-only origin main
sudo docker compose -f compose.production.yml build backend </dev/null
sudo docker compose -f compose.production.yml run --rm --no-deps \
  -T --interactive=false -e NODE_ENV=production backend npm run env:check </dev/null
sudo docker compose -f compose.production.yml up -d \
  --no-deps --force-recreate --wait --wait-timeout 180 backend </dev/null
curl -fsS http://127.0.0.1:5000/ready
```

Review `/etc/3dipl/production/backend.env` before recreating the container.
Restarting alone does not reload Compose environment files. Do not change resolve
mode or enable a restricted account merely to test this patch.

If no cookie is configured, fresh requests stop with `503` before resolution.
Only restore a cookie after the intended account is confirmed usable. Never print
cookies, download tokens, or signed file URLs in diagnostic output. A read-only
inspection can confirm structural resolution without purchasing a file; avoid
repeated upstream requests or paid downloads on a restricted account.

## Regression Tests

```bash
node --test backend/test/3d66-clean-link.test.js backend/test/3d66-account-config.test.js backend/test/3d66-account-resolution.test.js backend/test/getlink-clean-cache.test.js backend/test/getlink-job.test.js backend/test/production-readiness.test.js
npm run check
```

Tests cover default/configured markers, missing/duplicate/signature parameters,
wrong payloads and assets, dirty cache/history, no Credit debit, no cookie switch,
terminal retry behavior, and direct/footprint/search resolution. Every upstream
request is mocked; no real 3D66 purchase or payment system is used.
