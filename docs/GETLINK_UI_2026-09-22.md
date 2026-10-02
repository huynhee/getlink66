# Getlink UI LiveTest - 2026-09-22

## Changes

- Plugin Getlink uses a preview and confirmation layout, explicit inspection progress, and missing-image retry.
- Downloaded content is scoped to Model, Scene, or Getlink. The standalone Downloaded navigation item is removed.
- Backend preview cache stores the upstream image URL, while responses expose the authenticated preview proxy. Invalid cached proxy URLs trigger metadata refresh.

## Build

- Backend main commit: `06024c3`.
- Plugin installer: `D:/LTinh/plugin/artifacts/live-test-0.5.0-2026-09-22-getlink-ui/3DiPL-Asset-Manager-LiveTest-0.5.0.mzp`.
- Installer SHA-256: `23cae1e1aab905823417318c6721b3ccb659164da6455b84425c6672686a52e2`.
- Plugin contains existing uncommitted development changes; this is LiveTest, not a signed Production release.

## Verification

- Plugin: 165 tests passed.
- Backend focused Getlink security suite: 4 tests passed.
- ESLint passed for the two changed backend files.
- DevHost build: zero warnings/errors.
- Mock UI screenshot at 1024x768 reviewed, including missing-image retry state.
- No paid Getlink transaction performed. Authenticated real-image and installed Max workflow require a user smoke test.

## Deployment

Production path: `/opt/3dipl/app`. Backend image rollback tag: `3dipl-backend:pre-preview-20260922`.

```bash
cd /opt/3dipl/app
git pull --ff-only origin main
sudo docker compose -f compose.production.yml build backend
sudo docker compose -f compose.production.yml run --rm --no-deps backend npm run env:check
sudo docker compose -f compose.production.yml up -d --no-deps backend
curl -fsS http://127.0.0.1:5000/ready
```

To roll back the running image without discarding source changes:

```bash
sudo docker tag 3dipl-backend:pre-preview-20260922 3dipl-backend:local
sudo docker compose -f compose.production.yml up -d --no-deps --force-recreate backend
```
