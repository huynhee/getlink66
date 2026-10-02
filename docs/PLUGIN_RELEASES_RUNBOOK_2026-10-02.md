# Plugin Update V3: Admin, VPS and Desktop

Status: local implementation and automated verification completed. No release
was uploaded, published or deployed to the VPS. Production remains closed.
This document supersedes the updater gaps in `PLUGIN_UPDATE_HANDOFF_1.0.0_2026-10-01.md`.

The user accepted an unsigned-Authenticode Production option on 2026-10-02.
See section 10 for this exception. It changes the Authenticode requirement only;
the license, integration acceptance, ES256 pin/signature, hashes and rollback
requirements remain in effect. Earlier mandatory-Authenticode statements below
describe the default signed release policy.

## 1. Release Workflow

1. Build both Max families and sign the manifest on the release workstation.
2. In Admin > Website > Plugin releases, create a draft with `release.json` and
   the Desktop ZIP plus both MZPs from the same output directory.
3. Upload, then verify. Uploads use 8 MiB chunks; Pause/Resume preserves received
   chunks. After reloading the page, reselect the same original files to resume.
4. Review channel, version, files and Vietnamese/English notes. Publish only
   after the appropriate channel's acceptance checks pass.
5. The EXE checks manually or every six hours in the background. It verifies
   the pinned signature, downloads and stages the new Desktop package.
6. The user confirms restart. New work is paused, active work is drained, and
   the remaining queue is saved. Cancel resumes normal work.
7. If the connected Bridge is incompatible, install the indicated MZP and
   restart Max manually first. Desktop does not close Max or an unsaved scene.
8. The updater switches the pointer, launches Desktop and validates a local
   health acknowledgement. Launch, I/O or health failure restores the old
   pointer and relaunches the old executable.

No private signing key is accepted by the admin or stored on the VPS.
Changing notes, channel, URLs, protocol, families or checksums requires a new
signed manifest. Verified/published artifacts cannot be overwritten.

## 2. Implemented Boundaries

- Atlas Core collections: `pluginreleases` and `pluginreleasechannels`.
  Unique channel/version index and channel revision CAS prevent duplicate
  identities and concurrent current-pointer updates. Publication/withdrawal
  commit the release status and feed pointer in one Atlas transaction; a failed
  CAS cannot make a losing candidate publicly downloadable. There is no
  non-transactional production fallback.
- File volume: `/var/lib/3dipl/plugin-releases`. Each file is limited to
  512 MiB, each release to 1 GiB. Verification hashes/assembles streams rather
  than loading complete archives into RAM.
- Unfinished uploads expire after 24 hours. Abandoned verification leases are
  recoverable. Published files are retained and must be backed up separately.
  An expired draft cannot resume or verify: Admin offers confirmed deletion and
  recreation with the selected manifest/files retained locally for re-upload.
- Admin routes retain authentication, admin role, session 2FA, CSRF, rate limits
  and audit records. Chunk retry accepts identical bytes only.
- `/plugin` and the home plugin block use `GET /api/plugin/downloads`; a new
  publication needs no frontend rebuild. Installers are selected by Max family.
- V2 signatures/fields remain unchanged. V2 and V3 current pointers coexist.
  V3 requests use `GET /api/plugin/release?manifestVersion=3&channel=<channel>`.
- ETags bind the returned signed content; caches do not confuse contracts or
  channels. Feed responses use `Cache-Control: no-cache`.
- LiveTest, Staging and Production have separate install/data roots, pointers,
  mutexes and activation pipes. Restart arguments contain no account token.
- Before restart, Desktop rechecks every staged file against hashes captured
  from the verified ZIP. Updater receives the integrity snapshot over the
  parent-owned stdin pipe, not editable pending JSON, and rechecks after the
  parent exits. Verified payload files are held read-only through launch.
- Credits, quota, login and existing plugin workflows were not replaced.

## 3. Final Local Artifacts

Baseline, installed once for users of unpinned 1.0.0:

`D:\LTinh\plugin\artifacts\release-1.0.1-livetest-v3-2026-10-02-final`

Upgrade fixture, not a production release:

`D:\LTinh\plugin\artifacts\release-1.0.2-livetest-v3-2026-10-02-final`

| Version | Artifact | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| 1.0.1 | Desktop ZIP | 100943785 | `5f984f8361121e8140bf1e3b6d02f20457a5258cf54081decd11c9033fe898a0` |
| 1.0.1 | Max 2020-2025 MZP | 101442310 | `43f9af6a842e1342025fa4c1c9382ba6f515f07808f891c5b14da5f72e93adfa` |
| 1.0.1 | Max 2026-2027 MZP | 101071329 | `794e8338b2515623aa99db98969b37c54f2a03a87885f6a8e4f2403f66544140` |
| 1.0.2 | Desktop ZIP | 100943862 | `e0087c59d50f8d613b199415c9b75de8a50672b15156507e9f63e163dba64221` |
| 1.0.2 | Max 2020-2025 MZP | 101442405 | `bed25190ba4db764f2dc3537f7ad1aab45962a0b5d91a3f7e4b9129b151ebf95` |
| 1.0.2 | Max 2026-2027 MZP | 101071436 | `bb58a6b3f1256693d7d4e03855c9faa2d082c6d24569c7a58d8c916c6234e15e` |

Each directory contains the three artifacts, `release.json`, detached
`release.sig`, `release.public-key.txt` and `verification-report.json`.
Upload only the manifest and three ZIP/MZP files. The public key goes into
trusted server configuration; the private key stays on the workstation.

Both output directories share source fingerprint
`5b46ece966a861bae7a8c91ace0033419ba97155b4b52da205eb81545293df1b`.
LiveTest SPKI fingerprint:
`17e3999b7be9e3a59ab2c1c6d44cd453503bd8999e619be9dbcdadf7e06c021a`.
Desktop is built once per release and is byte-identical in both family MZPs.
These artifacts lack Authenticode and are not approved for Production.

## 4. Build and Verify

Keep the existing LiveTest key outside Git. Use a separate, access-restricted
P-256 PEM key for Staging and Production. Never reuse a test key in Production.
Do not change source during a release build; the script detects that race.
Always use a new output directory.

```powershell
cd D:\LTinh\plugin
& ./installer/build-release-v3.ps1 -Channel LiveTest `
  -ReleasePrivateKeyPath "$env:LOCALAPPDATA/3DIPL/Signing/live-test-release.pem" `
  -OutputDirectory ./artifacts/<new-baseline-directory> `
  -ReleaseNotesVi '<Vietnamese release notes>' -ReleaseNotesEn '<English release notes>'

# Non-production upgrade fixture; baseline version remains in Directory.Build.props.
& ./installer/build-release-v3.ps1 -Channel LiveTest `
  -ReleasePrivateKeyPath "$env:LOCALAPPDATA/3DIPL/Signing/live-test-release.pem" `
  -OutputDirectory ./artifacts/<new-upgrade-directory> -FixtureVersion 1.0.2

# Build actual Staging artifacts before using the staging deployment below.
& ./installer/build-release-v3.ps1 -Channel Staging `
  -ReleasePrivateKeyPath '<secure-staging-key-path>' `
  -OutputDirectory ./artifacts/<new-staging-directory>
```

Staging builds embed `https://staging.3dipl.org`; the supplied LiveTest builds
embed `https://3dipl.org`. Signed channel/origin combinations cannot be edited
or mixed. Configure the public pin from that exact build.

```powershell
cd D:\LTinh\get-link-3d66
node backend/scripts/verify-plugin-release.js `
  '<release-directory>' '<trusted-release.public-key.txt>' https://3dipl.org
npm run check
npm run qa:plugin-releases --prefix backend -- `
  ../qa-report/plugin-release-dist-v3-final ../qa-report/plugin-update-v3
npm run qa:smoke --prefix backend -- `
  ../qa-report/plugin-release-dist-v3-final `
  ../qa-report/plugin-update-v3/smoke-screenshots `
  ../qa-report/plugin-update-v3/smoke-results.json
```

The artifact verification origin must be `https://staging.3dipl.org` for Staging.
Trust a public pin independently; do not trust a key obtained from an
unverified download. Node and .NET use the same canonicalization fixture in
`docs/contracts/plugin-v3-canonical-fixture.json` and the plugin test fixtures.

## 5. VPS Staging Deployment, Not Executed

First review/commit the changes, prepare isolated staging databases, keys,
OAuth, Drive roots, DNS and TLS as described in `deploy/STAGING_PLUGIN.md`.
Do not point staging at production payments, database or Drive credentials.
The app examples intentionally omit secrets; `env:check` must pass.

```bash
cd /opt/3dipl/app
git status --short
git pull --ff-only origin main
sudo install -d -m 0750 -o 1000 -g 1000 /var/lib/3dipl-staging/plugin-releases
sudoedit /etc/3dipl/staging/backend.env
```

Set these keys exactly once in the staging env, keeping other required settings:

```dotenv
PLUGIN_API_ENABLED=true
PLUGIN_RELEASE_SOURCE=database
PLUGIN_RELEASE_ENABLED=false
PLUGIN_RELEASE_CHANNEL=staging
PLUGIN_PUBLIC_DOWNLOAD_CHANNEL=staging
PLUGIN_RELEASE_STORAGE_DIR=/var/lib/3dipl/plugin-releases
PLUGIN_STAGING_RELEASE_PUBLIC_KEY=<base64-SPKI-from-the-signed-Staging-build>
PLUGIN_PRODUCTION_PUBLISH_APPROVED=false
PUBLIC_BASE_URL=https://staging.3dipl.org
ALLOW_DEV_LOGIN=false
```

The backend runs as UID 1000. The container path is the same for all channels,
but Compose mounts the isolated staging host directory. Do not mount releases
directly in frontend Nginx: backend enforces published-file access.

```bash
sudo docker compose -f compose.staging.yml build backend-staging frontend-staging
sudo docker compose -f compose.staging.yml run --rm --no-deps backend-staging npm run env:check
# Stop here if env:check fails.
sudo docker compose -f compose.staging.yml up -d --no-deps --force-recreate backend-staging frontend-staging
sudo docker compose -f compose.staging.yml ps
curl -fsS http://127.0.0.1:15000/ready
curl -fsS https://staging.3dipl.org/api/plugin/downloads
```

With the feed disabled, downloads returns `available:false` and the release
feed returns `503 PLUGIN_RELEASE_DISABLED`. That is expected. Admin can still
create/upload/verify drafts using database source. Enable
`PLUGIN_RELEASE_ENABLED=true` only after test artifacts, pins and access checks
are ready, then recreate backend and explicitly Publish the selected draft.

```bash
sudo docker compose -f compose.staging.yml run --rm --no-deps backend-staging npm run env:check
sudo docker compose -f compose.staging.yml up -d --no-deps --force-recreate backend-staging
curl -i 'https://staging.3dipl.org/api/plugin/release?manifestVersion=3&channel=staging'
curl -fsS https://staging.3dipl.org/api/plugin/downloads
sudo docker compose -f compose.staging.yml logs --since=10m backend-staging
```

Confirm the advertised installer is HTTPS, downloads fully, matches SHA-256,
and supports Range/resume through the actual reverse proxy. Recheck the feed
using its ETag; after publishing a newer version an old ETag must return 200.
Templates exist, but live DNS/TLS/proxy/Cloudflare behavior has not been tested.

## 6. Controlled Env-to-Database Cutover

- `PLUGIN_RELEASE_SOURCE=env` remains supported for the existing signed V2
  feed/download URL. Its installer advertises Max 2026 only, not unverified 2027.
- To migrate, keep the feed off, select `database`, configure the trusted key,
  create/upload/verify releases, then enable and publish deliberately.
- Database source never falls back to stale env releases. Withdrawing the
  current release clears channel feed pointers, including retained V2/V3 feeds.
- To retain V2 client updates, publish an independently signed V2 draft before
  the V3 publication. Do not fabricate V2 signatures from a V3 document.
- Existing unpinned 1.0.0 clients must install the pinned baseline once. New
  clients cannot learn a new trust key from the feed they are verifying.

## 7. Evidence and Remaining Gates

Verified locally:

- `npm run check`: lint, 298 backend tests, frontend build and artifact scan.
- Full Release .NET suite: 270 tests, including eight real updater-process cases
  for healthy launch/close, crash, timeout, wrong token/PID/version and launch
  failure with rollback. Fixture processes are not the installed Max workflow.
- Node and .NET V3 signature agreement, actual artifact hashes/ZIP structure,
  both family payload equivalence and embedded pin/channel configuration.
- Packaged 1.0.1 and 1.0.2 EXEs: startup exit 0, correct health version, PID and
  nonce in isolated temporary data. No Max SDK loaded into Desktop.
- Browser fixtures: English/Vietnamese, light/dark, 1440/390px; chunk pause/resume,
  verify, publish, withdraw/reselect, correct family link and cancelled admin
  requests on navigation. No page overflow or JavaScript errors.
- General smoke: seven public routes, two viewports, live balance update and
  300 catalog requests at concurrency 20. Local memory-fixture p95 113.91 ms,
  heap growth 804184 bytes; these are not production search benchmarks.

Evidence: `qa-report/plugin-update-v3/browser-results.json`, screenshots,
`smoke-results.json`, `exe-smoke-results.json`; plugin
`tests/ThreeDiPL.Core.Tests/TestResults/plugin-update-v3-final.trx` and artifact
`verification-report.json` files.

Still required before Production:

1. Approved software license and either a valid Authenticode certificate/timestamp
   or the explicit unsigned Production exception in section 10.
2. Installed 1.0.1 -> 1.0.2 acceptance using the actual EXE, real HTTPS feed,
   Desktop-only upgrade, incompatible-Bridge flow, busy queues and real rollback.
3. Real Max acceptance for every advertised year 2020-2027, DPI, multiple Max
   PIDs and unsaved scenes. No Max process was running during this verification;
   all eight real-host versions remain unverified for this release.
4. Reviewed acceptance evidence matching exact source/version/license and both
   families; the production build script enforces these checks.
5. Live staging admin/Atlas upload, concurrent publication and proxy acceptance,
   storage permissions and backups; then explicitly approve production publish.

## 8. Recovery

- Admin Withdraw stops advertising a channel; immutable URLs already issued
  remain available. Select an earlier valid release and Publish to change the
  advertised pointer. This does not remotely downgrade healthy newer clients.
- To ship a repair to already-upgraded clients, publish a higher version with
  corrected code. Local automatic rollback applies only to an unhealthy update.
- For server rollback, use the previous reviewed image tag and preserve Atlas
  records and release files. Never `down -v` or delete the release volume.
- Back up Atlas Core plus verified/published files. Hashes and pointers alone
  cannot reconstruct an installer that users are still entitled to download.
- If a signing key is compromised, stop the feed and follow a reviewed trust-key
  rotation/reinstallation process; never silently replace the pin in a manifest.

## 9. Cache and Catalog Repair: LiveTest 1.0.3

The follow-up Desktop repair fixes local preview file locks, incomplete cache
removal/redownload, filter continuity across Online/Downloaded, and mouse wheel
navigation. No backend billing, Drive metadata or production environment changes
are required for these fixes.

Release notes and acceptance details:
`D:\LTinh\plugin\docs\RELEASE_1.0.3_CACHE_CATALOG_2026-10-02.md`.

Output directory:
`D:\LTinh\plugin\artifacts\release-1.0.3-livetest-cache-catalog-2026-10-02`.

Use the same V3 draft/upload/verify/publish flow from section 1, on LiveTest only.
Upload `release.json`, the Desktop ZIP and both MZPs from that directory together.
Unpinned 1.0.0 clients first need the signed 1.0.1 baseline installer; pinned
1.0.1/1.0.2 clients can test the 1.0.3 Desktop update after explicit publication.
This follow-up does not upload, publish or enable the VPS feed automatically.
Production gates and real-host acceptance requirements above still apply.

Local verification completed for 1.0.3: 281 .NET tests, 49 targeted tests rerun
after restoring the standard build profile, WPF snapshots, backend signature and
archive verification with the baseline 1.0.1 public pin, identical Desktop payload
in both MZPs, and packaged EXE startup/health version 1.0.3 with exit 0. Exact
checksums and remaining manual acceptance are in the release document above.

## 10. Production Without Authenticode

Production uses the existing `compose.production.yml` and
`/etc/3dipl/production/backend.env`. Do not create a staging environment, copy a
staging env over Production, rotate existing account/JWT secrets, or replace
the current MongoDB, Google, Drive, Turnstile or payment configuration.

The accepted exception is explicit `-AllowUnsignedProduction` on BOTH packaging
entry points. Without it, Production still requires Authenticode. This switch:

- Is permitted only for Production manifest V3 without a certificate or
  `-RequireSignature`; conflicting inputs fail.
- Embeds `ThreeDiPLAuthenticodePolicy=manifest-only` in the built runtime
  assembly. The feed, environment and editable runtime JSON cannot opt a
  default client out of its Authenticode requirement.
- Still requires a trusted, independently pinned ES256 release key. Use a
  Production key outside Git; do not reuse the LiveTest/Staging key.
- Does not bypass license approval or the exact-source integration review.
- Records the policy and acceptance in `verification-report.json`. It does not
  claim that Authenticode passed, or automatically approve publication.

Windows SmartScreen can warn and Windows Smart App Control or enterprise policy
can block unsigned executables. No build step disables Windows protections.
The ES256 manifest protects update integrity; it does not establish a trusted
Windows publisher identity.

After the license and integration evidence are reviewed, build on the release
workstation, with the existing version in `Directory.Build.props`:

```powershell
cd D:\LTinh\plugin
& ./installer/build-release-v3.ps1 -Channel Production `
  -AllowUnsignedProduction `
  -ReleasePrivateKeyPath '<secure-production-P256-key-outside-Git>' `
  -IntegrationAcceptancePath '<reviewed-exact-source-acceptance.json>' `
  -OutputDirectory './artifacts/<new-production-directory>' `
  -ReleaseNotesVi '<release notes including the unsigned-Windows notice>' `
  -ReleaseNotesEn '<release notes including the unsigned-Windows notice>'
```

Production `release.json`, the Desktop ZIP and both MZPs must come from this
same build. Do not edit a LiveTest manifest into Production. Existing clients
without the new Production pin/policy must manually install this baseline once.
The updater cannot disable Authenticode or install a new trusted key from a feed.
Later signed releases can be staged by this baseline too; issuing a baseline
that requires Authenticode again restores enforcement for future updates.

On the VPS, first confirm that the reviewed web code has been committed/pushed
and pulled; `Already up to date` alone does not prove that local changes exist
on the remote. Record current image tags and back up the existing production
env before a deliberate cutover. Keep a functioning env-based release feed
unchanged until you are ready to migrate: database source NEVER falls back to
the existing env feed and public downloads will be unavailable until Publish.

For a database cutover with no active feed, edit ONLY these keys in the existing
production env, leaving other production settings intact:

```dotenv
PLUGIN_API_ENABLED=true
PLUGIN_DEPLOYMENT_ENV=production
PLUGIN_RELEASE_SOURCE=database
PLUGIN_RELEASE_ENABLED=false
PLUGIN_RELEASE_CHANNEL=production
PLUGIN_PUBLIC_DOWNLOAD_CHANNEL=production
PLUGIN_RELEASE_STORAGE_DIR=/var/lib/3dipl/plugin-releases
PLUGIN_PRODUCTION_RELEASE_PUBLIC_KEY=<exact-release.public-key.txt-from-Production>
PLUGIN_PRODUCTION_PUBLISH_APPROVED=false
PLUGIN_QA_RISK_SECRET=
```

Keep the existing `PLUGIN_JWT_SECRET`; do not regenerate it if it is already
valid. A public key is not a JWT secret and must not be replaced with a random
string. Version, URL, checksum, notes and signatures come from Admin uploads;
no per-release edits to the env are required.

```bash
cd /opt/3dipl/app
git pull --ff-only origin main
test -f backend/src/services/pluginReleaseService.js || exit 1
sudo install -d -m 0750 -o 1000 -g 1000 /var/lib/3dipl/plugin-releases
sudo docker compose -f compose.production.yml build backend frontend
sudo docker compose -f compose.production.yml run --rm --no-deps backend npm run env:check
```

Stop if the build or env check fails. Only run the following after both pass:

```bash
sudo docker compose -f compose.production.yml up -d --no-deps --force-recreate backend frontend
sudo docker compose -f compose.production.yml ps
curl -fsS http://127.0.0.1:5000/ready
```

For file downloads the host reverse proxy must route `/plugin-releases/` to
backend port 5000 (see `ops/nginx/3dipl.conf`); do not overwrite the live Nginx
configuration wholesale. Verify the reviewed proxy change with `nginx -t`
before reload. Do not recreate MongoDB/Meilisearch or run database migrations
as part of this plugin-only deployment.

Create/upload/verify the Production draft in Admin > Website > Plugin releases.
Only after reviewing its signature, files and acceptance, set
`PLUGIN_RELEASE_ENABLED=true` and `PLUGIN_PRODUCTION_PUBLISH_APPROVED=true`, run
`env:check` again, recreate backend, and explicitly Publish that draft.

```bash
curl -fsS https://3dipl.org/api/plugin/downloads
curl -i 'https://3dipl.org/api/plugin/release?manifestVersion=3&channel=production'
sudo docker compose -f compose.production.yml logs --since=10m backend
```

This section is a deployment procedure, not evidence of a completed VPS
deployment or a published Production binary. Do not set approval flags merely
to silence an error.

Local exception-policy verification: `npm run check` passed (299 backend tests,
lint and frontend artifact verification); the full default .NET suite passed
290 tests; the manifest-only profile passed 27 focused updater/signature tests;
12 PowerShell packaging-policy checks passed. MSBuild deliberately rejected a
missing ES256 pin and an unknown policy. The test pin is not a Production key.

## 11. Follow-up Hardening and Current Evidence

This follow-up changes source, not the already packaged 1.0.1/1.0.2/1.0.3
artifacts listed above. Rebuild a baseline and upgrade fixture from the reviewed
current source before installed-binary acceptance. Their old checksums remain
historical evidence only.

- Packaging now reads the actual embedded Runtime assembly metadata in the
  single-file EXE. Runtime JSON or an unused EXE text overlay cannot substitute
  for the compiled Authenticode policy or trusted ES256 pin. Inspection does
  not execute the EXE. The inspector accepts the supported .NET 8 bundle format
  and fails closed for invalid/unsupported bundles.
- Changes to Desktop, Updater, dependencies, added/deleted files or rollback
  payload are rejected before pointer switching. A second check after the
  parent-exit wait prevents edits during restart preparation. Pending JSON
  cannot replace the integrity snapshot supplied by the running parent.
- The new updater requires `--integrity-stdin`. Previously built clients that
  only pass pending JSON cannot safely supply this handoff. They must manually
  install the rebuilt baseline once; do not advertise this new updater as an
  automatic upgrade for those old binaries. Server V2/V3 feed contracts and
  signatures are unchanged. An installed-binary upgrade test must use two new
  builds that both implement this handoff.
- Admin expiration/410 recovery, pause during CSRF initialization, cache
  invalidation/force-refresh races and the shared hero/page download refresh
  have regression coverage. Expired uploads no longer show 100% or enable
  verification after the backend removes chunks.

Latest completed local verification:

- `npm run check`: lint, 314 backend tests, frontend build and artifact scan.
- Default Release .NET suite: 324 tests, including real isolated updater
  processes for health, rollback and before/during-wait payload tampering.
- Browser release fixtures: all four language/theme/viewport combinations,
  expired cleanup plus upload/verification 410 recovery, cancelled recreation,
  shared download refresh success/loading/error/withdrawal, publish and reselect.
- General smoke: seven routes, two viewports, live balance update, zero external
  failures and 300 requests at concurrency 20. These memory-fixture results are
  not production performance or payment acceptance.
- 12 PowerShell policy checks and parsing of all three packaging scripts.
  Actual existing LiveTest EXE inspection passed; overlay-pin and JSON-policy
  substitutions were rejected on temporary copies, leaving artifacts intact.

Evidence: `qa-report/plugin-release-hardening-2026-10-02/browser-results.json`,
screenshots and `smoke-results.json`; plugin
`tests/ThreeDiPL.Core.Tests/TestResults/plugin-release-hardening-final.trx`.
The manifest-only profile passed 57 focused trust/signature/payload/updater
tests, using the existing LiveTest public pin only;
`plugin-release-hardening-manifest-only.trx` records this separate test profile.
The default required-Authenticode/no-test-pin build was then restored and 49
focused tests passed again (`plugin-release-hardening-default-restored.trx`).
No Production installer, private key, upload, publication,
commit/push or VPS deployment was created by this follow-up.

## 12. First-Release Version Reset and Sign-in Prompt

At the user's request, the plugin source baseline is now **1.0.0**. A new signed
LiveTest V3 build was created from the current worktree, including the updater
hardening from section 11. This is not a Production publication or an automatic
downgrade for the earlier 1.0.1/1.0.2/1.0.3 LiveTest clients.

The new download path checks authentication before enqueueing a remote transfer.
Signed-out Model/Scene/Getlink requests direct the user to Account with a clear
localized sign-in prompt; verified cached content remains usable offline.
Getlink preserves the action error code and never acknowledges a failed save.

Artifacts: `D:\LTinh\plugin\artifacts\release-1.0.0-livetest-first-release-2026-10-02`.
Exact hashes, scope and remaining gates:
`D:\LTinh\plugin\docs\RELEASE_1.0.0_FIRST_RELEASE_2026-10-02.md`.

Local evidence: 338 full .NET tests, 72 post-build regressions, 12 packaging
policy assertions, actual backend artifact/signature verification and packaged
EXE health/UI smoke passed. Signed-out Account was inspected at 1024x768.
There was no backend deployment or live payment/Max-host test in this follow-up.

The Production license is still a draft and only a LiveTest signing key was
available locally. Section 10's unsigned-Windows option is not permission to
reuse that key or fabricate acceptance. Rebuild Production 1.0.0 only with its
own key, approved license and reviewed integration evidence. Existing historical
artifacts, public pins and feeds were not modified.
