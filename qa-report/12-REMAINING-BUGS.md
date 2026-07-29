# Remaining Bugs and Risks

## Open Code Risks

- **Medium:** frontend JS `556.69 kB` vượt cảnh báo Vite 500 kB; cần lazy route.
- **Medium:** `/ready` mới phản ánh DB/shutdown, chưa phản ánh Drive/worker backlog.
- **Medium:** worker/rate-limit/cache chưa có distributed coordination.
- **Low:** build mặc định local bị khóa `frontend/dist/3dipl-d.jpg` bởi process ngoài
  repo; build sạch sang thư mục khác pass. CI máy sạch không chịu ảnh hưởng.

## Release Blockers

1. `MONGO_MARKETPLACE_URI` chưa cấu hình.
2. Local env còn bật dev login; production phải tắt.
3. Google callback chưa HTTPS và hostname Turnstile chưa khớp production.
4. `ADMIN_2FA_REQUIRED` và transaction requirement chưa bật.
5. Chưa chọn proxy hoặc chấp nhận rõ rủi ro Drive redirect.
6. Retention cần Drive write.
7. Image-search HTTPS provider/API key chưa có.
8. Chưa chạy SePay sandbox, OAuth/Turnstile/domain staging E2E.
9. Chưa chạy backup restore drill và container build; Docker CLI local không có.

Không còn Critical/High code defect đã biết. Các blocker trên vẫn khiến trạng thái
tổng thể là `NOT READY`.
