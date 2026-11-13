# LiveTest 1.0.3 Web Publication

## Publication

The owner explicitly requested publication of the rebuilt 1.0.3 UI/account
candidate. It was published through the existing database-backed LiveTest
channel on **2026-10-31 10:32:35 Asia/Saigon**
(`2026-10-31T03:32:35.660Z`). Production was not enabled.

- Release ID: `6ae5613601a994e51ed448b0`; channel revision: `8`.
- Previous release ID: `6ad87bb854d390587467c6fc`, revision `7`, version `1.0.2`.
- Version: `1.0.3`; minimum version: `1.0.0`; protocol: `2`.
- Candidate directory:
  `D:\LTinh\plugin\artifacts\release-1.0.3-livetest-ui-account-2026-10-31-rc1`.
- Source fingerprint:
  `5a40539e4ec75124e4558870b0f11a2232f72131677522d963d4ef42111160b5`.
- Manifest SHA-256:
  `7b1b991831d95b60aadad70745f870a508e62d6aaa9c7b000d424290fc9baa3e`.
- Existing LiveTest SPKI SHA-256 remains
  `17e3999b7be9e3a59ab2c1c6d44cd453503bd8999e619be9dbcdadf7e06c021a`.

The previous October 22 local 1.0.3 and the superseded local 1.0.4 candidate
were not used. The helper rejects any manifest bytes except the exact candidate
above, checks the trust pin, and uses a revision-7 CAS to avoid replacing a
concurrent publication.

## Included Changes

- Quieter mint primary colors with readable dark button labels.
- Header Credit balance and remaining daily quota replace the static ONLINE badge.
- The header summary opens Account and follows account refresh/logout changes.
- Version/build and update controls are in Account; the separate About page and
  navigation entry are removed.
- Existing download, billing, cache and Max compatibility fixes are retained.

## Public Downloads

Page: https://3dipl.org/plugin.
API: https://3dipl.org/api/plugin/downloads.
Feed: https://3dipl.org/api/plugin/release?manifestVersion=3&channel=live-test.

Artifact base: `https://3dipl.org/plugin-releases/live-test/1.0.3/`.

| Filename | Bytes | SHA-256 |
| --- | ---: | --- |
| `3DiPL-Asset-Manager-Desktop-LiveTest-1.0.3.zip` | 100959686 | `505ea9b0e02177a41a4063b1858e9eaeba7f9fe852693ee7d30e2a71820fb65c` |
| `3DiPL-Asset-Manager-Max2020-2025-LiveTest-1.0.3.mzp` | 101464025 | `1e8e46d62136c9cbb949e34a333854b226b647adc4ff6320fbcbdc6d07b7b018` |
| `3DiPL-Asset-Manager-Max2026-2027-LiveTest-1.0.3.mzp` | 101093718 | `cb07828579b30a460083fc3affdec93d04bf9b114c04f3d13f01fbda5ba1e1d0` |

Users with an earlier local 1.0.3 test build must manually install this new MZP;
the updater does not offer a same-version rebuild. Close the plugin and save /
fully restart Max after installation. A Desktop-only restart cannot unload an
old bridge DLL.

## Evidence and Scope

- Corrected 1.0.3 full .NET suite: 388 passed, 0 failed/skipped.
- Packaged EXE smoke: version 1.0.3, 5 tabs, valid isolated health PID/nonce;
  no Autodesk SDK loaded into Desktop.
- Independent artifact, archive, checksum and ES256 verification passed before upload.
- Targeted backend release tests: 25 passed on Node `24.22.2`, with memory/mock data.
- VPS `prepare` used normal create/chunk/verify services; only an exact verified
  candidate could be published. Audit actor: `authorized-vps-operator:ubuntu`.
- HTTPS checks and their final result are recorded separately in
  `qa-report/plugin-release-1.0.3-2026-10-31/remote-verification.json`.
- Public verification completed at `2026-10-31T03:43:04.430Z`: all three full
  downloads matched size/SHA-256; Range returned 206 with matching bytes; the
  feed signature and both advertised Max families matched the exact local build.
  `/plugin` returned HTML 200, the new ETag returned 304, and the previous ETag
  returned 200 with 1.0.3. All three old 1.0.2 URLs remained HTTP 200.
- Final VPS readiness: core and marketplace ready. The public channel remains
  `live-test`; Production publish approval is unset. SSH/SCP sessions were closed.

This operation changed release records/artifacts only. It did not edit env,
secrets, production approval, Google Drive metadata, payments, balances or quota,
run database migrations, or deploy application source.

A concurrent application deployment was observed: VPS checkout was `1efac52`
during initial preflight and `edb8844` afterward. Local web checkout was
`edb8844`. This operation did not initiate or revert that deployment; backend
health/readiness was rechecked afterward and both databases were ready.

The plugin source remains a dirty worktree at base commit
`0945d684f0c5394de8a2f422dd017e2a5b83c837`; use the exact source fingerprint and
immutable artifacts above, not the base commit alone. ES256 signatures are not
Windows Authenticode. No new real-Max host/renderer or installed auto-update
acceptance is claimed by this UI publication.

## Recovery

VPS snapshot and receipt:
`/home/ubuntu/3dipl-release-1.0.3-20261031-ui/previous-release.json` and
`publish-receipt.json`. Private signing keys were never uploaded.

If this exact release is still current at revision 8, the reviewed helper can
reselect 1.0.2 using the normal transactional service. If the channel changed,
the helper stops and requires a fresh review. After container recreation,
restore the operational helper/input directory from the retained host copy:

```bash
cd /opt/3dipl/app
sudo docker cp -a /home/ubuntu/3dipl-release-1.0.3-20261031-ui 3dipl-backend:/tmp/
sudo docker compose -f compose.production.yml exec -T backend \
  node /tmp/3dipl-release-1.0.3-20261031-ui/publish-plugin-release.mjs rollback
```

Do not delete release files or volumes. Reselecting the prior feed does not
remotely downgrade healthy clients that already installed 1.0.3.
