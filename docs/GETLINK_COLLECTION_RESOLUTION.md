# Getlink Collection Resolution

## Enable The Mode

Collection resolution is an opt-in alternative to `search`, `footprint` and
`direct`. It applies to both preview and download resolution; existing payment,
Credit, cached-purchase and download APIs are unchanged.

After deploying backend and frontend, open **Admin -> Getlink -> Tasks ->
Resolve via collection** (Vietnamese: **Lam sach qua bo suu tap**). Enter the
collection ID and public profile AUI, then save Getlink settings. Both fields
are required before this mode can be enabled. Settings are stored in Atlas Core
and applied at runtime without another container restart. An existing saved
admin choice takes precedence over the environment, including an explicit
choice to switch back to another mode. Collection details are only returned to
verified admins; public settings expose the input mode, not the collection IDs.

For this account, use collection ID `25575806` and AUI `ACJ08966155`. The required
account marker remains server-side in `THREED66_REQUIRED_ACCOUNT_MARKER`; admin
cannot disable the mandatory clean-link guard.

Environment configuration below seeds new/missing settings, not an override of
an existing admin choice. Configure `/etc/3dipl/production/backend.env` only
after deploying this code:

```dotenv
THREED66_MODEL_RESOLVE_MODE=collection
THREED66_COLLECTION_ID=25575806
THREED66_COLLECTION_USER=ACJ08966155
THREED66_REQUIRED_ACCOUNT_MARKER=89635771
THREED66_COLLECTION_REFRESH_ATTEMPTS=3
THREED66_COLLECTION_REFRESH_DELAY_MS=1500
THREED66_COLLECTION_MAX_PAGES=5
```

Keep the intended account's existing cookie. The collection ID and public AUI
identify its favorites folder/profile; they do not log in or switch accounts.
`env:check` rejects missing or malformed collection configuration in this mode.
The supplied URL must be a real HTTPS `3d.3d66.com/reshtml*/model/items/...html`
page, not a synthetic model-ID lookup URL or a different resource family.

## Resolution And Safety

1. Visit the submitted model and check the collection button's `data-sof`
   against the requested model identity before changing favorites.
2. Open `.collect-btn.details-gallery-favorites` and select only the configured
   `li[data-id][data-type="1"]`. Already-saved (`active` / `已收藏`) entries
   are not clicked again, so retries do not remove favorites.
3. Allow the save request to settle, then visit the configured public profile
   and collection detail page. If the profile has not rendered a collection
   link, use the exact configured detail URL, never another user's folder.
4. Read `a.box-images[href]` entries. Require the exact same model origin/path,
   matching model identity, exactly one account-scoped `sof` with the required
   marker, and exactly one nonempty `sign`. Return the upstream href unchanged.
5. Retry collection reads up to the configured bound. Follow only visible next
   links pointing to the same collection/AUI/resource type, with page/cycle
   bounds. Do not take the first unrelated card when the model is absent.

The operation saves a favorite but never clicks a purchase/download button.
Favorites remain saved after resolution. Per-collection serialization avoids
simultaneous mutations. A short in-memory cache is scoped by collection, public
user, required marker, exact model page and cookie fingerprint; it does not
share results between cookie accounts. Cached URLs are revalidated before use.

Collection failures use `THREED66_COLLECTION_RESOLUTION_FAILED` and are terminal:
no search/footprint fallback, cookie rotation/degradation, automatic job retry,
or whole-operation proxy retry after a possible save. Existing mandatory
`THREED66_CLEAN_LINK_REQUIRED` errors remain terminal as well. Resolution must
finish successfully before the existing payment path may proceed.

The guard checks structural identity and account context, not the cryptographic
validity of 3D66's own `sign`. Only the upstream site can accept that signature.
Old purchased records are still subject to the existing clean-link cache guard;
this mode does not rewrite history or automatically repurchase dirty records.

## Deployment And Verification

After review and push, rebuild/recreate the backend and run the production env
check. A plain `docker compose restart` does not reload `backend.env`.
The admin selector requires both backend and frontend deployment. No reviewed
database migration is needed; missing collection fields inherit their startup
environment defaults once, while existing admin values are preserved.

```bash
cd /opt/3dipl/app
git pull --ff-only origin main
sudo docker compose -f compose.production.yml build backend frontend </dev/null
sudo docker compose -f compose.production.yml run --rm --no-deps \
  -T --interactive=false -e NODE_ENV=production backend npm run env:check </dev/null
sudo docker compose -f compose.production.yml up -d --no-deps \
  --force-recreate --wait --wait-timeout 180 backend frontend </dev/null
curl -fsS http://127.0.0.1:5000/ready
```

Automated regression tests use mock data and never real cookies, payments or
3D66 purchases. Before enabling for users, verify one real model on an approved,
usable account: the exact folder contains that model, its returned link has the
expected marker/signature, and an already-saved model remains saved on repeat.
Do not test repeatedly on a restricted account or log cookies/signed URLs.

Rollback by selecting `search` (or the previously reviewed mode) in admin and
saving. Environment edits alone do not replace a persisted admin choice. Saved
favorites are deliberately retained; rollback does not modify purchases or
user Credit.
