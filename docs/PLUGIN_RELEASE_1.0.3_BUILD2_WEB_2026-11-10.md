# LiveTest 1.0.3 Build 2 Publication

## Approved Scope

The owner requested publication of the synchronized Getlink preview feature on
2026-11-10. Friendly version: **1.0.3 build 2**; internal version: **1.0.3.2**.
The existing LiveTest channel and ES256 trust pin are retained. Production is
not enabled, and release signing is not Windows Authenticode signing.

Published through the existing LiveTest service on **2026-11-10 16:13:29
Asia/Saigon** (`2026-11-10T09:13:29.850Z`). Release ID:
`6af2e015b79131f7ebbff665`; channel revision `10`.
Public full-file verification passed at `2026-11-10T09:16:17.478Z`. The original
build 1 files remain immutable.

- Previous release: `6ae56bb4fc934d96a88a77f0`, revision `9`, version `1.0.3.1`.
- Minimum client version `1.0.0`; protocol `2`; signed manifest V3.
- Plugin base commit `0945d684f0c5394de8a2f422dd017e2a5b83c837`, dirty worktree.
- Exact plugin source fingerprint:
  `d959830137a6c75c84ff92577399aa8563b02ececc79ced14e86f99a337c076a`.
- Manifest SHA-256:
  `6d62761e3355d166ce98fff20504ef1e0b699462180f1a1075b9f161e4f5d65c`.
- Existing LiveTest SPKI SHA-256:
  `17e3999b7be9e3a59ab2c1c6d44cd453503bd8999e619be9dbcdadf7e06c021a`.
- Artifacts:
  `D:\LTinh\plugin\artifacts\release-1.0.3.2-livetest-getlink-preview-2026-11-10-rc1`.

## Changes

- Early Getlink image/title/actual choices while preparing price and formats.
- Nullable unknown prices remain unknown, never invented zero/free prices.
- Chosen format and confirmed price are sent when creating the existing job.
- Changed prices/choices require review; removed choices require new selection.
- Cancel/ignore superseded requests; verify product identity between stages.
- Recheck expired hybrid previews; retain display, not readiness, after failure.
- Visible image retry and on-load local decoding without holding cache files open.
- All build 1 UI/account and Max compatibility repairs remain included.

## Artifacts

Page: https://3dipl.org/plugin.
Base URL: `https://3dipl.org/plugin-releases/live-test/1.0.3.2/`.

| Filename | Bytes | SHA-256 |
| --- | ---: | --- |
| `3DiPL-Asset-Manager-Desktop-LiveTest-1.0.3.2.zip` | 100965742 | `776929cdf45122e755af598b0318ae870e3f8af22e4c536cd39976396b2c3af7` |
| `3DiPL-Asset-Manager-Max2020-2025-LiveTest-1.0.3.2.mzp` | 101470251 | `afe95e686f2b5428036935d823aad59a006d4f5ad8df149b414ded42b5093e10` |
| `3DiPL-Asset-Manager-Max2026-2027-LiveTest-1.0.3.2.mzp` | 101099918 | `e1c028e60f1b185c32b29087b5f97328801bd17cf19f3370f3a0a8d4c2d47388` |

## Backend Route Rollout

VPS source base was verified as `0ffd2b53e263670416526a301a4a231303e46ff6`.
Only two added lines in `backend/src/routes/pluginRoutes.js` import and register
the existing full preparation handler at `/api/plugin/getlink/preview/prepare`.
Bearer, ban, risk and shared rate-limit guards remain unchanged. The rollout
helper checks the exact commit, source hash and old running image before applying
the patch. Unrelated existing untracked VPS files are retained.

- Before route SHA-256:
  `13d3c99ef7330637d408b570ec3a16e0488dcbc42baa6d2618d7212feef3bbc1`.
- After route SHA-256 (LF):
  `1a255cd8593d1b6dd4ab52c7a7508cb284119ef0a08e50e2ebca5fbcb635e370`.
- Patch SHA-256:
  `d6042986f80bbd1d73dd347359d35f65111280b2c38b2c412ba5777bda88e077`.
- Old backend image:
  `sha256:4cf816466b07294ed8706d514a6737270adbdacdf973520cf8d1cb366e07f086`.
- Rollback tag: `3dipl-backend:pre-plugin-1.0.3.2-20261110`.
- Rollout uses the existing Dockerfile/locked npm dependencies and only recreates
  backend. Its mutable base tag was resolved again during the normal build;
  package lock, Dockerfile and application dependency versions were not edited.
- The build audit reported 7 existing runtime dependency advisories (3 moderate,
  4 high), not remediated by this scoped preview release. No audit fix/force or
  dependency upgrade was run. This is not a claim of a clean security audit.

Backend deployment completed at `2026-11-10T09:09:53Z`. New image:
`sha256:97abd72812408221a2408a9167dd7474e0c933a6025011684d62f79767f63221`.
Both databases passed readiness, and the unauthenticated preparation probe was
rejected with HTTP 401. The running router registered `prepareGetlinkPreview`.
Production `env:check` passed with 5 pre-existing configuration warnings (disabled
image search, semantic fallback, shadow mode at full rollout and gated Production
release signing). No environment values were changed.
The public resolver mode remains `rewritten_footprint`: it was not switched to
`hybrid`. The client receives full previews in existing modes; early two-stage
metadata is used when hybrid is explicitly selected. Existing source profile,
cookies and settings are retained.

The patch stays visible in
the VPS tracked-file diff; it is not represented as an upstream commit.

## Verification

- Existing synchronized source full plugin suite: 435 passed.
- Build 2 focused Getlink/version/Bridge/updater tests: 96 passed.
- Build 2 final full suite: 435 passed, 0 failed/skipped, serial execution.
- Independent package, SHA-256, ES256 and Desktop payload equivalence checks passed.
- Packaged EXE smoke: actual version 1.0.3.2, 5 tabs, isolated data and valid local
  health PID/nonce; no Autodesk SDK loaded into Desktop.
- Legacy net48 pipe/auth/resolver/install smoke passed in packaging.
- Backend full serial suite: 981 passed, 1 skipped, 0 failed; lint/frontend build
  passed for the source sync. Focused backend release tests: 25 passed.
- No real upstream purchase, live user credit/quota or new Max renderer/installed
  auto-update acceptance is claimed. WPF preview screenshots use mock metadata.
- All three full public HTTPS downloads matched exact bytes/SHA-256, attachment
  filenames and Range 206 with matching first bytes. Feed signature, both Max
  families and version matched the exact local signed manifest.
- `/plugin` returned HTML 200; current ETag returned 304; the build 1 ETag returned
  200 with build 2. All three old build 1 download URLs remain HTTP 200.
- Rollout/publication receipts, prior-release snapshot and server manifest were
  retrieved and verified locally. Final core/marketplace readiness passed, backend
  is healthy, and all SSH/SCP sessions were closed.

Evidence: `qa-report/plugin-release-1.0.3.2-2026-11-10` and plugin
`artifacts/qa-getlink-preview-2026-11-10`.

## Recovery

Operational inputs, original router, backend image receipt, previous feed
snapshot and publication receipt are retained under:
`/home/ubuntu/3dipl-release-1.0.3.2-20261110-getlink-preview`.
Private signing keys never leave the workstation.

For feed rollback, only if this exact candidate is still current at revision 10:

```bash
cd /opt/3dipl/app
sudo docker cp -a /home/ubuntu/3dipl-release-1.0.3.2-20261110-getlink-preview 3dipl-backend:/tmp/
sudo docker compose -f compose.production.yml exec -T backend \
  node /tmp/3dipl-release-1.0.3.2-20261110-getlink-preview/publish-plugin-release.mjs rollback
```

Backend rollback is independent of feed rollback. After reviewing that the source
and image still belong to this rollout, reverse only the exact route patch using
`git apply -R --check` then `git apply -R`, retag the retained rollback image as
`3dipl-backend:local`, and recreate backend only with the existing Compose file.
Stop for review if concurrent changes exist. Do not reset the worktree, delete
volumes, change env/secrets, restore balances, or clear source browser profiles.
The new Desktop can use its tested 404/405 compatibility fallback if that route
is rolled back. Reselecting an older feed does not remotely downgrade clients.

For MZP installation, save the scene, close Desktop and fully restart Max after
installing the correct Max-family package. A compatible Desktop-only UI update
does not replace an already loaded Bridge DLL.
