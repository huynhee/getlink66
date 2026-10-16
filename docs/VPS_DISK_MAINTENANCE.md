# VPS Disk Maintenance

The storage monitor warns at 70%, reports an error at 85%, and reports critical
capacity at 95%. Check available bytes and growth before removing anything.

## Read-Only Diagnosis

```bash
df -hT /
df -ih /
sudo docker system df
sudo docker info --format 'Docker root: {{.DockerRootDir}}'
sudo du -xhd1 /var/lib/docker /var/lib/containerd /var/lib/3dipl /var/log 2>/dev/null
sudo journalctl --disk-usage
sudo docker inspect --format '{{.Name}} logging={{json .HostConfig.LogConfig}} path={{.LogPath}}' \
  3dipl-backend 3dipl-frontend 3dipl-mongo 3dipl-meilisearch
```

`docker system df` image and build-cache figures can share layers; do not add
their reclaimable sizes or promise that much free space. Container writable
layer size does not include all container log storage. Confirm log file sizes
with `sudo ls -lh` on the exact paths returned by the last command. Do not dump
full container configuration, which can expose environment secrets.

## Reclaim Unused Build Cache

Run when no application build/deployment is active. This removes unused build
cache while keeping a small cache budget; it does not remove running containers
or their application volumes. The next image build can take longer.

```bash
sudo docker builder prune --all --force --keep-storage 2GB
df -hT /
sudo docker system df
```

Do not use `docker system prune --volumes`, remove database/search directories,
or delete published plugin artifacts to resolve a cache problem. Keep tagged
rollback images until the replacement has passed its deployment checks.

## Bound Container Logs

`compose.production.yml` sets `json-file` rotation on all four services:
five files of up to 20 MiB each per container (approximately 400 MiB across the
four services, with small record/metadata overhead possible). This only bounds
Docker stdout/stderr logs, not logs written by an application inside its own
filesystem, Nginx host logs, or systemd journals.

Existing containers do not pick up new logging options on `restart`. They must
be recreated. No image rebuild or Docker daemon restart is needed for this
Compose-only change. Save needed diagnostic logs to approved restricted storage
before recreation; old container logs are removed with the old containers.

During an approved maintenance window, after pulling the reviewed Compose
change, validate the configuration without printing environment values:

```bash
cd /opt/3dipl/app
sudo docker compose -f compose.production.yml config --quiet
```

Recreate the application services when no user download/checkout is active:

```bash
sudo docker compose -f compose.production.yml up -d --no-deps --no-build --pull never \
  --force-recreate --wait --wait-timeout 180 backend frontend
curl -fsS http://127.0.0.1:5000/ready
curl -fsS http://127.0.0.1:8080/healthz
```

MongoDB and Meilisearch recreation interrupts database/search availability.
Schedule it separately, pause new requests, finish active work, and confirm a
recent verified backup first. Never run Compose `down -v` or reinitialize MongoDB.
Only proceed with each next command after the previous one succeeds:

```bash
sudo docker compose -f compose.production.yml up -d --no-deps --no-build --pull never \
  --force-recreate --wait --wait-timeout 180 mongo
sudo docker compose -f compose.production.yml exec -T mongo \
  mongosh --quiet --eval 'db.hello().isWritablePrimary'
sudo docker compose -f compose.production.yml up -d --no-deps --no-build --pull never \
  --force-recreate --wait --wait-timeout 180 meilisearch
curl -fsS http://127.0.0.1:5000/ready
sudo docker compose -f compose.production.yml ps
```

The MongoDB primary check must print `true`. Afterward, verify search and a
normal account request before reopening traffic. Check `HostConfig.LogConfig`
again with the read-only command above to confirm rotation is actually active.
Do not manually truncate or delete Docker-managed JSON log files while Docker
owns them.

Sources: [build-cache pruning](https://docs.docker.com/reference/cli/docker/builder/prune/)
and [JSON-file logging](https://docs.docker.com/engine/logging/drivers/json-file/).
