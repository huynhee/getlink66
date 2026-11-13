# LiveTest 1.0.3 Build 1 Web Publication

## Approved Scope

The owner explicitly approved **1.0.3 build 1**, internal version **1.0.3.1**.
The original published 1.0.3 is immutable and remains available. This is an
artifact-only update on the existing LiveTest channel, not a Production cutover.

Published on **2026-10-31 11:17:19 Asia/Saigon**
(`2026-10-31T04:17:19.948Z`) through the normal database-backed release service.
Release ID: `6ae56bb4fc934d96a88a77f0`; channel revision: `9`.
Final public HTTPS verification passed at `2026-10-31T04:19:33.212Z`.

- Previous release: `6ae5613601a994e51ed448b0`, channel revision `8`, version `1.0.3`.
- Minimum version `1.0.0`; protocol `2`; manifest V3.
- Plugin source base commit: `0945d684f0c5394de8a2f422dd017e2a5b83c837`, dirty worktree.
- Web checkout: `edb88440734bed6a793459ce29709d2351a1f3a3`.
- Exact source fingerprint:
  `b084bba72b93624b5bd34e3f4f91b2e3ebdb6927401d3540c10fb803a6a9fff8`.
- Manifest SHA-256:
  `397074952e0dd2ed6d1f0b985a15caf5a6c3661525bf6f800cf4b5209da9e273`.
- Existing LiveTest SPKI SHA-256:
  `17e3999b7be9e3a59ab2c1c6d44cd453503bd8999e619be9dbcdadf7e06c021a`.
- Local source artifacts:
  `D:\LTinh\plugin\artifacts\release-1.0.3.1-livetest-header-text-2026-10-31-rc1`.

## Included Changes

- Online / Downloaded now sit beside the logo in the brand header for Model,
  Scene and Getlink. The old tab strip and reserved margins are removed.
- Primary buttons use Segoe UI 12 SemiBold with inherited dark foreground,
  improving the small letter e and Vietnamese accents on the mint background.
- Header Credit/daily quota, Account update controls, English/Vietnamese and
  existing download/cache/Max compatibility behavior are retained.
- Friendly Desktop/Account label: `1.0.3 build 1`. Runtime, bridge, client header,
  installer, signatures and updater keep the full internal `1.0.3.1` revision.

## Artifacts

Public page: https://3dipl.org/plugin.
Artifact base: `https://3dipl.org/plugin-releases/live-test/1.0.3.1/`.

| Filename | Bytes | SHA-256 |
| --- | ---: | --- |
| `3DiPL-Asset-Manager-Desktop-LiveTest-1.0.3.1.zip` | 100960021 | `c7f40895621d1af59bfb3821ddb7b473f622bb447882861783bce6e7d81d1db1` |
| `3DiPL-Asset-Manager-Max2020-2025-LiveTest-1.0.3.1.mzp` | 101464521 | `d16d01070b9ca834782516377e8692d8df6db436d8cf07327d69f1fb951d32ff` |
| `3DiPL-Asset-Manager-Max2026-2027-LiveTest-1.0.3.1.mzp` | 101094206 | `429a216c6dd330b17f124cec40db1f8e3e2eb56326363738f9ef6e83694ac2e5` |

## Verification

- Final full plugin suite: 402 passed, 0 failed/skipped, serial execution.
  The focused version suite passed all 12 cases, including build revisions.
- Header/layout and text rendering passed 33 focused tests, English/Vietnamese,
  render scales 100-200%. Offscreen renders do not claim a Windows DPI change.
- Packaged Desktop EXE startup/health passed at actual version `1.0.3.1`, 5 tabs,
  isolated data and no Autodesk SDK loaded.
- Both Max-family payloads, Desktop equivalence, checksums and ES256 signatures
  passed independent verification using the existing separately pinned key.
- Legacy net48 build/pipe/resolver/install smoke passed, without launching a real
  Max host. No new renderer or installed auto-update acceptance is claimed.
- Backend release tests: 25 passed using Node 24.22.2 and memory/mock data.
- Evidence directory: `qa-report/plugin-release-1.0.3.1-2026-10-31`.
- Locked restore passed and post-build source fingerprint matched the report.
- Public full-file HTTPS checks passed for all three artifacts: exact size and
  SHA-256, attachment headers, Range 206 and matching first 32 bytes.
- Feed matched the exact signed local manifest; both advertised Max families
  and version 1.0.3.1 matched. `/plugin` returned HTML 200; new ETag returned
  304 and the old ETag returned 200 with the new version.
- All three original 1.0.3 URLs remain HTTP 200. Final core/marketplace readiness
  passed. LiveTest remains the public channel; Production approval stays unset.
- Snapshot, server manifest and receipt were retrieved and verified locally;
  SSH/SCP sessions were closed. Both web/VPS checkouts remained `edb8844`.

No env/secrets, Production approval, billing, balances, quota, Drive metadata,
database migration or application deployment is included in this operation.
ES256 release signing is not Windows Authenticode signing.

## Recovery

The guarded helper only accepts the exact signed manifest above and revision-8
CAS from the previous release. Private signing keys stay on the workstation.
The pre-publication snapshot and receipt are retained under
`/home/ubuntu/3dipl-release-1.0.3.1-20261031-header-text`.

After publication, rollback is allowed only while this exact candidate remains
current at revision 9. Restore the helper directory after container recreation,
then reselect the previous release through the normal transactional service:

```bash
cd /opt/3dipl/app
sudo docker cp -a /home/ubuntu/3dipl-release-1.0.3.1-20261031-header-text 3dipl-backend:/tmp/
sudo docker compose -f compose.production.yml exec -T backend \
  node /tmp/3dipl-release-1.0.3.1-20261031-header-text/publish-plugin-release.mjs rollback
```

Do not delete old artifacts or release volumes. Reselecting a feed does not
remotely downgrade clients. For a manual MZP installation, save the scene, close
Desktop and fully restart Max to unload the previous bridge.
