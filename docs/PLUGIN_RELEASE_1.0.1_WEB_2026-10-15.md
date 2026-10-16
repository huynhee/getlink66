# Plugin 1.0.1 LiveTest Web Publication

## Published State

The user explicitly requested republication of the bridge merge repair.
The existing public channel is LiveTest, not Production. Version 1.0.0 was
already published, so the repair was built as 1.0.1 without overwriting old
artifacts or changing the trusted signing key.

- Published: 2026-10-15 23:26:34 Asia/Saigon / 16:26:34 UTC.
- Rechecked: 2026-10-16; public feed and both installers still report 1.0.1.
- New release: `6ad0fe9e86baeeaabcc7751b`; LiveTest channel revision 6.
- Previous release: `6ac015e6eef6cb2b6a153c8f`; previous channel revision 5.
- Minimum client version remains 1.0.0; bridge protocol remains 2.
- Public page: https://3dipl.org/plugin.
- Feed: https://3dipl.org/api/plugin/release?manifestVersion=3&channel=live-test.

The existing release services performed chunk upload, verification and Atlas
transaction/CAS publication. VPS operations were audited as an authorized VPS
operator, not an impersonated web account. The old release remains available.
No application image, environment, secret, billing, Drive file or user balance
was modified. Production remains disabled.

## Build and Artifacts

Source baseline: plugin commit `0945d684f0c5394de8a2f422dd017e2a5b83c837`
plus the current worktree, including the bridge repair and version change.
Output: `D:\LTinh\plugin\artifacts\release-1.0.1-livetest-bridge-merge-web-2026-10-15`.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `3DiPL-Asset-Manager-Desktop-LiveTest-1.0.1.zip` | 100959120 | `d4f3e23e9dd9f0d116e9fb4129e817bfc50c1822c7eccfde9a8e4fbf992022f6` |
| `3DiPL-Asset-Manager-Max2020-2025-LiveTest-1.0.1.mzp` | 101460525 | `7a2a5685d40988bce83524a91a8df4c162d664730e5e2507a6c669e9d28f4e4c` |
| `3DiPL-Asset-Manager-Max2026-2027-LiveTest-1.0.1.mzp` | 101089811 | `9ddb313b2b988df149ee470e571c68248cc83044a45d57579ce269e522d35ba7` |

URLs use `https://3dipl.org/plugin-releases/live-test/1.0.1/` plus the filenames.

- Source fingerprint: `4699b5138311a1261a6c457fe52ca03c48721389235d81f204e5955fc3f8a877`.
- Manifest SHA-256: `d8589f7064f915bd908e8a306f62877260b2672dc451897467e863f254e3ea86`.
- Independent public SPKI SHA-256: `17e3999b7be9e3a59ab2c1c6d44cd453503bd8999e619be9dbcdadf7e06c021a`.
- Desktop payloads are equivalent in both MZPs. The private key stayed local.

## Verification

- 373 full .NET tests passed at version 1.0.1, zero failed/skipped.
  Plugin TRX: `bridge-merge-web-1.0.1-2026-10-15.trx`.
- net48 pipe checks passed during packaging: sequential/concurrent connections,
  error responses, authentication/replay rejection and disconnected clients.
- Node verifier confirmed the V3 ES256 signature against the independently
  retained LiveTest pin, all hashes, archive structure and compiled trust.
- Packaged EXE startup passed with isolated data, version 1.0.1 and valid local
  health nonce/PID. No real Max host was used.
- Public HTTPS: all three complete downloads matched the local hashes and sizes.
  Range requests returned 206, correct Content-Range and identical first bytes.
- Feed signature matched the local manifest; downloads API advertised both
  families. `/plugin` returned HTML 200; ETag revalidation returned 304.
- The old ETag returned 200 with 1.0.1. All three previous URLs returned 200.

Evidence: `qa-report/plugin-release-1.0.1-2026-10-15/remote-verification.json`,
`before-publication.json`, and plugin
`artifacts/qa-bridge-merge-web-1.0.1-2026-10-15/exe-smoke-results.json`.

## Reinstall and Recovery

Download the MZP for the user's Max family, close Desktop, install it, save the
current scene, and fully exit/reopen Max. Keep the downloaded cache. Desktop-only
updating does not replace an already loaded in-Max bridge. This publication does
not assert an installed automatic-update or real-user-model merge acceptance.

Rollback snapshot was saved before mutation in the container import directory
and copied to `/home/ubuntu/3dipl-release-1.0.1-20261015/previous-release.json`.
Published payloads remain in the existing release volume. Incoming upload files
were retained for recovery; they are not the public serving location.

For a deliberate rollback, Admin may publish the retained 1.0.0 release against
the latest channel revision. This changes the feed, not installed healthy clients.
The narrowly scoped operator script also supports rollback only while this exact
1.0.1 record remains current:

```bash
cd /opt/3dipl/app
sudo docker compose -f compose.production.yml exec -T backend node \
  /tmp/3dipl-release-1.0.1-20261015/publish-plugin-release.mjs rollback
```

The container's `/tmp` import directory may disappear if the container is
recreated; retain the host snapshot and use Admin in that case. Do not modify
immutable artifacts or delete the release volume. No rollback was performed.

## Remaining Limits

This is the existing LiveTest publication, not Production approval. Authenticode,
approved license and real Max acceptance remain unverified. Public HTTPS integrity
verification now passed; that does not prove real asset/renderer compatibility or
automatic installed updater acceptance. Production gates were not bypassed.
