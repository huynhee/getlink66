# Marketplace Search V3

## Architecture

MongoDB VPS remains the catalog source of truth. Meilisearch is a rebuildable,
read-only discovery index. Model and Scene use separate indexes, and no search
operation writes metadata back to MongoDB or Google Drive.

- `marketplace_models_v3`: Model card documents, Pro-first by default.
- `marketplace_scenes_v3`: Scene card documents, normal relevance order.
- MongoDB: bounded exact/prefix fallback when Meilisearch is unavailable.
- Recommendation cache: MongoDB VPS, rebuilt asynchronously per asset.

The Meilisearch service is private to the Docker network. Do not publish port
`7700` through Docker, Nginx, or Cloudflare.

## Production Configuration

Set these values in `/etc/3dipl/production/backend.env`:

```env
MARKETPLACE_SEARCH_ENGINE=meilisearch
MEILISEARCH_URL=http://meilisearch:7700
MEILI_MASTER_KEY=GENERATE_A_RANDOM_32_PLUS_CHARACTER_SECRET
MARKETPLACE_MEILI_MODEL_INDEX=marketplace_models_v3
MARKETPLACE_MEILI_SCENE_INDEX=marketplace_scenes_v3
MARKETPLACE_MEILI_TIMEOUT_MS=400
MARKETPLACE_MEILI_CIRCUIT_BREAKER_MS=30000
MARKETPLACE_MEILI_ROLLOUT_PERCENT=100
MARKETPLACE_MEILI_SHADOW_ENABLED=false
MARKETPLACE_MEILI_CHECKPOINT_FILE=/var/lib/3dipl/backup-work/marketplace-meilisearch-v3-checkpoint.json
MARKETPLACE_SEARCH_SEMANTIC_ENABLED=true
MARKETPLACE_SEARCH_FALLBACK_LIMIT=240
MARKETPLACE_RECOMMENDATION_WORKER_ENABLED=true
MARKETPLACE_RECOMMENDATION_WORKER_INTERVAL_MS=2000
MARKETPLACE_POPULARITY_WORKER_ENABLED=true
MARKETPLACE_POPULARITY_WORKER_INTERVAL_MS=600000
```

Use the same `MEILI_MASTER_KEY` for the Meilisearch container and backend. Keep
image search disabled until a real provider is configured.

## First Rollout

```bash
cd /opt/3dipl/app
sudo install -d -m 0755 /var/lib/3dipl/meilisearch
sudo install -d -m 0755 /var/lib/3dipl/backup-work
sudo docker compose -f compose.production.yml build backend frontend
sudo docker compose -f compose.production.yml up -d meilisearch
sudo docker compose -f compose.production.yml run --rm backend npm run env:check
sudo docker compose -f compose.production.yml run --rm backend npm run marketplace:meili:dry-run
sudo docker compose -f compose.production.yml run --rm \
  -e MEILI_REBUILD_CONFIRM=marketplace-search-v3 \
  backend npm run marketplace:meili:backfill
sudo docker compose -f compose.production.yml run --rm backend npm run marketplace:meili:verify
sudo docker compose -f compose.production.yml up -d backend frontend
```

Backfill writes to `_next` indexes, verifies public document counts, then swaps
indexes atomically. It stores a checkpoint on the persistent `backup-work`
volume and can resume after interruption or a temporary container exit. Do not
run two rebuilds concurrently.

For staged traffic, start with `MARKETPLACE_MEILI_ROLLOUT_PERCENT=0` and
`MARKETPLACE_MEILI_SHADOW_ENABLED=true`. After the shadow index is healthy, use
`10`, `50`, then `100`. Bucketing is stable per user or marketplace session. Set
shadow to `false` at 100%.

For a later full rebuild, append `-- --reset` to the backfill npm command. Only
use it after the previous rebuild has completed and no other rebuild is running.

## Verification

```bash
curl -fsS https://3dipl.org/ready
sudo docker compose -f compose.production.yml ps
sudo docker compose -f compose.production.yml logs --tail=100 meilisearch backend
sudo docker compose -f compose.production.yml run --rm backend npm run storage:status
```

Check Vietnamese, unaccented Vietnamese, English, typo, asset ID, filters, and
pagination. Admin Storage Health should report both indexes healthy, no backlog,
and search latency/zero-result metrics. The `Xây lại Search` admin action starts
the same atomic background rebuild and refuses to start a second concurrent job.

Run the repeatable 200-request, 50-concurrent evaluation before increasing the
rollout percentage:

```bash
sudo docker compose -f compose.production.yml run --rm backend \
  npm run marketplace:search:evaluate -- \
  --base-url=https://3dipl.org \
  --requests=200 \
  --concurrency=50 \
  --max-p95-ms=300 \
  --assert \
  --output=/var/lib/3dipl/backup-work/search-v3-evaluation.json
```

The built-in suite covers Vietnamese, unaccented Vietnamese, English, typos and
natural descriptions for both catalogs. Pass `--queries=/path/queries.json` for
curated production cases. Each object may contain `q`, `assetType`, `group`,
`expectedIds`, and `minResults`.

## Rollback

Set `MARKETPLACE_SEARCH_ENGINE=mongo`, recreate only the backend container, and
leave Meilisearch data intact for diagnosis. The API immediately uses the bounded
MongoDB exact/prefix fallback; catalog and Drive data are unchanged.
