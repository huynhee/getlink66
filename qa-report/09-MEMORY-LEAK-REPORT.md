# Memory Leak Report

## Kết quả smoke

| Chỉ số | Trước | Sau 300 request + GC | Chênh lệch |
|---|---:|---:|---:|
| Heap | 27,490,264 B | 28,124,480 B | +634,216 B |
| RSS | 113,168,384 B | 124,313,600 B | +11,145,216 B |

Heap tăng khoảng 0.60 MiB, không cho thấy leak rõ ràng trong bài test ngắn. RSS
tăng có thể do V8/Chromium/native allocator giữ page; chưa đủ để kết luận soak.

## Lifecycle đã sửa/kiểm tra

- Getlink worker giữ một active promise và drain khi shutdown.
- Browser/context/page/stream cần tiếp tục đóng trong `finally`.
- Download proxy sử dụng stream, không đọc archive lớn toàn bộ vào RAM.
- Diagnostic IPC chỉ bật non-production với `QA_DIAGNOSTICS_ENABLED=true`.

## Còn phải làm

Chạy staging soak 2-4 giờ với getlink thật, Drive preview/download, job retry và
worker restart. Cảnh báo khi RSS > 80% RAM, heap tăng liên tục qua 6 lần GC hoặc
restart > 3 lần/15 phút.
