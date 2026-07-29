# Test Cases

| ID | Ca kiểm tra | Kết quả | Trạng thái |
|---|---|---|---|
| AUTH-01 | User gọi API admin | 403 | Pass |
| AUTH-02 | Logout rồi dùng JWT cũ | Bị từ chối bởi session version | Pass |
| AUTH-03 | User banned gọi API | 403 | Pass |
| AUTH-04 | Admin production thiếu 2FA | Fail closed | Pass |
| SEC-01 | Mutation thiếu CSRF | 403 | Pass |
| SEC-02 | Origin ngoài allowlist | CORS từ chối | Pass |
| SEC-03 | NoSQL operator payload | 400 | Pass |
| PAY-01 | IPN trùng transaction | Chỉ duyệt một lần | Pass |
| GET-01 | Double submit job | Một active job/user | Pass |
| GET-02 | Restart/shutdown worker | Drain hoặc reclaim an toàn | Pass |
| MKT-01 | Free tải tài nguyên Pro | `403 PRO_REQUIRED` | Pass |
| MKT-02 | Session user A dùng bởi B | 403 | Pass |
| MKT-03 | Scene còn dưới 5 quota | 429, không charge | Pass |
| MKT-04 | Retry cùng session | Không tăng count/charge lại | Pass |
| PLG-01 | Device login và rotating refresh | Token cũ bị revoke | Pass |
| PLG-02 | Challenge replay | Bị từ chối | Pass |
| PLG-03 | Plugin file route | Bearer + owner bound | Pass |
| WEB-01 | 6 public route x 2 viewport | Không console/network lỗi ngoài | Pass |
| WEB-02 | Admin desktop/mobile | Render không overflow | Pass |
| PERF-01 | 300 request, c=20 | p95 21.44 ms | Pass |
| MEM-01 | Heap sau GC | +0.60 MiB, chưa thấy leak | Pass |
| DRV-01 | OAuth refresh + list root | Drive API ok | Pass |
| MIG-01 | Dry-run memory | Không ghi DB, pass | Pass |
| MIG-02 | Execute thiếu confirm | Fail closed | Pass |
| STG-01 | OAuth HTTPS staging | Chưa có staging | Blocked |
| STG-02 | SePay sandbox webhook | Chưa có sandbox | Blocked |
| STG-03 | Turnstile hostname thật | Chưa cấu hình production | Blocked |
| BAK-01 | Restore backup tách biệt | Chưa thực hiện | Blocked |
