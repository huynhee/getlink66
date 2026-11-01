# Rewritten Footprint Resolution

## Enable

In Admin > Getlink > Tasks, select **Rewrite ID, then read history** and save
Getlink settings. The saved database setting takes priority over the startup env.
New installations can use `THREED66_MODEL_RESOLVE_MODE=rewritten_footprint`.
The existing mode remains unchanged until an admin selects this option.

Use the existing authenticated 3D66 cookie and Playwright installation. The target
account is `THREED66_REQUIRED_ACCOUNT_MARKER` (default `89635771`); do not replace
that guard with a client-supplied value. The cookie must belong to the intended
account. No collection ID or profile AUI is needed.

## Flow

1. Accept a full HTTPS `3d.3d66.com/reshtmla/model/items/.../...html` URL containing
   one `sof`. ID-only inputs and synthetic `/items/id/model.html` pages are rejected.
2. Split `sof` into three letters, **exactly eight sender ID digits**, and the asset
   suffix. Change only the first letter to `A` and the sender ID to the required
   account marker. Keep the remaining letters, suffix, host and case-sensitive path.
3. Remove all original query parameters and fragment. Visit
   `?sof=<rewritten-id>&st2` using the authenticated browser. The literal `&st2`
   is intentional. An empty seed page does not mean resolution succeeded.
4. Read account footprint history. Select only the exact model path and rewritten
   `sof`, with exactly one nonempty `sign` supplied by 3D66. The final history URL
   is kept as supplied (including `st=2` when present); signatures are never generated.
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
