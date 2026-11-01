# Rewritten Footprint Resolution

## Enable

In Admin > Getlink > Tasks, select **Rewrite ID, then read history** and save
Getlink settings. The saved database setting takes priority over the startup env.
New installations can use `THREED66_MODEL_RESOLVE_MODE=rewritten_footprint`.
The existing mode remains unchanged until an admin selects this option.

Use the existing authenticated 3D66 cookie and Playwright installation. The target
account is configured in **Account ID in link (sof)** in Admin > Getlink > Tasks.
Enter the 6-12 digit marker appearing after the first three letters of `sof`, not
the full model ID. Leading zeroes are preserved. This private admin setting drives
both URL rewriting and the required marker guard, including other resolution modes.
It takes priority over `THREED66_REQUIRED_ACCOUNT_MARKER` after saving and survives
backend restarts. Existing installations inherit that env value (default `89635771`)
without changing the current account.

Change the authenticated 3D66 cookie to the corresponding account too; changing the
marker cannot log in or authorize another account. Save when no 3D66 tasks are
running: old-account links no longer pass the guard after switching. Resolution
caches are isolated by the new marker. No collection ID or profile AUI is needed.

## Cookie Verification

`PHPSESSID` and `login_sign` are required for structural checks. `login_token` is
optional and is forwarded unchanged when present. Structural validity is not
proof of login; client-controlled `userCookieData` and analytics cookies are not
trusted as authentication, and embedded cookie timestamps are not used as expiry
proof.

Admin cookie checks call the fixed, read-only 3D66 endpoint
`https://user.3d66.com/new-user-api/api/v1/user/info`, without following redirects.
Success requires HTTP success, response code 200, a valid server `data.basic.user_id`
and its derived account marker matching the configured clean-link account ID.
Anonymous code 401, login redirects, challenges, malformed responses, network
failures and mismatched accounts never mark the cookie verified. No purchase or
download request is made by this check. The response exposes only verification
status and the account marker, not the rest of the upstream account profile.

## Flow

1. Accept a full HTTPS `3d.3d66.com/reshtmla/model/items/.../...html` URL containing
   one `sof`. ID-only inputs and synthetic `/items/id/model.html` pages are rejected.
2. For tracked IDs, split `sof` into three letters, **exactly eight sender ID digits**,
   and the asset suffix. Short public IDs (5-8 digits) have only the asset suffix.
   Change the first letter to `A` and add the required account marker before the
   entire asset suffix. Keep the remaining letters and original path for the seed.
3. Remove all original query parameters and fragment. Visit
   `?sof=<rewritten-id>&st2` using the authenticated browser. The literal `&st2`
   is intentional. An empty seed page does not mean resolution succeeded.
4. Read account footprint history and match the **entire rewritten `sof`**. The
   account's canonical model path may differ from the submitted path. If the card
   is unsigned, physically click that exact card to trigger the site's signature
   handler. Require the opened URL to keep the selected canonical path, exact `sof`
   and one nonempty `sign` supplied by 3D66. Never match only a trailing substring.
   Purchase/download APIs are blocked while resolving a history card. The final
   signed URL is retained as supplied; signatures are never generated.
5. Only the signed URL can enter preview, format selection or download APIs.
   Original and resolved URLs remain available to the existing admin audit history.

The lookup refreshes history a bounded number of times using the existing
`THREED66_FOOTPRINT_REFRESH_ATTEMPTS` and `THREED66_FOOTPRINT_REFRESH_DELAY_MS`.
Results are cached briefly per cookie, model path and rewritten ID. Concurrent
identical lookups share a browser task. Another cookie never reuses that cache.

## Failure And Rollback

Missing/ambiguous IDs, wrong model paths, login redirects, missing signatures or
history misses stop the operation before a purchase. There is no fallback to the
submitted link, account search or another cookie, and no automatic job retry for
this resolver's failures. Existing credit charging/idempotency rules are unchanged.

Select the previous mode in Admin and save to roll back. No migration, account
history deletion, collection mutation or file rewrite is involved. In-flight work
should finish before switching modes.

Automated tests use local fixtures only. A real-cookie check must be performed
separately with the intended account before relying on this mode in production.
