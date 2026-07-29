# Business Flows

## Authentication

Google OAuth xác thực state/callback, upsert user theo email và cấp access/refresh
cookie. JWT chứa `sessionVersion`; logout tăng version nên token cũ bị thu hồi.
User bị ban bị chặn ở auth/admin/marketplace. Admin bắt buộc role + allowlist và
production yêu cầu TOTP 2FA.

## Credit và Pro

SePay IPN phân loại payment code Credit/Pro, xác minh transaction, số tiền và
idempotency trước khi cộng quyền lợi. Credit dùng cho getlink; Pro cấp quyền tải
marketplace. Admin điều chỉnh ghi lịch sử/audit. Không cấp quyền dựa vào redirect
frontend.

## Getlink

Frontend tạo `GetlinkJob` có `clientRequestId`. Worker claim nguyên tử, validate,
xử lý lựa chọn định dạng, lấy file và chỉ trừ credit khi history được tạo thành
công. Job giữ tiến trình qua đổi route/reload, retry không charge lần hai và
shutdown chờ công việc đang chạy.

## Model và Scene

Catalog chỉ trả mục publish, metadata đủ và file ready. Free cần đăng nhập; Pro
phải có `proUntil` còn hạn, kể cả admin. Backend xác minh Turnstile, quyền và quota
trước khi tạo session. Model tốn 1 lượt, Scene tốn 5 lượt. File route kiểm tra
session owner; plugin dùng Bearer và challenge riêng.

## Drive Sync và Admin

Drive là nguồn asset/metadata; Mongo là index. Sync theo folder hoặc Changes API,
không full scan tự động. Admin sửa metadata theo Drive-first, quản lý taxonomy,
file, publish, thùng rác 30 ngày và audit. Xóa thu hồi session và trash folder;
history/download count được giữ.

## Plugin

Plugin bắt đầu device login, user duyệt trên web, plugin đổi code lấy access và
rotating refresh token. Download challenge dùng một lần, gắn user/device/asset;
manifest update production bắt buộc HTTPS, checksum và detached signature.
