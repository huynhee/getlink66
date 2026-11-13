#!/usr/bin/env bash
set -euo pipefail
cd /opt/3dipl/app
incoming=/home/ubuntu/3dipl-release-1.0.3.2-20261110-getlink-preview
route=backend/src/routes/pluginRoutes.js
before=13d3c99ef7330637d408b570ec3a16e0488dcbc42baa6d2618d7212feef3bbc1
after=1a255cd8593d1b6dd4ab52c7a7508cb284119ef0a08e50e2ebca5fbcb635e370
old_image=sha256:4cf816466b07294ed8706d514a6737270adbdacdf973520cf8d1cb366e07f086
rollback_tag=3dipl-backend:pre-plugin-1.0.3.2-20261110
compose=(sudo -n docker compose -f compose.production.yml)

[[ $(git rev-parse HEAD) == 0ffd2b53e263670416526a301a4a231303e46ff6 ]]
[[ $(sha256sum "$route" | cut -d' ' -f1) == "$before" ]]
[[ $(sha256sum "$incoming/plugin-preview-route.patch" | cut -d' ' -f1) == d6042986f80bbd1d73dd347359d35f65111280b2c38b2c412ba5777bda88e077 ]]
[[ $(sudo -n docker inspect --format '{{.Image}}' 3dipl-backend) == "$old_image" ]]
[[ $(sudo -n docker inspect --format '{{.Config.Image}}' 3dipl-backend) == 3dipl-backend:local ]]
git diff --quiet -- backend
curl -fsS http://127.0.0.1:5000/ready
[[ ! -e "$incoming/pluginRoutes.before.js" && ! -e "$incoming/backend-deploy-receipt.json" ]]
cp -p "$route" "$incoming/pluginRoutes.before.js"
sudo -n docker image tag "$old_image" "$rollback_tag"
git apply --check "$incoming/plugin-preview-route.patch"

recover() {
  trap - ERR
  echo 'Backend rollout failed; restoring the previous reviewed backend image.' >&2
  sudo -n docker image tag "$rollback_tag" 3dipl-backend:local
  if [[ $(sha256sum "$route" | cut -d' ' -f1) == "$after" ]]; then
    cp -p "$incoming/pluginRoutes.before.js" "$route"
  fi
  "${compose[@]}" up -d --no-deps --force-recreate backend
  exit 1
}
trap recover ERR
git apply "$incoming/plugin-preview-route.patch"
[[ $(sha256sum "$route" | cut -d' ' -f1) == "$after" ]]
[[ $(git diff --name-only -- backend) == "$route" ]]
"${compose[@]}" build backend
"${compose[@]}" up -d --no-deps --force-recreate backend
healthy=false
for attempt in {1..60}; do
  if curl -fsS http://127.0.0.1:5000/ready; then healthy=true; break; fi
  sleep 2
done
[[ "$healthy" == true ]]
[[ $(sudo -n docker exec 3dipl-backend sha256sum /app/src/routes/pluginRoutes.js | cut -d' ' -f1) == "$after" ]]
status=$(curl -sS -o "$incoming/prepare-unauthenticated.json" -w '%{http_code}' -X POST \
  http://127.0.0.1:5000/api/plugin/getlink/preview/prepare -H 'Content-Type: application/json' -d '{}')
[[ "$status" == 401 ]]
new_image=$(sudo -n docker inspect --format '{{.Image}}' 3dipl-backend)
printf '{"ok":true,"sourceBase":"0ffd2b53e263670416526a301a4a231303e46ff6","routeSha256":"%s","oldImage":"%s","newImage":"%s","rollbackTag":"%s","unauthenticatedPrepare":401,"at":"%s"}\n' \
  "$after" "$old_image" "$new_image" "$rollback_tag" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$incoming/backend-deploy-receipt.json"
trap - ERR
cat "$incoming/backend-deploy-receipt.json"
