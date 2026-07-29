# Monitoring Runbook

## Metrics và Alerts

| Tín hiệu | Cảnh báo đề xuất |
|---|---|
| Uptime `/health` | 2 lần fail liên tiếp |
| Readiness | 1 phút không ready |
| HTTP 5xx | >2% trong 5 phút |
| p95 API | >1 giây trong 10 phút |
| CPU | >85% trong 15 phút |
| RSS | >80% RAM hoặc tăng liên tục 30 phút |
| Disk | >75% warning, >90% critical |
| Mongo pool/lag | >80% pool hoặc lag >30 giây |
| Getlink processing | heartbeat stale >30 phút |
| Queue backlog | tăng liên tục 15 phút |
| Payment | bất kỳ receipt conflict/duplicate |
| Drive/image search | error rate >5% trong 5 phút |
| Backup | job fail hoặc quá RPO |

## Logging

Log JSON nên có request ID, user/job/order/payment/session ID đã rút gọn, route,
status, duration, worker, retry và error code. Không log cookie, JWT, OAuth code,
TOTP, SePay secret/payload đầy đủ, Drive URL/ID không cần thiết hoặc file content.

## Dashboards

1. HTTP/infra.
2. Auth/admin/security rejects.
3. Payment, credit và reconciliation.
4. Getlink job duration/backlog/failure.
5. Marketplace session/quota/download/Drive.
6. Mongo Core/VPS connection/query/index/size.

## Daily Operations

- 08:00 kiểm tra alerts, pending payment/job và backup.
- 02:30 retention/archive theo Asia/Saigon.
- Hàng tuần review 5xx, slow query, storage growth và failed audit.
- Hàng tháng restore drill và secret/access review.

`/ready` hiện chưa đo Drive/worker; cần bổ sung synthetic probe cho preview,
download challenge và worker heartbeat ngoài process.
