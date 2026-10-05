# Getlink File Transfer

This tuning concerns file bytes (3D66 -> VPS -> client), not link creation or
credit pricing. Web and plugin downloads keep the existing owner/HMAC checks.

## Application

- Full downloads retain the default two connections per account.
- Valid single-byte Range requests can use six total connections per account
  and twelve per IP, subject to the unchanged global download capacity.
- Tune with `MAX_DOWNLOAD_RANGE_CONNECTIONS_PER_USER` and
  `MAX_DOWNLOAD_RANGE_CONNECTIONS_PER_IP`. Set these to the existing full-file
  limits to revert the range concurrency change.
- Files remain streamed with backpressure and bounded 256 KiB buffers. They are
  not loaded in full into RAM or redirected to upstream URLs.
- `Cache-Control: no-store, no-transform` preserves the file representation,
  strong ETag and resume semantics without recompressing the archive.
- `GETLINK_DOWNLOAD_TRANSFER` logs include received bytes, first-byte latency,
  upstream-open time, completion status and proxy throughput. These measure the
  application-to-Nginx transfer, not guaranteed last-mile speed. No signed URLs,
  cookies or download tokens are logged.

```bash
sudo docker compose -f compose.production.yml logs --since=30m backend \
  | grep 'GETLINK_DOWNLOAD_TRANSFER'
```

## Nginx

The streaming location in `ops/nginx/3dipl.conf` now also matches:

- `/api/getlink/download/:id`
- `/api/plugin/getlink/download/:id`

Preserve existing TLS, upload and plugin-release settings. Merge only the
streaming location changes into the active production server block. The block
disables gzip, proxy buffering and temporary-file buffering, forwards Range and
If-Range, and allows one-hour download idle timeouts. Validate before reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Restore real visitor IPs using only trusted Cloudflare network ranges before
relying on per-IP download limits. Do not blindly trust a browser-supplied
`CF-Connecting-IP` header or raise Express proxy trust to all addresses.

## Network Measurements

Manual read-only measurements on 2026-10-05, using existing files and bounded
byte ranges (no new Getlink job, charge or redownload-counter change):

| Path | Sample | Observed speed |
| --- | --- | --- |
| 3D66 -> VPS, full response | First 8 MiB | 18.0 MiB/s |
| 3D66 -> VPS, Range | 8 MiB | 59.2 MiB/s |
| VPS -> test client via Cloudflare | 8 MiB | 2.55 MiB/s |
| VPS -> test client, direct HTTPS | Same 8 MiB | 0.94 MiB/s |

These are small samples, not a guarantee for every model, CDN region or ISP.
Source samples can benefit from connection reuse and CDN cache warming. The
public downstream measurements used the existing plugin archive rather than a
user's Getlink download, to avoid changing their download allowance.

## Optional TCP BBR Trial

The VPS initially used CUBIC and fq_codel. Its existing kernel includes the BBR
module. Changing the default congestion control is a host-wide operation, so it
requires explicit approval, a repeat measurement and a rollback plan. It is not
automatically enabled by an application deployment.

After approval, load the existing module and change only the TCP default:

```bash
sudo modprobe tcp_bbr
sudo sysctl -w net.ipv4.tcp_congestion_control=bbr
sysctl net.ipv4.tcp_congestion_control
```

Do not reboot, replace the active interface qdisc or install a custom kernel
during an ongoing download. Test the same bounded byte range over fresh
connections. Revert if repeated measurements regress:

```bash
sudo sysctl -w net.ipv4.tcp_congestion_control=cubic
```

Only persist the new default after the approved trial succeeds. The BBR trial
has not been applied by the changes in this repository.

References: [Nginx buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering),
[HTTP Range semantics](https://www.rfc-editor.org/rfc/rfc9110.html#name-range),
[Cloudflare visitor IPs](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/),
[BBR](https://github.com/google/bbr).
