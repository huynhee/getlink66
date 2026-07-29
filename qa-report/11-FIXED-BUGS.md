# Fixed Bugs

| ID | Mức độ | Bản sửa | Regression |
|---|---|---|---|
| BUG-001 | High | CSP/HSTS Turnstile tập trung | HTTP security test |
| BUG-002 | High | Same-origin API + artifact verifier | Release build |
| BUG-003 | Critical | JWT session version revocation | Session test |
| BUG-004 | High | Admin 2FA fail-closed | Auth/readiness test |
| BUG-005 | Critical | Admin không bypass Pro | Marketplace test |
| BUG-006 | Critical | Download owner binding | Request security test |
| BUG-007 | High | Cấm startup migration production | Readiness test |
| BUG-008 | High | Production config fail-fast | Readiness test |
| BUG-009 | High | Getlink graceful drain | Getlink job test |
| BUG-010 | High | Audit write failure có log | Lint/admin regression |
| BUG-011 | Critical | Plugin Bearer file endpoint | Plugin download test |
| BUG-012 | High | Signed manifest/challenge gate | Plugin/readiness tests |
| BUG-013 | Medium | Image search fail-fast | Readiness test |
| BUG-014 | Medium | Bỏ Google Fonts runtime | Chromium smoke |
| BUG-015 | Medium | CI release/smoke evidence | Local command review |
| BUG-016 | High | Docker cho phép API same-origin | Clean build/verifier |

Không có thay đổi nào tắt validation, bypass authorization, hardcode payment
success hoặc chuyển Drive thành public để làm test xanh.
