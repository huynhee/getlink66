# Initial Findings

## Baseline

- Git sạch, branch gốc `codex/3dsky-clone`, commit `3b0b1cf`.
- Tạo branch `release/production-readiness`; không reset/clean/stash.
- npm/package-lock là package manager; Node 20 được khóa.
- Repo đã có React/Express, Dockerfile/Nginx và CI nhưng chưa có compose/systemd.

## Lỗi ban đầu quan trọng

- CSP production chặn Turnstile.
- Frontend có thể bundle API `localhost:5000`.
- Logout không thu hồi JWT đã phát hành.
- Admin 2FA không fail-closed và admin có thể bypass quyền Pro.
- Download file web thiếu ràng buộc session owner.
- Startup có thể chạy migration ngoài ý muốn.
- Production không fail-fast khi config nguy hiểm/thiếu.
- Getlink shutdown không đợi job đang chạy.
- Audit log nuốt lỗi ghi DB.
- Plugin download URL dùng route cookie thay vì Bearer.
- Plugin manifest/challenge chưa có production gate đủ chặt.
- Google Fonts tạo phụ thuộc mạng và làm smoke chậm.
- CI chưa chạy build verifier/browser smoke.

## Rủi ro kiến trúc

Worker và rate limit theo process nên chưa an toàn cho nhiều replica. Drive redirect
lộ URL tải sau khi cấp quyền. `/ready` chưa phản ánh storage/worker. Image search
và semantic provider chưa được cấu hình trên môi trường local.
