# Marketplace Cover Permissions

## Incident

The Model `metlakhskaia-plitka-keramark` and Scene
`chinese-style-bedroom-3d-model-9aqxmgz5` had valid cached WebP files. The database
reported `ready`, the backend returned HTTP 200, and the public URL returned 404.
There were no failed cover-generation jobs.

Host Nginx logged `stat() failed (13: Permission denied)`. The newly created
`model/6a/eb` and `scene/6a/eb` cache directories were mode 0700, while their
parents were 0755. The headed-browser launcher uses umask 077 to protect private
state. That also masks `mkdir(..., 0755)` to 0700 in the cover worker. Files
themselves were already explicitly set to 0644.

## Fix

Keep the restrictive process umask and private browser-state permissions intact.
The cover generator explicitly normalizes only its public cache root and shard
directories to 0755, including pre-existing restricted directories and the cached
output fast path. Directory symlinks are rejected before traversal/chmod. It does
not normalize parents outside the configured cover cache or other application
directories.

On VPS, only two public cover directories required repair. Both original URLs
then returned HTTP 200, `image/webp`, without changing their keys, metadata or
Google Drive files. No rebuild of the image collection was necessary.

## Scoped Repair

Review the configured path first. Never apply recursive chmod to `/var/lib/3dipl`
or use 0777. This command is limited to public cover directories and does not
follow directory symlinks:

```sh
ROOT=/var/lib/3dipl/media/covers
test "$(readlink -f "$ROOT")" = "$ROOT" || exit 1
sudo find -P "$ROOT" -xdev -type d ! -perm 0755 -printf '%m %p\n' -exec chmod 0755 -- {} +
```

## Regression Verification

`backend/test/marketplace-cover-permissions.test.js` runs with in-memory models,
mocked Drive responses and isolated temporary files. It covers both Model and
Scene generation under umask 077, existing restricted shard directories, cached
output reuse and directory-symlink rejection. It checks that sibling private
directories remain 0700, private files remain 0600, and the process umask remains
077. The POSIX permission test is skipped on Windows and must also run in an
isolated Linux process before deployment. It does not connect to production
databases or fetch real Drive files.

After deployment, check both backend readiness and public image GET responses,
not just database `ready` status or file existence. Verify that each response
decodes as an image; cached CDN 404s can outlive a permissions repair briefly.
