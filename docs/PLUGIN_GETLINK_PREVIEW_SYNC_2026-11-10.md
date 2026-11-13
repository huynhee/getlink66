# Plugin Getlink Preview Sync

Publication follow-up: the owner subsequently requested publication. This sync
was packaged as LiveTest **1.0.3 build 2 (1.0.3.2)** and published at
`2026-11-10T09:13:29.850Z`, revision 10. The reviewed prepare-route patch was
also deployed to backend. See `docs/PLUGIN_RELEASE_1.0.3_BUILD2_WEB_2026-11-10.md`.
The source-only boundary below records the earlier phase, not current release
availability. Resolver mode remains `rewritten_footprint` unless explicitly
changed in Admin; this publication did not activate Hybrid.

Synchronized plugin source with the web API-first hybrid preview at web base
`0ffd2b5`, on 2026-11-10. This is a local source change, not a VPS deployment or
plugin publication. Both repositories already contained unrelated dirty changes;
those were retained. The public 1.0.3.1 artifacts/feed and version are unchanged.

## Implementation

- Backend adds `/api/plugin/getlink/preview/prepare` under the existing Bearer,
  banned-account, device-risk and shared rate-limit guards. It calls the existing
  full-preview handler and cannot purchase or debit Credit.
- Plugin requests progressive metadata, renders early image/title/choices,
  then prepares the same input. The legacy full-preview path remains available
  for non-hybrid responses and 404/405 compatibility with older plugin routers.
- Unknown prices remain null, not zero/free. Incomplete/unverified responses
  cannot enable purchase; checked empty formats differ from unreadable choices.
- Actual formats are displayed before purchase and the chosen format is sent
  with the confirmed price. Changed price/choices require explicit review;
  a removed selected format requires another selection.
- Superseded requests are cancelled and late responses ignored. Product identity
  must match between stages. A hybrid preview expires for confirmation after two
  minutes; the backend still verifies price and download context when purchasing.
- Preparation errors preserve preview display without preserving authorization.
  Source image URLs are anonymous HTTPS 3D66 URLs only. Verified JPEGs keep using
  the authenticated plugin proxy and existing local download cache.
- Local images decode without holding cache files open. Missing/corrupt images
  and remote image failures show a retry fallback instead of a blank panel.

## Verification

- Final plugin complete suite: 435 passed, 0 failed/skipped, including the
  missing/undecodable local-image fallback and all 4 WPF layout cases.
- Backend targeted preview/plugin tests: 47 passed, including real localhost
  HTTP with real Bearer middleware and mocked upstream calls. No network call
  to 3D66, real database, purchase or balance mutation was performed.
- Full backend serial suite: 982 total, 981 passed, 1 skipped, 0 failed.
- Full ESLint and frontend build/release artifact verification passed.
- Initial parallel `npm run check` stopped on a dev-tooling subprocess timeout;
  its isolated retry passed (3/3), and the subsequent serial full suite passed.
  The timeout was not hidden by changing or weakening the test.
- WPF Getlink layout: 4 cases, English/Vietnamese, 1024-1920 DIPs and 100-200%
  render scales. These are mock metadata/offscreen renders, not real Max,
  upstream image or installed auto-update acceptance.

Evidence:

- `qa-report/getlink-plugin-preview-2026-11-10/npm-check.log` (initial timeout).
- `qa-report/getlink-plugin-preview-2026-11-10/dev-tooling-retry.log`.
- `qa-report/getlink-plugin-preview-2026-11-10/backend-serial.log`.
- `qa-report/getlink-plugin-preview-2026-11-10/frontend-build.log`.
- Plugin `tests/ThreeDiPL.Core.Tests/TestResults/getlink-preview-sync-full-final-2026-11-10.trx`.
- Plugin `artifacts/qa-getlink-preview-2026-11-10` screenshots.

## Deployment Boundary

No credentials, billing rules, quotas, source resolver mode, Google Drive data,
database migrations or release records were changed. Publishing requires a new
reviewed, signed plugin build with a unique internal version and its normal
artifact verification. Do not overwrite the published 1.0.3.1 files. The existing
public plugin does not gain these local source changes until a new build is
packaged and installed/updated.

API details: `docs/PLUGIN_API.md`, Progressive Preview Sync section.
Plugin implementation notes:
`D:\LTinh\plugin\docs\GETLINK_PREVIEW_SYNC_2026-11-10.md`.
