# Performance Report

## Phương pháp

Chạy static production build + Express/Mongo memory fixture, Chromium desktop và
mobile. Sau warm-up, gửi 300 request catalog với concurrency 20. Đây là local
smoke/load, không thay thế benchmark staging với Atlas/VPS/Drive thật.

## Kết quả

| Chỉ số | Kết quả |
|---|---:|
| Request | 300 |
| Concurrency | 20 |
| Median | 12.62 ms |
| p95 | 21.44 ms |
| Maximum | 25.55 ms |
| External failure | 0 |
| Home desktop | 225 ms |
| Home mobile | 211 ms |

Nguồn: `performance-results/smoke.json`.

## Bundle

- HTML: 2.66 kB, gzip 0.97 kB.
- CSS: 226.57 kB, gzip 39.74 kB.
- JS: 556.69 kB, gzip 155.14 kB.

Vite cảnh báo JS lớn hơn 500 kB. Đây là Medium; nên route-split Admin/Plugin và
lazy-load gallery trước khi traffic lớn. Asset hash được cache dài hạn qua Nginx.

## Kết luận

Không thấy bottleneck trong fixture nhỏ. Cần staging test với dữ liệu gần thật,
latency Atlas/VPS, ảnh Drive và ít nhất 30 phút soak trước production.
