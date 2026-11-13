# Plugin 1.0.2 LiveTest Web Publication

## Scope

The user requested web publication of the tested Max 2022 repair. Use the
existing LiveTest channel; this is not permission to bypass Production gates.
Previously published 1.0.1 artifacts must remain immutable and downloadable.
No application deployment, secret rotation, database migration or payment
operation is needed for this artifact-only publication.

Published on 2026-10-21 at **15:47:29 Asia/Saigon / 08:47:29 UTC**.
Release ID: `6ad87bb854d390587467c6fc`; channel revision: **7**.
Previous release: `6ad0fe9e86baeeaabcc7751b`, revision 6, version 1.0.1.
Minimum client version remains 1.0.0 and bridge protocol remains 2.

Public page: https://3dipl.org/plugin.
Feed: https://3dipl.org/api/plugin/release?manifestVersion=3&channel=live-test.
Public HTTPS verification completed on 2026-10-21 at 08:50:15 UTC.

## Candidate

Directory:
`D:\LTinh\plugin\artifacts\release-1.0.2-livetest-max2022-sdk-2026-10-21-rc2`.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Desktop ZIP | 100959165 | `7d16e63e59104626cf590acd6bad23fda7642adbff505659a5e9e7603d4a0ef3` |
| Max2020-2025 MZP | 101460968 | `5a638e21dd2b73a2773134de187ca87d4932574fcb7f1a8ac93d08429b94e221` |
| Max2026-2027 MZP | 101090668 | `9c244ae9fa776bcfa46f3a50dfb89fccdaf4059692ff796df1b049ea524da140` |

Manifest SHA-256:
`ff57926d2022666f10a13d84e821a8176943a2c9380f48e8082b8a8774c0abc4`.
Independent trusted LiveTest SPKI SHA-256:
`17e3999b7be9e3a59ab2c1c6d44cd453503bd8999e619be9dbcdadf7e06c021a`.
The private signing key stays on the release workstation.

Source baseline: plugin `0945d684f0c5394de8a2f422dd017e2a5b83c837` plus the
preserved worktree changes; package source fingerprint:
`41b94d93ed66b01bf0977511d6cad4250c3e483682bebc5f610e3718268c3ae1`.
Subsequent test-harness corrections did not modify these binary artifacts.
Web baseline: `ec5c355ef5951f8ed015e47e38929c38e6220dcf`; no application
source deployment is required for publication.

## Verification Before Publication

- Exact RC2 signature, archives, compiled pin/policy and all checksums passed
  the independent backend verifier again immediately before upload.
- 25 targeted backend signature/service/transaction/HTTP/ETag tests passed.
  A sandboxed attempt was blocked by temporary-file rename permissions; the
  normal-permission rerun used memory fixtures only and passed all 25.
  Evidence: `qa-report/plugin-release-1.0.2-2026-10-21/release-tests.tap`.
- Complete .NET serial run: 378 passed, none skipped. The initial parallel run
  had four timing/UI failures and is retained rather than hidden.
- Packaged Desktop startup/health smoke passed with isolated data.
- Real 3ds Max 2022 direct-host test passed bootstrap, SDK queries/execute,
  exact version 1.0.2, Unsafe loading, fixture merge, hierarchy, group/flatten,
  Replace Selection, rollback/undo and shutdown. Assembly paths matched RC2.
- No real Corona/V-Ray asset, manual drag/placement or all-version acceptance
  is claimed. MaxBatch still fails Autodesk license checkout; the successful
  test used the ordinary Max executable, without changing licensing/security.

Plugin evidence:
`artifacts/qa-max2022-runtime-2026-10-21/host-retry-results.json` and
`direct-verified-20261021-152301`.
Detailed scope: plugin `docs/MAX2022_SDK_COMPATIBILITY_FIX_2026-10-21.md`.

## Publication Procedure

Before state: active release `6ad0fe9e86baeeaabcc7751b`, revision 6, version
1.0.1. Trusted server pin and database-backed public LiveTest feed were verified.
No 1.0.2 record existed before upload.

Incoming host directory: `/home/ubuntu/3dipl-release-1.0.2-20261021`.
Incoming container directory: `/tmp/3dipl-release-1.0.2-20261021`.
Operator script: `qa-report/plugin-release-1.0.2-2026-10-21/publish-plugin-release.mjs`.
It uses the normal create/chunk/verify/transactional publish services and a
distinct authorized VPS operator audit identity, not a web-user impersonation.
Previous release ID/revision and the independent pin are guarded; any changed
channel or conflicting version causes the operation to stop.

The snapshot and publication receipt were copied to the incoming host directory
as `previous-release.json` and `publish-receipt.json`, outside the container's
temporary filesystem. The local receipt is retained in the release QA directory.
No release volume files were deleted; Production was not enabled.

## Public Verification

- Live feed exactly matched the locally signed manifest and its independently
  pinned ES256 signature.
- `/api/plugin/downloads` advertised version 1.0.2 for both existing Max families.
- All three complete HTTPS downloads matched the local byte lengths and SHA-256
  values above, with attachment headers.
- Each file returned 206 for `bytes=0-31`, the correct Content-Range and bytes
  identical to the local archive.
- Feed revalidation returned 304 for the new ETag; the pre-publication 1.0.1
  ETag returned 200 with version 1.0.2.
- `/plugin` returned HTML 200. All three old 1.0.1 artifact URLs returned 200.
- A final VPS database read confirmed published version 1.0.2, exact release ID
  `6ad87bb854d390587467c6fc` and channel revision 7.

Evidence: `qa-report/plugin-release-1.0.2-2026-10-21/remote-verification.json`,
`before-publication.json`, `publish-receipt.json` and `release-tests.tap`.

## Install And Rollback

The repair includes the in-Max bridge. Users must install the matching MZP,
save their scene, and fully exit/reopen Max; updating Desktop alone cannot
replace an already loaded legacy bridge DLL. Downloaded cache can be retained.

For a deliberate rollback, publish retained 1.0.1 against the latest channel
revision. The scoped operator script's `rollback` mode only acts while this
exact 1.0.2 record is current. This changes the advertised release, not healthy
clients already installed. Never overwrite immutable archives or delete the
release volume. No rollback is performed as part of normal publication.

While this exact release remains current, the scoped rollback command is:

```bash
cd /opt/3dipl/app
sudo docker compose -f compose.production.yml exec -T backend node \
  /tmp/3dipl-release-1.0.2-20261021/publish-plugin-release.mjs rollback
```

The container's temporary import folder may disappear on recreation. Keep the
host snapshot and use Admin to republish the retained 1.0.1 record in that case.
