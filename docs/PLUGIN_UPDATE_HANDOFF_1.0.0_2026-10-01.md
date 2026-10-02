# Ban giao: hoan thien cap nhat plugin 3DiPL 1.0.0

Bat dau: 2026-09-30. Hoan tat ra soat: 2026-10-01, Asia/Saigon. Tai lieu nay dung de giao cho chat khac hoan thien updater Desktop, feed backend va quy trinh phat hanh VPS. Day KHONG phai xac nhan da phat hanh Production.

## 1. Pham vi va trang thai that

- Nhu cau: user cap nhat ngay trong plugin, thay vi moi lan tai MZP va cai lai thu cong.
- Plugin la Desktop EXE rieng ket noi Max qua Bridge. Giu kien truc nay.
- Ban hien tai: **1.0.0**, tieng Anh mac dinh, van ho tro tieng Viet da luu.
- Hai bo cai LiveTest: Max 2020-2025 va Max 2026-2027. Khong dong nghia da acceptance Production tren tat ca cac Max nay.
- User da xac nhan **chua co chung thu Authenticode va chua co khoa release ES256**. Thoa thuan license van la draft.
- Updater da co code download, verify, staging, doi current pointer, health acknowledgment va rollback. Khong can viet lai tu dau, nhung van con cac loi ben duoi.
- Thong bao trong anh: "The update channel is not open yet" / "Kenh cap nhat chua duoc mo". Backend tra `503 PLUGIN_RELEASE_DISABLED` khi feed chua bat.
- Chat truoc CHUA sua cac loi updater. Chi moi sua thanh ket noi Max, ten scene, tai song song va bo Ghim.
- Lan ban giao nay chi doc source local va tao tai lieu. **Khong SSH, khong kiem tra live env VPS, khong bat feed, khong upload artifact, khong giao dich that.**

## 2. Workspace va ban build can giu

| Thanh phan | Duong dan / thong tin |
| --- | --- |
| Web/backend | `D:\LTinh\get-link-3d66` |
| Plugin | `D:\LTinh\plugin` |
| Base HEAD web/backend | `42771c10f8af758ea394d3f1d7e0bdf8f2798ae6` |
| Base HEAD plugin | `c8c4d95b8a9f177b7021e76c80713f63866b4f9f` |
| VPS app (user cung cap) | `/opt/3dipl/app` |
| VPS Production env | `/etc/3dipl/production/backend.env` |
| Compose Production | `compose.production.yml` |
| Compose Staging | `compose.staging.yml` |
| API Production | `https://3dipl.org` |
| Staging du kien | `https://staging.3dipl.org`, chua xac nhan live |

Ca hai repo dang co thay doi chua commit. Doc `git status --short` va diff truoc khi sua. Khong `reset`, `checkout --`, clean hoac ghi de thay doi cu. Web co thay doi lien quan Drive sync, staging va History; plugin co nhieu thay doi da hoan thanh. HEAD khong dai dien day du cho source artifact hien tai.

Thu muc artifact moi nhat:

`D:\LTinh\plugin\artifacts\release-1.0.0-compact-connection-2026-09-30`

| Artifact | SHA-256 |
| --- | --- |
| `3DiPL-Asset-Manager-Max2020-2025-LiveTest-1.0.0.mzp` | `f27819b49bec6b92cf629a56ebfa23e66a8bd233b7dc914dfeedd6e92f64733c` |
| `3DiPL-Asset-Manager-Max2026-2027-LiveTest-1.0.0.mzp` | `03be1ee54a361a246ac7984bf3171abd08f339f037c5f583d660cc4d5e6f12a5` |
| `3DiPL-Asset-Manager-Desktop-LiveTest-1.0.0.zip` | `acb9b219d5ea5a4ef0f2a8bbdd67099a12a52883696122a550a727abc74376dd` |

Desktop fingerprint modern: `b55ed3d848941b892ce53312d81c51274d6ca81afffcc51cf81ae92f2780baee`.
Desktop fingerprint legacy: `67263e5f6e8ba188ec42ac81bcf1b5cba5d60f088150f891d6fffa5441968fd4`.

Bang chung: 256 .NET tests pass, 30/28 payload checksums dung, ca hai extracted EXE smoke exit 0, locked restore va diff check pass. Day la baseline hoi quy, **khong phai test auto-update E2E**. Chi co acceptance Max that moi du de khang dinh update/rollback hoat dong trong host.

Giu cac tinh nang da sua: default English, ten scene trong thanh ket noi, cum picker/Focus ben trai, 3 pipeline download song song, payment prompt khong doi tai xong, bo Pin/Ghim, cache/account cua user.

## 3. Luong cap nhat hien co

1. Desktop doc `GET /api/plugin/release` qua `PluginReleaseClient`.
2. Manifest V2 cung cap Desktop ZIP va Max Bridge artifact, co ES256 signature cho manifest va tung component.
3. Client xac minh bang public key pin trong assembly, kiem tra channel/version va protocol.
4. `DesktopUpdateService` so sanh version; chi nhan ban cao hon version dang chay. Khac fingerprint nhung van 1.0.0 KHONG tao update.
5. Tu dong check khoang 6 gio; neu co ban moi thi tai va stage o local. Nguoi dung bam de apply/restart.
6. Kiem tra SHA-256, archive/payload va Authenticode khi Production; stage duoi `versions/<version>`.
7. Apply ghi pending + health token, mo `ThreeDiPL.Updater.exe`, Desktop cu shutdown.
8. Updater doi Desktop cu thoat, doi `current.json`, mo Desktop moi va doi health ack 30 giay.
9. Neu health check fail: khoi phuc pointer, mo Desktop cu. Giu ban moi va ban cu khi cleanup.
10. Bridge da load trong Max khong the thay bang cach restart Desktop. Khi can Bridge moi phai cai MZP dung family va restart Max, khong tu dong dong canh user.

## 4. Source map

Paths plugin tinh tu `D:\LTinh\plugin`:

| File | Vai tro |
| --- | --- |
| `src/ThreeDiPL.Runtime/Updates/DesktopUpdateService.cs` | Check/download/stage/apply, root theo channel, result reader, periodic loop |
| `src/ThreeDiPL.Runtime/Updates/DesktopUpdateContracts.cs` | State, plan, pending-related contract, service interface |
| `src/ThreeDiPL.Updater/Program.cs` | Doi process, pointer swap, launch, health, rollback, cleanup |
| `src/ThreeDiPL.Desktop/DesktopHostService.cs` | Mapping state sang UI, nut update, handling Bridge |
| `src/ThreeDiPL.Desktop/App.xaml.cs` | Khoi tao updater, startup args, health ack, Max selection |
| `src/ThreeDiPL.Desktop/DesktopRuntimeConfiguration.cs` | Channel/config/data profile |
| `src/ThreeDiPL.UI/ViewModels/AssetManagerViewModel.cs` | Check/update commands, labels, status, observer |
| `src/ThreeDiPL.UI/Controls/AssetManagerShell.xaml` | About/update UI |
| `src/ThreeDiPL.Core/Online/PluginReleaseClient.cs` | Feed, ETag cache, version comparison |
| `src/ThreeDiPL.Core/Online/ThreeDiPLApiContracts.cs` | Manifest/component DTO |
| `src/ThreeDiPL.Runtime/Security/EcdsaPluginReleaseManifestVerifier.cs` | ES256 verifier va assembly public-key pin |
| `src/ThreeDiPL.Runtime/ThreeDiPLDesktopRuntime.cs` | Missing-key fail-closed verifier |
| `installer/install.ms` | Desktop install root, current pointer, Max integration, uninstall |
| `installer/build-package.ps1` | Version, fingerprints, signing, family gates, MZP/ZIP/manifest |
| `tools/ThreeDiPL.ReleaseSigner/Program.cs` | P-256 key, canonical signing, SPKI public key |
| `Directory.Build.props` | Version source of truth 1.0.0 |
| `tests/ThreeDiPL.Core.Tests/Runtime/DesktopUpdateServiceTests.cs` | Updater unit fixtures |
| `tests/ThreeDiPL.Core.Tests/Online/PluginReleaseSignatureTests.cs` | Signature fixtures |

Paths web tinh tu `D:\LTinh\get-link-3d66`:

| File | Vai tro |
| --- | --- |
| `backend/src/controllers/pluginAuthController.js` | `releaseManifest`, feed gate, V2 components, ETag |
| `backend/src/utils/pluginReleaseManifest.js` | Canonical JSON + signature verification |
| `backend/src/config/productionReadiness.js` | Release env validation |
| `backend/scripts/env-check.js` | Lenh env check |
| `backend/.env.example` | Ten bien release |
| `backend/.env.staging.example` | Template staging; dang co thay doi can giu |
| `backend/src/utils/operationalErrors.js` | Expected 503 khong coi nhu server failure |
| `backend/server.js` | Error handler/notification; dang co thay doi can giu |
| `backend/test/plugin-release-signature.test.js` | Cross-runtime signature tests |
| `backend/test/plugin-release-etag.test.js` | Feed cache tests |
| `backend/test/operational-errors.test.js` | Expected-disabled alert handling |
| `docs/PLUGIN_API.md` | API contract, muc 10-11 release/env |
| `deploy/STAGING_PLUGIN.md` | Staging runbook; doc cu co version RC, can doi chieu |

## 5. Cac loi/xu ly con thieu da thay trong source

Day la ket qua doc source, khong gan nhan tat ca da tai hien runtime.

### P0: sua truoc khi cho user bam update

1. **Sai root LiveTest.** `GetDefaultDesktopRoot()` trong Runtime chi tach `staging`, con lai ve Production root. Installer co root `AssetManager/live-test`. Sua de installer, runtime, pointer, updater va profile dong bo; khong ghi de Production tu LiveTest.
2. **Bridge khong tuong thich van apply Desktop.** `DesktopHostService.OpenUpdatePageAsync()` mo link MZP khi `!BridgeCompatible`, sau do van goi `ApplyAsync`. Can state/flow doi cai Bridge va restart Max; khong apply sang trang thai host khong tuong thich. Khong chi mo URL roi coi la cai xong.
3. **Rollback chua bao phu moi exception.** Updater generic catch ghi `Failed`; sau pointer swap neu launch/IO throw thi khong thay flow khoi phuc pointer nhu health-timeout branch. Can test va dam bao restore/run previous trong cac failure branch co the recover.
4. **Hai family chua co signed feed hoan chinh.** Build script chan Production khi `MaxFamily != 2026` va chan signed preview feed cho `2020-2025`/`2026-2027`. Backend van `maxVersions: ["2026"]`, component `maxBridge2026Artifact`. Day la gate co chu dich, KHONG xoa throw de vuot qua. Hoan thien contract/selection/acceptance cho legacy va 2027 truoc; giu tuong thich client cu.
5. **Bootstrap public-key pin.** Build LiveTest da tao khong truyen ES256 key, nen `GetPinnedPublicKey()` rong; verifier tra `RELEASE_PUBLIC_KEY_MISSING` neu feed duoc bat. Chi doi env VPS khong sua duoc binary da cai. Can ke hoach cai MZP ban nen co pin, roi moi test update sang version cao hon. Khong lay trust key tu feed chua xac minh.

### P1: hoan thien UX va restart

6. **Success bi an.** `DesktopHostService.ToNotice()` tra null khi `Succeeded`. Can UI "Updated to <version>" voi version/build moi, co dismiss; khong de update button active nhu van con update.
7. **Race result reader.** `ReadPreviousUpdateResult()` chi doc luc Start; Updater ghi `Succeeded` sau khi Desktop moi da khoi tao va health ack. Co the chi thay result o lan mo sau. Sua protocol/result observation de hien dung ngay, mot lan, khong bao success truoc health ack.
8. **Failed result khong duoc map day du.** Reader xu ly `RolledBack`/`Succeeded`, nhung result `Failed` co the bi xoa ma khong Publish status. Test generic failure result.
9. **Feed disabled hien Retry nhu loi.** Service map disabled thanh `Failed`, UI hien thong bao benign nhung van co nut Retry. Can state/display ro `Unavailable/NotConfigured`; catalog, login va download van hoat dong. Khong nham disabled voi signature invalid/network failure.
10. **Manual retry van bi backoff.** `CheckAsync()` dung chung `_retryCheckAfter` (disabled 15 phut, loi khac 30 giay). Can phan biet manual check va background retry co gioi han, tranh user bam ma khong co request/phan hoi. Khong bo rate limit toan bo.
11. **Mat Max dang chon sau restart.** Pending/Updater launch khong mang `--max-pid`; Desktop moi co the chon phien dau tien. Giu dung phien neu PID con song; fallback an toan neu Max da dong. Chi truyen startup options allowlisted, khong dua token/credential vao args.
12. **Dang download/merge khi apply.** Chua thay guard trong action apply. Can quyet dinh drain/pause/cancel-safe, luu queue va tranh cat thao tac Max. Khong tu dong restart giua giao dich/file dang promote.
13. **Friendly copy + localization.** Update/Bridge warning con text Viet co dinh; failure UI co error code tho. English default, VI day du, thong bao de hieu; code va stack nam trong logs/details.

## 6. Bao mat, channel va bootstrap

- Authenticode (EXE/DLL trust) va ES256 (manifest/component integrity) la **hai he thong khac nhau**.
- ES256 dung ECDSA P-256, signature Base64 IEEE-P1363, public key DER SPKI Base64. Giu canonical fields va timestamp dong bo giua .NET/Node; dung signer hien co.
- Production require Authenticode hop le, ES256 hop le, approved license, HTTPS, checksum, pinned public key va staging acceptance. Khong dung self-signed de gia vo da dat Production.
- Test duoc dung fixture/test key rieng trong isolated test/staging, nhung khong pin key test vao Production va khong tat verification cua build user.
- Private key/chung thu/password khong vao repo, chat, log, public folder hay VPS env. VPS can public key va signatures, khong can private signing key.
- Channel client phai khop channel da ky. LiveTest hien dung `live-test`, Staging `staging`, Production `production`. Mot feed Production khong tuong duong feed LiveTest.
- Backend hien mot feed tu env, client goi khong co query channel. Thiet ke staging/test feed khong lam thay doi feed Production dang dung; neu doi contract can backward compatibility va tests.
- Version nguon duy nhat `Directory.Build.props`. Baseline user yeu cau 1.0.0. Muon test update phai duoc user thong nhat version cao hon, vi du 1.0.1. Khong tu dong doi ban dang phat hanh hay minimumVersion de ep user.
- De bootstrap: tao ban nen co public key pin va cai thu cong, sau do update sang ban cao hon ky cung trust key. Ban unsigned hien tai khong the tu hoc key tu VPS mot cach an toan.
- Rollback co chu dich ve ban truoc la recovery, khac viec chap nhan feed downgrade. Khong cho feed ban cu/khac channel vuot version policy.
- Source local da co expected operational handling cho `503 PLUGIN_RELEASE_DISABLED` va `PLUGIN_API_DISABLED`. Khong "sua spam Telegram" bang cach an tat ca 503: signature invalid/loi that phai con canh bao. Can kiem tra code dang deploy tren VPS co khop local khong.

## 7. VPS: kiem tra va phat hanh

Chua duoc tu y bat feed tren Production. Thu tu: sua code -> test isolated -> staging -> artifact signed -> serve/verify -> env/feed -> test user.

### Kiem tra read-only

```bash
cd /opt/3dipl/app
git rev-parse HEAD
sudo docker compose -f compose.production.yml ps backend
sudo docker compose -f compose.production.yml exec -T backend node --input-type=module <<'JS'
const names = [
  "PLUGIN_API_ENABLED", "PLUGIN_RELEASE_ENABLED", "PLUGIN_RELEASE_CHANNEL",
  "PLUGIN_RELEASE_VERSION", "PLUGIN_MINIMUM_VERSION", "PLUGIN_RELEASE_MANIFEST_VERSION"
];
for (const name of names) console.log(name + "=" + (process.env[name] || "<unset>"));
for (const name of ["PLUGIN_RELEASE_PUBLIC_KEY", "PLUGIN_RELEASE_SIGNATURE",
  "PLUGIN_DESKTOP_RELEASE_SIGNATURE", "PLUGIN_MAX_BRIDGE_RELEASE_SIGNATURE"])
  console.log(name + "=<length:" + (process.env[name] || "").length + ">");
JS
curl -sS -D - https://3dipl.org/api/plugin/release
```

Khong paste full env. `PLUGIN_JWT_SECRET` la auth secret rieng, khong phai release signing key; khong rotate secret nay chi de sua feed.

### Bien env release hien co

| Bien / nhom | Cach dien |
| --- | --- |
| `PLUGIN_API_ENABLED` | Bat API theo rollout da duoc duyet |
| `PLUGIN_RELEASE_ENABLED` | Giu false den khi artifact/feed hop le; true la buoc cuoi |
| `PLUGIN_RELEASE_CHANNEL` | Channel da ky, khop client |
| `PLUGIN_RELEASE_VERSION`, `PLUGIN_MINIMUM_VERSION` | Lay tu manifest, khong tu nang minimum |
| `PLUGIN_RELEASE_MANIFEST_VERSION` | 2 |
| `PLUGIN_RELEASE_URL`, `PLUGIN_RELEASE_SHA256` | MZP/legacy artifact dung manifest |
| `PLUGIN_RELEASE_SIGNATURE`, `PLUGIN_RELEASE_PUBLISHED_AT` | Dung signer output, khong tu sua timestamp sau ky |
| `PLUGIN_RELEASE_PUBLIC_KEY` | SPKI public key khop pin trong client |
| `PLUGIN_DESKTOP_RELEASE_URL`, `..._SHA256`, `..._SIGNATURE`, `..._PUBLISHED_AT` | Desktop ZIP signed component |
| `PLUGIN_DESKTOP_RELEASE_PROTOCOL_MINIMUM`, `..._PROTOCOL_MAXIMUM` | Protocol range thuc te, hien Bridge protocol 2 |
| `PLUGIN_MAX_BRIDGE_RELEASE_URL`, `..._SHA256`, `..._SIGNATURE`, `..._PUBLISHED_AT` | Bridge MZP component dung family/contract |
| `PLUGIN_MAX_BRIDGE_RELEASE_PROTOCOL_MINIMUM`, `..._PROTOCOL_MAXIMUM` | Range thuc te cua Bridge |
| `PLUGIN_DEPLOYMENT_ENV` | production/staging dung moi truong |

Khong dien SHA/signature gia de env check pass. Manifest la JSON; response duoc backend tao tu env va verify, khong tu doc mot file release.json tren dia.

Artifact can URL HTTPS bat bien theo version/build. Khong overwrite noi dung tai cung URL. Download lai tu URL public, so hash/check signatures truoc khi bat feed. Chua xac nhan reverse proxy live; `compose.production.yml` local khong co mount plugin-releases. Chi copy ZIP vao VPS khong dam bao da serve duoc. Cau hinh static host/reverse proxy theo infrastructure thuc te, readonly, khong lo env/key/data.

Sau khi backup env trong thu muc root-only, chinh bang `sudoedit`, va artifact da dat moi gate:

```bash
cd /opt/3dipl/app
sudo docker compose -f compose.production.yml run --rm --no-deps backend npm run env:check
# Dung lai neu env check fail. Env-only change can recreate, restart khong nap env_file moi.
sudo docker compose -f compose.production.yml up -d --no-deps --force-recreate backend
sudo docker compose -f compose.production.yml ps backend
sudo docker compose -f compose.production.yml logs --since=5m backend
curl -sS -D - https://3dipl.org/api/plugin/release
```

Neu thay doi backend code thi build/deploy image dung commit theo quy trinh hien co truoc; khong chi recreate image cu. Dung artifact cu da luu + previous env/image de rollback; khong `down -v`, khong xoa database/cache. Chi khoi phuc cac release fields can thiet, tranh ghi de env changes khac.

## 8. Ke hoach trien khai cho chat tiep theo

1. Doc AGENTS, git status/diff hai repo, source map va test updater. Bao cao pham vi truoc khi sua.
2. Sua root/channel, fail-safe rollback va Bridge incompatible flow truoc. Them tests regression cho moi loi.
3. Hoan thien state machine/display, result race, manual check/backoff, Max PID va busy-work guard.
4. Thiet ke manifest/update selection cho hai family, preserve client cu. Hoan thien signed build pipeline truoc khi doi gates.
5. Dung HTTP fixture va isolated data root test updater process that. Du fixture keys, khong dung so du/giao dich/canh user de thu.
6. Tao ban nen pinned-key + next-version staging, test tu installed binary, restart/rollback, nhieu Max PID.
7. Chuan bi runbook signed publishing/env/feed/rollback. Chua co chung thu/key/licence-approved thi ban giao RC va ghi blocker ro rang, khong cong bo Production.

## 9. Test va Definition of Done

- Disabled feed la trang thai khong san sang, khong khoa catalog/login/download, khong spam expected server alerts.
- Latest/equal/older feed khong update; newer feed dung channel/version/host/protocol moi duoc.
- Missing pin, wrong signature/key, bad SHA, wrong channel, expired/invalid metadata va unsafe archive deu bi tu choi.
- Desktop ZIP khong bi nham voi MZP; partial/network/disk/access failure giu ban cu chay duoc.
- LiveTest/Staging/Production root, pointer va data khong lan nhau.
- Compatible Desktop-only update: bam update -> verified -> restart -> health ack -> success status + version/build moi; khong bat restart Max neu khong can.
- Bridge update: no premature Desktop apply; dung MZP family va restart Max; canh chua luu khong bi tu dong dong.
- Process launch fail, timeout, malformed ack, wrong token/version/PID, pointer write fail va generic exception deu co recovery/rollback dung.
- Success/failure/rollback hien ngay va khong lap; app giu account/settings/cache, selected Max PID va queue persisted.
- Dang download/merge co flow an toan, khong charge lai hay hu file; multi-instance/repeated click khong apply hai lan.
- English/VI, 1024x768 tro len, DPI 100-200%, keyboard va button enabled states dung.
- Signed package thuc te, download lai qua HTTPS, checksum va manifest verified; feed ETag/304/cache khong giu release cu vo han.
- Unit pass khong thay the installed-binary process E2E/Max acceptance. Ghi ro cai nao da run, cai nao chua run.

Lenh local nen dung (sau khi doc huong dan repo):

```powershell
# Plugin; sau package build can force-evaluate de tra lockfile ve profile solution chuan.
Set-Location D:\LTinh\plugin
& .\.dotnet-sdk\dotnet.exe restore .\ThreeDiPL.sln --force-evaluate --verbosity quiet
& .\.dotnet-sdk\dotnet.exe restore .\ThreeDiPL.sln --locked-mode --verbosity quiet
& .\.dotnet-sdk\dotnet.exe test .\ThreeDiPL.sln -c Release --no-restore

# Web/backend; tests chi dung fixtures, khong ket noi Production DB.
Set-Location D:\LTinh\get-link-3d66
npm run lint
npm test
npm run build:release
```

Bo cai unsigned phai dung `-Channel LiveTest`, giu output thu muc revision moi va ban cu de rollback. Build hai family lan luot, khong chay MSBuild song song vao chung output. Khong dua lenh Production signing voi key/path gia vao quy trinh de user chay nham.

Ban giao cuoi can co: commit hai repo + dirty status, version/build, artifact path/URL bat bien, SHA-256, signature/public key fingerprint, test evidence, Max acceptance, cau hinh thay doi, deploy va rollback, blockers chua xong.

## 10. Prompt gui chat moi

```text
Hoan thien co che cap nhat plugin 3DiPL trong Desktop va feed VPS.
Doc D:\LTinh\get-link-3d66\docs\PLUGIN_UPDATE_HANDOFF_1.0.0_2026-10-01.md truoc.
Plugin source o D:\LTinh\plugin; web/backend o D:\LTinh\get-link-3d66.
Ca hai worktree co thay doi chua commit: giu nguyen, khong reset/checkout bo thay doi.
Baseline moi nhat la LiveTest 1.0.0 compact-connection, 256 tests pass.
Giu English default, ten scene/picker Focus, tai song song va bo Ghim.
Sua P0/P1 updater trong tai lieu, them regression + process E2E, tao RC moi va runbook VPS.
Khong chi bat PLUGIN_RELEASE_ENABLED: LiveTest root sai, success/result race,
Bridge compatibility/family gates va public-key bootstrap van chua hoan thien.
User CHUA co Authenticode/ES256 keys va license con draft: khong bypass,
khong dung self-signed de xuat ban Production, khong fake signature/hash.
Khong tu SSH/deploy/rotate secret/publish feed hay doi version Production khi chua duoc phep.
Hoan thien local + staging/fixtures truoc, bao cao blockers that va cac test da/chua run.
```
