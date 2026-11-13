# Getlink: tài liệu hệ thống, sự cố và vận hành

Ngày tổng hợp: **04/11/2026**, múi giờ **Asia/Saigon (UTC+7)**.

Mốc mã nguồn được đối chiếu: **`3981912`**, trên `main`.

Tài liệu này dành cho chủ hệ thống, người vận hành VPS và người tiếp tục sửa Getlink. Nội dung phân biệt rõ ba loại thông tin:

- **Mã nguồn:** hành vi được đọc từ repo tại mốc trên.
- **Đã quan sát:** kết quả kiểm tra thực tế trong phiên làm việc ngày 03-04/11/2026.
- **Chưa kết luận:** giả thuyết hoặc phần chưa có kiểm chứng thực tế đầy đủ.

Đây là bản bàn giao, không phải giám sát trực tiếp. Cấu hình, cookie và trạng thái VPS có thể thay đổi sau thời điểm kiểm tra. Không có mật khẩu SSH, cookie thật, token, khóa mã hóa, link tải nguồn hoặc URL model đã ký thật trong tài liệu này.

## Mục lục

1. [Kết luận hiện tại](#1-kết-luận-hiện-tại)
2. [Phạm vi và thuật ngữ](#2-phạm-vi-và-thuật-ngữ)
3. [Bản đồ mã nguồn](#3-bản-đồ-mã-nguồn)
4. [Kiến trúc và dữ liệu](#4-kiến-trúc-và-dữ-liệu)
5. [Năm chế độ xử lý link](#5-năm-chế-độ-xử-lý-link)
6. [Luồng đổi ID rồi lấy từ lịch sử](#6-luồng-đổi-id-rồi-lấy-từ-lịch-sử)
7. [Kiểm tra link sạch](#7-kiểm-tra-link-sạch)
8. [Cookie và đổi tài khoản](#8-cookie-và-đổi-tài-khoản)
9. [Chromium, profile và chạy ngầm](#9-chromium-profile-và-chạy-ngầm)
10. [CAPTCHA và xác minh thủ công](#10-captcha-và-xác-minh-thủ-công)
11. [Preview và lựa chọn định dạng](#11-preview-và-lựa-chọn-định-dạng)
12. [Job, hàng chờ và chống trùng](#12-job-hàng-chờ-và-chống-trùng)
13. [Credit và tải lại](#13-credit-và-tải-lại)
14. [Truyền file](#14-truyền-file)
15. [Các lớp cache](#15-các-lớp-cache)
16. [Lịch sử và archive](#16-lịch-sử-và-archive)
17. [API](#17-api)
18. [Admin và cấu hình](#18-admin-và-cấu-hình)
19. [Sự cố đã gặp](#19-sự-cố-đã-gặp)
20. [Kết quả kiểm thử](#20-kết-quả-kiểm-thử)
21. [Giới hạn và việc còn lại](#21-giới-hạn-và-việc-còn-lại)
22. [Kiểm tra VPS](#22-kiểm-tra-vps)
23. [Triển khai và rollback](#23-triển-khai-và-rollback)
24. [Checklist bàn giao](#24-checklist-bàn-giao)
25. [Tài liệu liên quan](#25-tài-liệu-liên-quan)

## 1. Kết luận hiện tại

| Hạng mục | Trạng thái tại lần kiểm tra gần nhất |
| --- | --- |
| Backend đã triển khai | `3981912`: `fix(getlink): follow verified history canonical redirects` |
| Node của dự án | `24.22.2`, yêu cầu `>=24.22.2 <25` |
| Chế độ lấy link trong CSDL tại đợt triển khai | `rewritten_footprint` |
| Trình duyệt production | Full Chromium, `channel: "chromium"` |
| Headless production | `THREED66_BROWSER_HEADLESS=false` |
| Cách chạy headed trên VPS | Xvfb riêng trong container backend |
| Lưu trạng thái đăng nhập | Cookie và localStorage nguồn, mã hóa trên volume riêng |
| Kiểm tra headed với model vừa báo lỗi | Có `sign`, đúng toàn bộ ID, đúng canonical path cuối và có DOM model; khoảng 12.071 ms, tức khoảng 12 giây |
| Kiểm tra headless với code mới và cùng snapshot đăng nhập | Vẫn gặp xác minh ở bước `seed_navigation`; dừng trước khi đọc lịch sử |
| Tự giải CAPTCHA / che dấu automation | Không triển khai |
| Kiểm tra tổng của bản vá | `npm run check`: 864 test đạt, lint và build đạt |
| Health sau triển khai | `/ready` thành công; Core và Marketplace đều sẵn sàng; container healthy, restart count 0 tại lúc kiểm tra |

Lần triển khai `3981912` chỉ thay backend. Đã đối chiếu cookie không đổi, env không đổi, frontend không bị recreate và chế độ xử lý trong CSDL không đổi. Lần thử headless sau đó chạy bằng container tạm, profile chỉ đọc; production tiếp tục chạy headed.

**Không được suy ra rằng headed hoặc có profile sẽ không bao giờ gặp CAPTCHA.** Kết quả chỉ xác nhận các bài thử cụ thể, không phải bảo đảm từ 3D66.

## 2. Phạm vi và thuật ngữ

### 2.1. Getlink khác thư viện Model/Scene

Getlink xử lý tài nguyên từ 3D66 bằng tài khoản nguồn, lấy thông tin/định dạng, giải quyết link file rồi proxy file về user. Nó có giá Credit theo dữ liệu nguồn và lịch sử Getlink riêng.

Thư viện Model/Scene có dữ liệu, quota Free/Subscription và thanh toán Credit riêng. Không áp dụng máy móc quy tắc Model/Scene 5/20/25 Credit hoặc entitlement 24 giờ cho Getlink.

### 2.2. Ba loại URL

| Tên | Ý nghĩa | Nơi được sử dụng |
| --- | --- | --- |
| `sourceUrl` | Trang model user gửi / ngữ cảnh nguồn ban đầu | Định danh logic, xử lý đầu vào, audit |
| `resolvedSourceUrl` | Trang model đã lấy được ngữ cảnh tài khoản và `sign` từ nguồn | Xác minh trước preview/download, refresh và audit |
| `fileUrl` | Link file/CDN do nguồn cấp, có thể hết hạn | Backend tải từ nguồn; không phải link nên công khai cho user |

URL tải user nhận là endpoint của 3DIPL. “Lấy link sạch” không có nghĩa là đổi tên một link CDN, xóa hết query hoặc phát trực tiếp `fileUrl` cho user.

Một số URL ngữ cảnh nội bộ có fragment dạng `#resolved=footprint&logical=...` để giữ định danh logic. Fragment được bỏ trước khi gửi HTTP sang nguồn và không phải bằng chứng đủ để bỏ kiểm tra ID/sign.

## 3. Bản đồ mã nguồn

Các đường dẫn dưới đây tương đối với thư mục gốc repo:

| Nhóm | File chính |
| --- | --- |
| API web | `backend/src/routes/getlinkRoutes.js` |
| Controller preview, tạo kết quả, tải file và ảnh | `backend/src/controllers/getlinkController.js` |
| Job API | `backend/src/controllers/getlinkJobController.js` |
| Worker, trạng thái và idempotency | `backend/src/utils/getlinkJobService.js` |
| Giao tiếp HTTP với nguồn | `backend/src/utils/3d66Service.js` |
| Chromium và phối hợp các context | `backend/src/utils/3d66BrowserService.js` |
| Đổi ID / lịch sử | `backend/src/utils/3d66RewrittenFootprintResolver.js` |
| Bộ sưu tập | `backend/src/utils/3d66CollectionResolver.js` |
| Kiểm tra account/ID/sign/ngữ cảnh tải | `backend/src/utils/3d66CleanLink.js` |
| Phân tích đầu vào và account marker | `backend/src/utils/parse3d66.js` |
| Đọc/chọn định dạng inline | `backend/src/utils/3d66InlineFormats.js` |
| Cookie pool và nhịp gọi nguồn | `backend/src/utils/3d66CookiePool.js` |
| Kiểm tra cấu trúc Cookie header | `backend/src/utils/3d66CookieHeader.js` |
| Hàng chờ tác vụ nguồn | `backend/src/utils/3d66Queue.js` |
| Context và snapshot RAM | `backend/src/utils/3d66BrowserSessionPool.js` |
| Snapshot đăng nhập mã hóa trên đĩa | `backend/src/utils/3d66BrowserProfileStore.js` |
| Phiên xác minh và relay chuột/ảnh | `backend/src/utils/3d66VerificationStore.js` |
| Kiểm tra và lưu phiên thủ công | `backend/src/utils/3d66VerificationService.js` |
| Giới hạn request của phiên thủ công | `backend/src/utils/3d66VerificationGuard.js` |
| Log chẩn đoán mạng phiên thủ công | `backend/src/utils/3d66VerificationDiagnostics.js` |
| Trừ Credit và tạo lịch sử | `backend/src/utils/getlinkChargeService.js` |
| Truyền file dùng chung | `backend/src/utils/getlinkDownloadTransfer.js`, `backend/src/utils/downloadTransfer.js` |
| Token tải web | `backend/src/utils/downloadToken.js` |
| Retention/archive | `backend/src/utils/historyRetentionService.js`, `backend/src/utils/historyRetentionJob.js` |
| Cài đặt lưu trong CSDL và áp vào runtime | `backend/src/controllers/settingsController.js` |
| Giao diện Getlink | `frontend/src/components/GetlinkBox.jsx` |
| Khôi phục bản nháp và request identity | `frontend/src/utils/getlinkDraft.js` |
| Theo dõi job ở client | `frontend/src/contexts/GetlinkJobContext.jsx` |
| Admin phiên xác minh | `frontend/src/components/Admin3D66Verification.jsx` |
| Chuyển tọa độ chuột | `frontend/src/utils/verificationPointer.js` |
| Khởi động display của backend | `backend/scripts/start-backend.sh` |
| Nginx tham chiếu | `ops/nginx/3dipl.conf` |

## 4. Kiến trúc và dữ liệu

```text
Web / Plugin
  -> API xác thực + kiểm tra user + rate limit
  -> preview hoặc GetlinkJob
  -> cookie pool + hàng chờ nguồn
  -> resolver đã chọn
  -> trang model có ngữ cảnh hợp lệ
  -> metadata + định dạng + giá
  -> user chọn / xác nhận
  -> resolve file từ nguồn
  -> transaction trừ Credit + tạo Getlink
  -> URL tải nội bộ 3DIPL
  -> VPS stream file nguồn về user
```

### 4.1. Nơi lưu dữ liệu

| Dữ liệu | Model / nơi lưu | Vai trò |
| --- | --- | --- |
| User, số dư | `User`, Core | Tài khoản và Credit |
| Cookie nguồn | `Cookie`, Core | Credential mã hóa; trạng thái active/warning/cooldown/disabled |
| Cài đặt | `SiteSetting`, Core, key `homepage` | Mode, marker, proxy, concurrency, tải lại, retention |
| Job | `GetlinkJob`, Core | Hàng chờ bền vững, trạng thái, request identity, kết quả |
| Lịch sử đã tạo | `Getlink`, Core | User, model, giá đã trừ, định dạng, các URL và số lần tải lại |
| Cache sản phẩm | `ProductCache`, Marketplace connection | Metadata, giá, định dạng, ngữ cảnh và link file có thể tái sử dụng |
| Manifest archive | `HistoryArchiveManifest`, Core | Theo dõi archive và xác minh trước khi xóa bản online |
| Phiên trình duyệt / xác minh | RAM của tiến trình backend | Không phải collection trong MongoDB |
| Snapshot đăng nhập | Volume VPS riêng, file `.enc` | Giữ cookie/localStorage qua restart |

`ProductCache` dùng `marketplaceModel()`, khác các model Getlink dùng connection Core mặc định. Khi chẩn đoán phải kiểm tra đúng database/connection; không suy ra vị trí collection chỉ từ tên file model.

### 4.2. Hai loại idempotency

- Job có khóa và fingerprint bền vững trong CSDL để chống gửi lại yêu cầu khác nội dung bằng cùng ID.
- Một số mutex, pending map, cache và browser pool vẫn chỉ có hiệu lực trong một tiến trình. Chúng không tự trở thành distributed lock khi tăng số backend replica.

## 5. Năm chế độ xử lý link

| Mode | Cách làm chính | Lưu ý |
| --- | --- | --- |
| `search` | Tìm URL qua tài khoản nguồn, chỉ thử các ID đã chuẩn hóa theo account | Hỗ trợ luồng nhập mã; tối đa bốn candidate duy nhất; không được lấy sign cũ ghép vào ID mới |
| `footprint` | Luồng lịch sử cũ; ở giai đoạn tải phù hợp có mở model/đọc footprint; miss nhất định có fallback search theo account | Preview và download không nhất thiết đi cùng nhánh; không đồng nhất với `rewritten_footprint` |
| `direct` | Dùng URL đã có account marker và sign hợp lệ về cấu trúc | Không đổi ID, không đọc lịch sử để làm sạch; vẫn có thể gọi HTTP/browser và gặp CAPTCHA |
| `collection` | Mở trang gửi vào, kiểm tra model, lưu vào đúng bộ sưu tập rồi lấy card đã ký | Có thay đổi favorites trên nguồn; không phải phương thức không-mutation |
| `rewritten_footprint` | Đổi ID trước khi truy cập, mở seed, đọc lịch sử, mở đúng card để lấy sign | Luồng mới được kiểm tra trong đợt này; không mở URL mang ID người gửi |

Không được mô tả “mọi mode đều không mở link user gửi”. Cam kết không mở raw input thuộc luồng `rewritten_footprint`; `direct` và `collection` có mục đích khác.

Mode được lưu trong Admin/CSDL có ưu tiên so với giá trị env dùng để khởi tạo. Chỉ sửa `backend.env` không bảo đảm thay được một lựa chọn đã lưu trong `SiteSetting`.

## 6. Luồng đổi ID rồi lấy từ lịch sử

### 6.1. Đầu vào và công thức

Chỉ nhận trang model HTTPS thực trên host `3d.3d66.com`, path `/reshtmla/model/items/<folder>/<name>.html`. Không dùng URL giả `/items/id/model.html` hoặc chỉ một mã ID cho mode này.

Ví dụ giả để giải thích công thức, **không phải model thật**:

```text
sof đầu vào:      GCI876543214629725
prefix:          GCI
ID người gửi:    87654321       (8 chữ số)
suffix model:    4629725
marker đích:     12345678       (ví dụ cấu hình)
sof sau xử lý:   ACI123456784629725
query seed:      ?sof=ACI123456784629725&st=2
```

Quy tắc hiện tại:

- Giữ nguyên origin/path đầu vào để tạo seed; path này chưa chắc là canonical path cuối.
- Thay chữ đầu prefix thành `A`; giữ hai chữ còn lại, chuẩn hóa viết hoa.
- Với ID dạng tracked: bỏ đúng tám chữ số sender, giữ toàn bộ suffix phía sau.
- Marker đích cấu hình được nhận 6-12 chữ số; độ dài này không đổi giả định sender tám chữ số.
- Với mã public ngắn có 5-8 chữ số sau prefix: giữ toàn bộ phần số làm suffix và chèn marker phía trước.
- Dạng số 9-12 chữ số sau prefix bị coi là mơ hồ và bị từ chối; không tự đoán cắt.
- Loại bỏ sign/query/fragment từ đầu vào khi dựng seed. Dùng `st=2`, không dùng cờ `st2`.
- Thiếu `sof`, trùng `sof`, `id` xung đột hoặc URL không đúng phạm vi đều dừng trước khi mở trang.

### 6.2. Các bước thực tế

1. Dùng raw input làm dữ liệu để tạo seed; không điều hướng tới raw input.
2. Mở seed bằng context đã đăng nhập.
3. Chờ trang ổn định ở mức có giới hạn. Seed có thể trống hoặc chuyển về một homepage HTTPS đã cho phép.
4. Kiểm tra trang xác minh; nếu bị CAPTCHA thì giữ đúng phiên để operator xử lý, không đi tiếp mua/tải.
5. Đọc footprint của tài khoản tại path `/newUser/index/index/footprint` trên `user.3d66.com`.
6. Tìm card có **toàn bộ `sof` đã đổi khớp chính xác**, không chỉ suffix và không lấy card đầu tiên tùy ý.
7. Nếu card đã có sign hợp lệ về cấu trúc thì dùng URL đó; nếu chưa có thì click đúng card để nguồn cấp sign.
8. Chấp nhận canonical path có thể khác path seed. Mọi bước vẫn phải giữ đúng toàn bộ ID model.
9. Trả kết quả đã ký để các bước metadata/format/download dùng tiếp.

Lịch sử được refresh có giới hạn, mặc định bốn lượt, tối đa tám; khoảng nghỉ mặc định 1.500 ms. Không chạy vòng lặp vô hạn hoặc mở lại raw input khi miss.

### 6.3. Sửa quan trọng tại `3981912`

**Seed về homepage không tự động là lỗi.** Đã quan sát được nguồn ghi model vào lịch sử trước khi chuyển về homepage. Code cũ kiểm tra landing quá sớm/khắt khe, có thể không đi tiếp sang lịch sử.

Các homepage seed được nhận là root, không có query, không credential, đúng HTTPS origin thuộc `3d66.com`, `www.3d66.com` hoặc `3d.3d66.com`. Trang login, origin lạ, port lạ hoặc model ID khác không được nhận như kết quả hợp lệ.

Điều hướng seed hiện được gọi riêng một lần. Trường hợp `ERR_ABORTED`/interrupted navigation chỉ được tiếp tục theo ngoại lệ hẹp khi landing đã ổn định ở homepage hợp lệ. Timeout hoặc lỗi mạng tùy ý không tự biến thành thành công.

**Link card lịch sử có thể redirect HTTP sang path khác và thêm sign.** Bản sửa theo dõi request cha/con đã quan sát bằng `redirectedFrom()` và `WeakSet`. Canonical path mới chỉ được tin trong chuỗi chuyển hướng của đúng request đã cho phép, với toàn bộ ID đúng và URL mới có sign hợp lệ về cấu trúc. Một navigation không có provenance phù hợp không được phép tự chọn model/path khác.

Playwright có thể chỉ route request đầu của chuỗi HTTP redirect, vì vậy code theo dõi cả sự kiện `request`, không chỉ route callback. Listener được gỡ sau thao tác.

**Popup có thể chưa có Frame ở request đầu.** Bộ chặn phiên thủ công nay cho phép GET tới đúng model đã giới hạn trong trường hợp này, thay vì chặn nhầm mọi popup. Không mở quyền tới host tùy ý, mua/tải, POST hoặc ID khác.

Homepage chỉ là bước trung gian. Nếu không tìm thấy đúng mục lịch sử, không có sign hoặc model cuối không hợp lệ thì không được cấp quyền tải.

## 7. Kiểm tra link sạch

### 7.1. Các lớp bảo vệ

`3d66CleanLink.js` kiểm tra trước khi tái sử dụng ngữ cảnh, gọi API tải, trừ Credit, ghi lịch sử, refresh hoặc stream:

- URL HTTPS nguồn phù hợp, không chứa username/password hoặc port không chuẩn.
- Chỉ một `sof`, account marker nằm đúng vị trí sau prefix và còn suffix đủ dài.
- Không có `id` xung đột với `sof`.
- Chỉ một `sign`, không rỗng, không khoảng trắng, không vượt giới hạn độ dài.
- ID trong payload tải phải bằng ID của URL đã xác minh.
- Record cache/lịch sử phải có `resolvedSourceUrl` đủ điều kiện; `sourceUrl` ban đầu không tự đủ làm bằng chứng.

Guard chung có kiểm tra quan hệ asset-family/suffix. Riêng luồng rewritten dùng thêm kiểm tra **toàn bộ ID chính xác** và path đã bind; không chỉ dựa vào quan hệ suffix của guard chung.

### 7.2. Giới hạn của từ “xác minh”

Backend kiểm tra cấu trúc, tài khoản và provenance của link; backend **không có khóa của 3D66 để tự xác minh mật mã giá trị sign**. Sign được lấy từ phản hồi/hành vi của nguồn, không tự tạo. Nguồn vẫn có quyền chấp nhận hoặc từ chối cookie/sign khi truy cập.

Có `sign` không đồng nghĩa trang đã tải được model hoặc tài khoản không bị hạn chế. Luồng hoàn tất xác minh thủ công còn kiểm tra DOM model và tài khoản đăng nhập qua API nguồn.

“Sạch” cũng không có nghĩa URL nhất thiết chỉ còn hai tham số. Không nên xóa hoặc sửa tùy ý các thành phần nguồn đã ký nếu chưa kiểm chứng semantics của nguồn.

### 7.3. Không fallback nguy hiểm

`THREED66_CLEAN_LINK_REQUIRED`, lỗi resolver rewritten và collection là các lỗi terminal theo luồng này: không tự dùng lại raw input, không ghép sign cũ với ID mới, không đổi cookie/proxy để vượt guard, không tự mua lại để chữa record bẩn.

## 8. Cookie và đổi tài khoản

### 8.1. Cấu trúc cookie hiện tại

Hai key bắt buộc để qua kiểm tra cấu trúc là `PHPSESSID` và `login_sign`. `login_token` là **tùy chọn**; nếu nguồn có gửi thì vẫn chuyển tiếp nguyên vẹn. Không được thêm một `login_token` giả chỉ để làm mất cảnh báo.

`userCookieData`, analytics cookie hoặc thời gian nhúng trong cookie do client cung cấp không được dùng làm bằng chứng đăng nhập thành công.

Kiểm tra tài khoản thật gọi GET cố định tới `/new-user-api/api/v1/user/info` trên `user.3d66.com`, không follow redirect. Cần response thành công, code 200, `data.basic.user_id` hợp lệ và marker suy ra khớp cấu hình. Cookie có đủ key nhưng user API thất bại vẫn chưa được coi là đã đăng nhập đúng.

### 8.2. Marker không phải user ID đăng nhập

Ô Admin **ID tài khoản trong link (sof)** nhận marker sau ba chữ cái, không phải toàn bộ `sof` và không nhất thiết bằng `user_id` của API.

Hàm `accountMarkerFromUserId()` hiện lấy chuỗi user ID số, bỏ chữ số cuối nếu có, đảo ngược phần còn lại rồi bỏ số 0 ở đầu. Đây là quy ước đang dùng trong code, không phải một giao thức chính thức được tài liệu nguồn bảo đảm vĩnh viễn.

Đổi marker không làm đăng nhập sang tài khoản khác. Khi đổi tài khoản phải kiểm tra cả cookie, marker và cấu hình collection nếu đang dùng collection.

### 8.3. Cookie pool

- Chỉ lấy cookie có value, đủ key, không disabled/inactive và không còn cooldown.
- Ưu tiên theo số lỗi, thời điểm dùng và thời điểm cập nhật.
- Nhịp khởi chạy tác vụ qua pool mặc định cách nhau 2.500 ms.
- Mặc định hai lỗi đủ điều kiện mới đưa cookie vào cooldown; thời gian nghỉ mặc định 30 phút.
- Ghi health có compare-and-swap theo value và trạng thái. Request cũ không được bật lại cookie đã bị admin thay hoặc tắt.
- Một số lỗi đăng nhập/quyền truy cập của các nhánh thông thường có thể thử cookie tiếp theo; **không suy ra mọi lỗi đều được rotate**.
- Lỗi clean-link/rewrite/collection không rotate và không tự đánh tụt cookie khỏe. Chờ xác minh không phải bằng chứng cookie hết hạn.
- Khi không còn cookie dùng được, hệ thống trả 503 và có cơ chế cảnh báo Telegram với cooldown; không tự xóa cookie để thử lại.

### 8.4. Đổi tài khoản an toàn

1. Đợi không có tác vụ nguồn đang xử lý; không đổi giữa lúc mua/resolve.
2. Kiểm tra tài khoản nguồn được phép sử dụng và còn truy cập bình thường.
3. Nhập cookie trong **Admin → Getlink → Cookie** và kiểm tra bằng chức năng có sẵn.
4. Lưu đúng marker trong **Getlink → Tác vụ**; với collection phải lưu đúng collection/AUI nữa.
5. Đóng phiên xác minh cũ khi không còn thao tác; cấu hình/account mới không được dùng nhầm phiên cũ.
6. Kiểm tra một model theo luồng chỉ đọc trước khi cho user dùng rộng rãi.

Không tự nhập archive noVNC vào Cookie pool, không lấy cookie của một account để ghép marker account khác.

## 9. Chromium, profile và chạy ngầm

### 9.1. Ba khái niệm không được gọi lẫn nhau

| Khái niệm | Thực chất |
| --- | --- |
| Headless | Chromium không dùng giao diện hiển thị thông thường |
| Headed qua Xvfb | Chromium có giao diện, nhưng hiển thị lên màn hình ảo bên trong VPS/container |
| noVNC | Cách operator nhìn/điều khiển một phiên qua remote desktop; bản thân noVNC không tạo bảo đảm đăng nhập/CAPTCHA |

Production đang được kiểm tra ở chế độ **headed qua Xvfb**. Việc user không nhìn thấy cửa sổ trên máy của mình không làm nó trở thành headless.

### 9.2. Browser context hiện dùng

- Full Chromium với `channel: "chromium"`, không dùng riêng headless-shell làm mặc định của luồng mới.
- Browser context có locale `zh-CN`, viewport `1400 × 800`, service worker bị chặn.
- Chromium dùng User-Agent native; không override `navigator.webdriver`, không thêm cờ che dấu `AutomationControlled`, không dùng stealth.
- Các HTTP request không qua browser trong `3d66Service.js` vẫn có User-Agent mặc định cấu hình trong code. Không được mô tả toàn bộ các lớp HTTP/browser là cùng một fingerprint hoàn hảo.
- Images/fonts/media mặc định không bị chặn; nếu có cấu hình `THREED66_BROWSER_BLOCK_ASSETS=true` thì hành vi khác. Vendor HTTPS của widget được giới hạn vào các domain đã cho phép, không mở mọi host.

### 9.3. Một browser không có nghĩa một tab chung cho mọi user

Có một Chromium được chia sẻ ở mức tiến trình nhưng nhiều context được quản lý và giới hạn. Khóa context chứa fingerprint cookie, configuration key và proxy; configuration key có marker, phiên bản profile, asset policy, allowlist, headed/headless và mode resolver.

Tác vụ cùng khóa được serialize. Cookie/account/config khác không chia sẻ context. Một context có thể có tab model và popup lịch sử liên quan; không nên tự đóng tab theo số thứ tự cố định.

Context bình thường idle khoảng 10 phút sẽ được thu hồi; snapshot RAM có TTL khoảng 30 phút. Chromium có giới hạn tuổi/số tác vụ và có thể recycle khi an toàn. Context idle chặn network cho đến khi được tác vụ kích hoạt lại.

### 9.4. Profile thực sự lưu những gì

Lưu cookie của domain nguồn và localStorage của các origin nguồn đang có trong frame. Không lưu toàn bộ user-data-dir, browser history, cache đĩa, sessionStorage, IndexedDB hoặc toàn bộ desktop session.

Snapshot không gọi `storageState()` theo cách tạo tab hỗ trợ; nó đọc các frame nguồn có sẵn. Điều này tránh việc tự mở/đóng tab phụ gây nhảy cửa sổ trong phiên thủ công.

```dotenv
THREED66_BROWSER_HEADLESS=false
THREED66_BROWSER_PROFILE_DIR=/var/lib/3dipl/getlink-profiles
```

Profile được mã hóa AES-256-GCM bằng `COOKIE_ENCRYPTION_KEY` hiện có, bind vào key phiên. Thư mục host UID/GID 1000, mode `0700`; file `.enc` mode `0600`, ghi thay thế nguyên tử. Có kiểm tra file/directory không an toàn, symlink, kích thước và envelope key.

Snapshot đĩa không có timer tự xóa. Đóng tab, cancel phiên, context idle hoặc restart backend **không có nghĩa phải xóa cookie trong database hay xóa profile đĩa**. Cookie vẫn có thể hết hạn hoặc bị nguồn thu hồi.

Profile hỏng/không đọc được phải báo lỗi, không âm thầm xóa để tạo phiên trắng. Không đổi khóa mã hóa nếu chưa có backup và phương án chuyển đổi được duyệt.

### 9.5. Khởi động và shutdown

`start-backend.sh` tạo Xvfb riêng khi yêu cầu headed và chưa có `DISPLAY`. X11 TCP bị tắt; dùng Xauthority tạm với quyền riêng tư. Không có cổng VNC/remote debugging public được mở bởi cơ chế này.

Node nhận tín hiệu dừng trước, có cơ hội drain tác vụ/lưu snapshot, rồi display mới dừng. Compose hiện đặt `stop_grace_period: 45s`; không nên kill cưỡng bức container lúc đang mua hoặc stream file.

## 10. CAPTCHA và xác minh thủ công

### 10.1. Điều đã biết và chưa biết

**Đã biết:** chạy headless với profile mới vẫn bị xác minh trong bài thử mới nhất. Headed đã đi hết luồng ở model đối chứng.

**Chưa biết:** nguyên nhân quyết định của phía nguồn. IP, thời điểm, trạng thái account, browser mode, cookie, storage, tốc độ, tài nguyên widget và nhiều tín hiệu khác có thể liên quan. Không có đủ dữ liệu để nói chắc “chỉ do thiếu header X” hoặc “chỉ do headless”.

Chưa có kiểm nghiệm có kiểm soát khẳng định sửa User-Agent/TLS/fingerprint sẽ giải quyết vấn đề. Đoạn Selenium che dấu automation và kéo slider tự động từng được đề xuất **không phải tính năng đã triển khai hoặc đã kiểm thử thành công**.

Cloudflare/Turnstile của chính web 3DIPL, device challenge của plugin và CAPTCHA/WAF trên trang nguồn là các lớp khác nhau. Tắt một kiểm tra phía 3DIPL không tự làm CAPTCHA của 3D66 biến mất.

### 10.2. Phát hiện và bàn giao

Khi phát hiện trang xác minh tại seed, lịch sử hoặc model mở từ lịch sử, error riêng giữ tham chiếu page bằng cơ chế private. Backend bàn giao **đúng page và context đang bị chặn**, không mở một trình duyệt mới rồi coi đó là phiên lỗi.

Direct cũng có luồng giữ phiên riêng khi đủ điều kiện bind đúng ID/path đã ký. Error code có thể vẫn là `THREED66_REWRITTEN_FOOTPRINT_FAILED` để giữ tương thích retry, nhưng stage Direct phải là `direct-model`.

Một phiên pending chặn thêm công việc sử dụng cùng credential/config trong luồng được bảo vệ. Không tự giải CAPTCHA, không tự thao tác slider và không coi HTTP 200 là đã pass.

### 10.3. Thao tác của operator

1. User/admin tạo lại request Getlink cần kiểm tra để tạo đúng phiên bị chặn.
2. Mở **Admin → Getlink → Cookie → các phiên xác minh Getlink**.
3. Claim/mở đúng phiên và tự thao tác. Có thể reload đúng page nếu widget chưa hiện; không có chức năng nhập URL tùy ý vào phiên này.
4. Khi nguồn cho truy cập, bấm **Kiểm tra và lưu phiên**.
5. Backend kiểm tra model đã ký, DOM model, tài khoản nguồn đúng marker và cookie chưa bị thay/tắt giữa chừng.
6. Cookie được cập nhật bằng compare-and-swap, profile được lưu theo luồng kiểm tra hiện tại, rồi mới báo thành công. User retry yêu cầu ban đầu một cách rõ ràng.

Đăng nhập đúng account là điều kiện cần nhưng chưa đủ. Chỉ nhìn chữ “thành công” trên một widget hoặc API relay chuột trả 200 không chứng minh nguồn đã cho mở model.

### 10.4. Giới hạn phiên và API điều khiển

| Giới hạn | Mặc định trong code |
| --- | --- |
| Phiên xác minh giữ lại | Tối đa 2 context |
| Phiên pending | Khoảng 15 phút |
| Lease của operator | 90 giây, được gia hạn khi thao tác hợp lệ |
| Context đã xác minh | 5 phút idle, giới hạn lifetime theo store |
| Request đang chờ trong một phiên | Có giới hạn, tránh thao tác chồng nhau |
| Ảnh | JPEG, timeout hữu hạn; retry một lỗi capture tạm thời được nhận diện |

API yêu cầu admin/allowlist, 2FA theo chính sách production, CSRF cho thao tác ghi, lease/token control riêng, rate limit và audit. Chỉ relay pointer có tọa độ/sequence hợp lệ. Không có API chạy JavaScript tùy ý, xuất cookie hoặc chọn host tùy ý.

Đóng dialog thường giải phóng quyền điều khiển; discard mới đóng context. Restart backend kết thúc tab/lease RAM, nhưng không đồng nghĩa xóa profile đã mã hóa.

### 10.5. Khi không thấy CAPTCHA hoặc kéo xong vẫn đỏ

Không lặp lại vô hạn. Kiểm tra đúng phiên, ảnh cập nhật, viewport/tọa độ, request widget bị policy block, response lỗi và trạng thái nguồn. Thông báo `验证失败，请刷新` là nguồn báo xác minh thất bại, không phải bằng chứng người dùng chưa kéo tới cuối.

`ERR_BLOCKED_BY_CLIENT` cần phân biệt với CAPTCHA: có thể là request bị bộ chặn nội bộ hoặc trình duyệt chặn. Phiên Admin cố ý không cho đi Google/host ngoài phạm vi; không mở toàn bộ allowlist chỉ để làm mất lỗi.

noVNC cũ qua SSH là một phiên khác nếu không có bàn giao cùng context. Pass ở noVNC không tự chứng minh context của Getlink đã pass. Archive noVNC riêng không được merge tự động vào production.

## 11. Preview và lựa chọn định dạng

### 11.1. Preview không chỉ là một ảnh

`POST /api/getlink/preview` lấy tên, ảnh, giá và `formatOptions`. Luồng hiện yêu cầu `includeFormatOptions: true` trong thao tác đọc nguồn tương ứng.

Nguồn có thể trả giá qua API `download/pop` nhưng không trả selector inline; selector nằm trong HTML hoặc được render chậm bằng JavaScript. Code có parser HTML, đọc DOM và bước chờ selector khi cần.

Nếu bước đọc định dạng bị xác minh, preview vẫn có thể thất bại dù API nhẹ đã đọc được giá/tên. Đây là coupling hiện có, không được báo “đã tách hoàn toàn metadata khỏi CAPTCHA” khi chưa sửa và kiểm thử riêng.

### 11.2. Selector inline

Nguồn dùng `.tp-multi-format-selector` và `.tp-multi-format-card` ngay trong trang model, không nhất thiết đợi mở popup mua như trước. Các field chính:

| Field | Nguồn / ý nghĩa |
| --- | --- |
| `fileFormat` | `data-file-format`, phải có giá trị dùng được, không phải `0` |
| `formatVersion` | `data-format-version` |
| `rendererType` | `data-renderer-type` |
| `label` | Tiêu đề card hoặc title |
| `size` | Dung lượng hiển thị |
| `isDefault` | Card active, nếu không có thì option đầu hợp lệ |
| `key` | `fileFormat|formatVersion|rendererType` |

Ví dụ key giả phục vụ kiểm thử: `1|2014|4` và `1|max2016|3`. Không chỉ dựa vào chữ VR/CR trên giao diện để gửi tải; phải giữ đúng tuple dữ liệu.

Nếu có nhiều lựa chọn mà chưa chọn, hệ thống trả `requiresFormatSelection` và không đi tiếp trừ Credit. Job chuyển sang `awaiting_format`; lựa chọn của user được kiểm tra lại ở backend.

### 11.3. Giao diện và ảnh tải kèm

Đổi đầu vào sẽ hủy preview cũ/loại response đến muộn. Bản nháp chỉ tái sử dụng preview tối đa 30 giây, cùng input và resolver mode; bản nháp legacy phải kiểm tra lại.

Ảnh preview hiển thị qua endpoint nội bộ khi phù hợp, thay vì coi link ảnh nguồn có hạn là ổn định vĩnh viễn. Ảnh tải kèm được convert thực sự sang JPEG bằng `sharp`, không chỉ đổi đuôi. Có timeout và giới hạn tải ảnh, mặc định tối đa 15 MiB ở controller.

Ảnh Getlink không phải cơ chế cover/preview của thư viện Model/Scene. Không trộn các cache/route để chữa nhầm lỗi hover của thư viện.

## 12. Job, hàng chờ và chống trùng

### 12.1. Trạng thái

```text
queued -> processing -> completed
                    -> awaiting_format -> queued
                    -> failed
queued / awaiting_format -> canceled (theo điều kiện API)
failed -> retry rõ ràng khi được phép
```

Stage chi tiết gồm `queued`, `validating`, `resolving_format`, `resolving_download`, `saving` và các stage terminal. Job lưu input, format, giá xác nhận của plugin, fingerprint, attempts, heartbeat, lịch retry và history ID.

### 12.2. Các giới hạn mặc định

| Hạng mục | Mặc định / hành vi |
| --- | --- |
| Một user | Một job active, gồm queued/processing/awaiting_format |
| Worker polling | 1.000 ms, có clamp trong code |
| Heartbeat processing | 15 giây |
| Stale processing | Mặc định 30 phút trước khi recovery |
| Số lần xử lý tối đa | Mặc định 3, có giới hạn cấu hình |
| Backoff retry đủ điều kiện | 10/30/90 giây theo lần thử |
| Chờ chọn format | Mặc định 24 giờ |
| Job terminal | Có `purgeAt`, mặc định sau 7 ngày |
| Queue source | Getlink/preview/refresh tách riêng; fallback concurrency 1 mỗi queue |
| Browser | Queue/concurrency riêng; giá trị Admin đã lưu có thể thấp hơn fallback của module |

Frontend hỏi trạng thái khoảng 2 giây khi đang ở Getlink và có job active, khoảng 10 giây trong trường hợp còn lại khi tab visible; focus lại sẽ refresh. Không yêu cầu giữ một HTTP request tạo link mở mãi.

### 12.3. Chống trừ trùng và retry sai

- `(userId, clientRequestId)` là khóa unique; fingerprint bind input, format, tùy chọn preview và giá xác nhận liên quan.
- Cùng ID nhưng payload khác trả conflict trước khi thực hiện việc mới.
- Job legacy thiếu fingerprint vẫn có compatibility xử lý riêng.
- Mutex user/model trong controller chặn hai create đồng thời trong cùng tiến trình.
- Pending file resolution phân biệt model, path và format; VRay/Corona không được chia sẻ nhầm kết quả đang chạy.
- Callback, polling hoặc thay đổi ngôn ngữ không được dùng job cũ ghi đè preview mới; acknowledge terminal job là thao tác riêng.
- Lỗi clean-link, rewritten/collection và đổi giá không được auto-retry như lỗi mạng thông thường.

Job TTL chỉ xóa record điều phối tạm; không đồng nghĩa xóa lịch sử Getlink đã thanh toán hoặc hoàn lại Credit.

## 13. Credit và tải lại

### 13.1. Thời điểm trừ

Preview, chờ chọn format và kiểm tra link không tự trừ Credit. Khi đã resolve kết quả file/ngữ cảnh đủ điều kiện, `chargeAndCreateGetlink()` kiểm tra lại rồi trừ Credit và tạo lịch sử.

**Getlink trừ khi tạo kết quả/lịch sử, không đợi trình duyệt nhận đủ file.** Do đó user có thể đã bị trừ Credit nhưng chưa bấm tải, download manager không khởi động, link HMAC hết hạn hoặc stream bị ngắt. Phải đối chiếu đúng loại lỗi, không mặc định mọi trường hợp đều là debit trùng.

Trên MongoDB hỗ trợ transaction, debit và history insert đi cùng transaction. Code có compensated fallback khi transaction không được hỗ trợ: nếu tạo lịch sử thất bại thì cộng bù; lỗi bù lại được log để xử lý. Điều này không tạo transaction phân tán với giao dịch phía 3D66.

Giá do backend lấy/đối chiếu từ dữ liệu nguồn, được normalize lên độ chính xác 0,1 Credit. Không áp dụng một mức giá cố định của thư viện Model/Scene. Plugin phải gửi `confirmedCreditCost`; giá thay đổi phải xác nhận lại, không tin giá browser/plugin tự khai.

Sau debit thành công có account invalidation event để web/plugin làm mới số dư; event không có nghĩa mọi tab luôn cập nhật đồng thời không độ trễ.

Service Credit Getlink hiện debit User và lưu record `Getlink`; không được giả định mỗi debit này còn tạo một `CreditLedgerEntry` của Marketplace. Khi tổng hợp timeline cần dùng đúng nguồn và tránh đếm trùng.

### 13.2. Tải lại của Getlink

Mặc định trong code/Cài đặt mới là **3 ngày** và **5 lượt tải lại**. Giá trị thực tế có thể đã được admin chỉnh.

- Mốc hết hạn dựa trên `createdAt` lịch sử cộng số ngày cấu hình, không phải entitlement 24 giờ của Marketplace.
- Lần tải đầu có `initialDownloadAt`, không tăng `redownloadCount` như một lượt tải lại thông thường.
- Các Range thuộc một phiên tải gần đây, cửa sổ 10 phút trong controller, có cơ chế dùng chung reservation để không đếm mỗi connection là một lượt mới.
- Reservation lượt tải đầu/tải lại được hoàn tác trong các nhánh lỗi stream tương ứng; không đồng nghĩa hoàn lại Credit đã trừ khi tạo Getlink.
- `prepareRedownload` có thể hỏi lại format hoặc refresh link nguồn; nó vẫn kiểm tra chủ lịch sử, hạn và số lượt.
- Đổi format trong cửa sổ tải lại có logic refresh hiện hành; không tự coi mọi format là cùng một file/cache.

### 13.3. Khi user nói “trừ tiền mà không thấy file”

Đối chiếu lần lượt job, `Getlink` history, thời điểm debit, URL tải nội bộ đã trả chưa, token còn hạn không, request file đã tới Nginx chưa và transfer có hoàn tất không. Nếu đã có history hợp lệ, ưu tiên cấp lại đường tải qua luồng tải lại; không gửi trực tiếp `fileUrl` nguồn hoặc chạy mua lại tùy tiện.

Chỉ hoàn Credit/sửa lịch sử khi đã xác minh và được duyệt; ghi audit. Không tự sửa số dư từ một ảnh chụp lỗi.

## 14. Truyền file

```text
Nguồn / CDN 3D66 -> backend VPS -> Nginx / đường public -> user hoặc plugin
```

Luồng Getlink được đọc trong code là proxy stream, không redirect user tới Drive/CDN nguồn. Drive là luồng storage của các tài nguyên thư viện, không phải lý do mặc định cho Getlink.

Cơ chế chèn comment/mã truy vết archive ở service download thư viện không tự được áp cho Getlink chỉ vì hai luồng dùng chung primitive stream. Luồng Getlink được mô tả ở đây không tự sửa toàn bộ file nén nguồn.

### 14.1. Quyền tải

Web có URL HMAC bind history ID, owner và thời hạn, mặc định 15 phút. Chủ tài khoản đã xác thực cũng có nhánh kiểm tra quyền. Link có token là credential tạm cho download manager; không nên chia sẻ công khai hoặc paste nguyên query vào hỗ trợ.

Plugin dùng bearer session và owner checks; route plugin xóa `t` trước khi đi vào controller, không cho lấy shared web token làm quyền sở hữu. Plugin còn có kiểm tra device/risk của chính hệ thống.

Hạn token và hạn quyền tải lại là hai mốc khác nhau: token hết hạn có thể cần lấy URL mới, không nhất thiết phải trả Credit lần nữa.

### 14.2. Cơ chế stream

- Dùng backpressure và buffer mặc định 256 KiB, không giữ toàn bộ archive trong RAM.
- Chuyển tiếp Range/If-Range, ETag và representation phù hợp; chỉ hỗ trợ range đơn hợp lệ theo limiter/parser.
- `Cache-Control: no-store, no-transform`, không nén lại archive trong luồng này.
- Lỗi 401/403 hoặc link nguồn hết hạn có nhánh refresh đã kiểm tra context; không lấy raw input làm quyền mua lại.
- Nguồn trả HTML/xác minh thay vì file phải bị chặn, không gửi trang lỗi dưới tên file nén.
- Hủy kết nối client kích hoạt AbortController để ngắt upstream khi thích hợp.

Full-file mặc định giới hạn 2/user và 4/IP; Range có thể tới 6 connection/user, 12/IP, vẫn bị chặn bởi tổng global mặc định 20. Đây là mặc định của code, không phải cam kết băng thông hoặc runtime đã kiểm tra mọi ô Admin.

### 14.3. Nginx và đo tốc độ

Location stream phải khớp `/api/getlink/download/:id` và `/api/plugin/getlink/download/:id`, tắt gzip/buffering/temp-file buffering, chuyển tiếp Range/If-Range và có timeout phù hợp. File mẫu nằm ở `ops/nginx/3dipl.conf`; không ghi đè toàn bộ cấu hình host đang chạy.

`GETLINK_DOWNLOAD_TRANSFER` có `completed`, `receivedBytes`, `firstByteMs`, `upstreamOpenMs`, `durationMs`, `proxyMiBPerSecond`. Đây là số đo pipeline ứng dụng, không chứng minh user đã lưu trọn file lên ổ đĩa hoặc tốc độ last-mile.

Phải tách hai loại chậm: **chờ lấy metadata/link** do resolver/queue/browser khác **truyền byte chậm** do upstream/VPS/Nginx/Cloudflare/ISP. Tăng concurrency không phải phương án sửa chung cho cả hai.

## 15. Các lớp cache

| Lớp | Phạm vi / thời gian quan trọng | Điều xóa/đổi có thể và không thể làm |
| --- | --- | --- |
| Preview draft ở web | Cùng input + mode; tối đa 30 giây | F5 không bảo đảm làm mới mọi cache backend |
| `ProductCache` | Metadata, format, ngữ cảnh và file link theo product | Xóa không xóa cookie/profile nhưng có thể tăng số lần gọi nguồn và ảnh hưởng tái sử dụng kết quả |
| Cache format | Version hiện tại `4`; có option: 24 giờ; empty: 30 giây | Không giữ kết quả rỗng vô hạn; record version cũ phải đọc lại |
| Cache URL đã resolve trong process | Khoảng 2 phút, tối đa 500 entry; key có account/cookie và dữ liệu mode liên quan | Restart backend làm mất cache RAM, không xóa record lịch sử |
| Pending map / locks | Chỉ tác vụ đang chạy | Không phải cache mua đã lưu và không được reset để vượt double-charge guard |
| Snapshot RAM browser | Khoảng 30 phút | Không đồng nghĩa cookie nguồn chắc chắn chưa hết hạn |
| Profile đĩa `.enc` | Không có TTL xóa tự động | Không phải cache sản phẩm; không xóa để chữa preview cũ |
| Browser context | Idle khoảng 10 phút | Tái sử dụng cập nhật phiên, không seed lại cookie cũ sau mỗi request |

`fileUrl` có thể có `auth_key`; code kiểm tra thời điểm hết hạn nhận diện được và có safety margin 300 giây. Không phải mọi kiểu link nguồn đều cung cấp cùng một thông tin hết hạn, nên phản hồi upstream vẫn cần kiểm tra.

### Xử lý khi nghi cache cũ

Đầu tiên xác định cache nào: input/mode trên client, metadata trong Marketplace, format version, resolved context hay file link hết hạn. Kiểm tra một product cụ thể trước.

Nếu cần purge ProductCache: thống nhất phạm vi, kiểm tra active jobs, backup đúng collection Marketplace và có phê duyệt trước khi xóa. Không xóa `Getlink`, `GetlinkJob`, `Cookie`, User hoặc profile chỉ để làm mới metadata. Không chạy migration/restore production tự động từ tài liệu này.

Tài liệu không cung cấp lệnh `deleteMany({})` để tránh nhầm cache với lịch sử đã trả tiền. Xóa cache không khôi phục link audit đã mất và không bảo đảm 3D66 hết CAPTCHA.

## 16. Lịch sử và archive

### 16.1. Nội dung cần giữ

Admin → Lịch sử tải → Getlink cần xem được URL user gửi (`sourceUrl`) và URL đã xử lý (`resolvedSourceUrl`). API public của user không trả nguyên toàn bộ URL/file link nguồn như record admin.

Retention hiện tại khi dọn chi tiết hết hạn chỉ unset `fileUrl` và `imageUrl`, đánh dấu `detailsPurgedAt`; giữ hai page URL phục vụ audit.

Mặc định dọn chi tiết sau khi hết cửa sổ tải lại cộng thêm một ngày. Archive lịch sử mặc định sau khi hết cửa sổ tải lại cộng thêm 365 ngày; giá trị `0` ở các setting liên quan có semantics tắt bước đó trong code.

### 16.2. Archive

Archive dạng JSONL gzip theo nhóm thời gian, có checksum và manifest. Chỉ xóa online sau quy trình upload/đọc lại/xác minh theo service. Job retention mặc định lên lịch khoảng 02:30 giờ Việt Nam; có cờ tắt và cờ chạy lúc startup.

Nếu dữ liệu cũ từng bị code trước đây unset `sourceUrl`/`resolvedSourceUrl`, sửa UI hoặc code giữ link không thể tự tạo lại dữ liệu đã mất. Cần đọc backup/archive còn thực sự chứa trường đó. Archive được tạo sau khi field đã bị xóa cũng có thể không có chúng.

Nếu chỉ cần xem dữ liệu cũ, ưu tiên xuất/đọc một bản backup trong môi trường cô lập, không restore đè production và không trộn lịch sử hai hệ thống.

## 17. API

### 17.1. Web

| Method / path | Vai trò |
| --- | --- |
| `POST /api/getlink/preview` | Preview tên, ảnh, giá, format |
| `POST /api/getlink/inspect` | Chẩn đoán trang, chỉ admin; không dùng như response public |
| `POST /api/getlink/jobs` | Tạo/replay job theo clientRequestId |
| `GET /api/getlink/jobs/latest` | Khôi phục job đang theo dõi |
| `GET /api/getlink/jobs/:id` | Đọc job thuộc user |
| `POST /api/getlink/jobs/:id/format` | Chọn format bằng `formatKey` |
| `POST /api/getlink/jobs/:id/retry` | Retry có kiểm tra điều kiện |
| `POST /api/getlink/jobs/:id/cancel` | Cancel theo trạng thái cho phép |
| `POST /api/getlink/jobs/:id/acknowledge` | Acknowledge kết quả terminal |
| `POST /api/getlink` | Luồng tạo kết quả đồng bộ còn được giữ |
| `POST /api/getlink/redownload/:id` | Chuẩn bị tải lại và chọn format nếu cần |
| `GET /api/getlink/download/:id` | Stream file, kiểm tra owner hoặc HMAC phù hợp |
| `GET /api/getlink/preview-image/:id` | Tải ảnh kèm JPEG |
| `GET /api/getlink/preview-cache/:productId` | Proxy ảnh preview có xác thực |
| `GET /api/getlink/history` | Lịch sử public của chủ tài khoản |

Các thao tác tạo có kiểm tra đăng nhập, banned, validation, CSRF theo middleware ứng dụng và rate limit. Không được suy ra route tải không có `requireAuth` nghĩa là file public: quyền tải được controller kiểm tra bằng owner/token.

Ở lớp route Getlink riêng, preview mặc định 30 request/phút và giới hạn IP mặc định 180/phút; create 10/phút và IP mặc định 60/phút; download limiter route mặc định 30/phút. Còn có các lớp giới hạn chung và connection limiter, nên đây không phải một hạn mức dịch vụ duy nhất áp được cho mọi endpoint/plugin.

### 17.2. Plugin

Có các route tương ứng dưới `/api/plugin/getlink/` cho preview, jobs, chọn format, retry/cancel/acknowledge, history, redownload, download và ảnh. Dùng chung service Getlink và quyền user, không dùng một ví Credit riêng.

Plugin phải gửi giá xác nhận khi tạo job và dùng idempotency. Device yêu cầu xác thực lại có thể nhận `DEVICE_REAUTH_REQUIRED`; đó không phải CAPTCHA của nguồn 3D66.

### 17.3. Admin

| Method / path | Vai trò |
| --- | --- |
| `GET /api/admin/getlinks` | Lịch sử Getlink của admin |
| `GET /api/admin/cookies` | Danh sách cookie được che thông tin |
| `GET /api/admin/cookies/status` | Health pool và số liệu queue |
| `POST /api/admin/cookie` | Lưu cookie nguồn |
| `POST /api/admin/cookie/test` | Kiểm tra cookie nhập / cookie lựa chọn theo controller |
| `POST /api/admin/cookies/:id/test` | Kiểm tra cookie đã lưu |
| `DELETE /api/admin/cookies/:id` | Xóa cookie do admin yêu cầu rõ ràng |
| `GET /api/admin/getlink/verifications` | Danh sách phiên xác minh |
| `POST /api/admin/getlink/verifications/:id/claim` | Claim phiên |
| `POST /api/admin/getlink/verifications/:id/frame` | Ảnh của phiên |
| `POST /api/admin/getlink/verifications/:id/input` | Relay pointer có giới hạn |
| `POST /api/admin/getlink/verifications/:id/reload` | Reload đúng page |
| `POST /api/admin/getlink/verifications/:id/complete` | Kiểm tra và lưu phiên |
| `POST /api/admin/getlink/verifications/:id/release` | Nhả quyền operator |
| `DELETE /api/admin/getlink/verifications/:id` | Discard phiên |
| `GET /api/settings` | Snapshot public hoặc admin theo quyền |
| `POST /api/settings` | Cập nhật setting được phép; yêu cầu admin |

Không paste claim token, ảnh có dữ liệu account, response inspect hoặc link download thật vào issue công khai.

## 18. Admin và cấu hình

### 18.1. Ưu tiên cấu hình

`settingsController.js` nạp các giá trị đã lưu và áp vào `process.env` của **tiến trình server đang chạy**. Một lệnh `docker exec ... node -e` tạo tiến trình Node mới chỉ thấy environment của container, không tự có mọi giá trị runtime đã áp trong server.

Vì vậy cần phân biệt: env file host, env container, `SiteSetting` trong Core và runtime của server. Đây là lý do có thể sửa env/restart mà Admin vẫn giữ mode cũ. Setting Admin đã lưu được ưu tiên theo luồng khởi tạo/cập nhật hiện tại.

### 18.2. Nhóm cấu hình chính

| Khu vực | Setting / env chính |
| --- | --- |
| Resolver | `threed66ModelResolveMode` / `THREED66_MODEL_RESOLVE_MODE` |
| Marker đích | `threed66RequiredAccountMarker` / `THREED66_REQUIRED_ACCOUNT_MARKER`; áp chung guard và account search |
| Collection | `threed66CollectionId`, `threed66CollectionUser` / `THREED66_COLLECTION_ID`, `THREED66_COLLECTION_USER` |
| Queue nguồn | `THREED66_GETLINK_CONCURRENCY`, `THREED66_PREVIEW_CONCURRENCY`, `THREED66_REFRESH_CONCURRENCY` |
| Nhịp gọi | `THREED66_REQUEST_INTERVAL_MS` |
| Browser usage | `THREED66_BROWSER_ALWAYS`, `THREED66_DISABLE_BROWSER_PAGE_FALLBACK`, `THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK`, `THREED66_DOWNLOAD_HANDLE_BROWSER_FALLBACK` |
| Browser capacity | `THREED66_BROWSER_CONCURRENCY`, `THREED66_BROWSER_QUEUE_MAX`, `THREED66_BROWSER_MAX_TASKS`, `THREED66_BROWSER_MAX_AGE_MS` |
| Navigation | `THREED66_TIMEOUT_MS`, `THREED66_BROWSER_WAIT_UNTIL`, `THREED66_BROWSER_POST_COMMIT_WAIT_MS`, `THREED66_BROWSER_NAV_RETRIES`, `THREED66_BROWSER_RETRY_DELAY_MS` |
| Lịch sử | `THREED66_FOOTPRINT_REFRESH_ATTEMPTS`, `THREED66_FOOTPRINT_REFRESH_DELAY_MS` |
| Cookie health | `THREED66_COOKIE_MAX_FAILURES`, `THREED66_COOKIE_COOLDOWN_MS` |
| Ví nguồn | `THREED66_PAYTYPE_VALUE`, mặc định code `4`; không phải phương thức nạp tiền web |
| Proxy | `THREED66_PROXY_ENABLED`, `THREED66_PROXY_URL`, các cờ `FOR_PREVIEW`, `FOR_API`, `FOR_DOWNLOAD`, `FOR_BROWSER`, `THREED66_PROXY_FAIL_CLOSED` |
| Display và persistence | `THREED66_BROWSER_HEADLESS`, `THREED66_BROWSER_PROFILE_DIR`, `COOKIE_ENCRYPTION_KEY` |
| Tải lại | `getlinkRedownloadDays`, `getlinkRedownloadLimit` / `GETLINK_REDOWNLOAD_DAYS`, `GETLINK_REDOWNLOAD_LIMIT` |
| Truyền file | `MAX_GLOBAL_DOWNLOADS`, `MAX_DOWNLOADS_PER_USER`, `MAX_DOWNLOADS_PER_IP`, `MAX_DOWNLOAD_RANGE_CONNECTIONS_PER_USER`, `MAX_DOWNLOAD_RANGE_CONNECTIONS_PER_IP` |
| Worker | `GETLINK_JOB_ENABLED`, `GETLINK_JOB_POLL_INTERVAL_MS`, `GETLINK_JOB_STALE_MS`, `GETLINK_JOB_MAX_ATTEMPTS` |
| Retention | Các field retention của `SiteSetting`, `HISTORY_RETENTION_JOB_ENABLED`, `HISTORY_RETENTION_RUN_ON_START`, `HISTORY_ARCHIVE_DRIVE_FOLDER_ID` |

Danh sách này là bản đồ các nhóm quan trọng, không phải file `.env` hoàn chỉnh để copy ghi đè. Có biến được Admin điều khiển, có biến chỉ ở env; cần đối chiếu code trước khi sửa.

Ba lựa chọn “Playwright tắt/tự động/luôn dùng” trong Admin điều khiển **việc dùng browser hay HTTP**, khác cờ headed/headless. Resolver rewritten/collection bản thân đã cần browser; tắt fallback không biến các resolver đó thành thuần HTTP.

Không in proxy URL chứa credential. Không nới proxy/host để né việc nguồn từ chối truy cập. Fallback proxy của HTTP thông thường và việc resolver không retry toàn thao tác qua proxy khác là hai lớp khác nhau; cần xem đúng nhánh.

## 19. Sự cố đã gặp

| Triệu chứng | Điều đã biết / bản sửa | Điều không nên kết luận |
| --- | --- | --- |
| Cookie mới thiếu `login_token` | Key này là tùy chọn; sửa kiểm tra sai, giữ kiểm tra account API | Không thêm token giả; đủ key không đồng nghĩa đăng nhập |
| Đổi cookie khác thì không tìm thấy model trong lịch sử | Lịch sử/account/path riêng; có các resolver và kiểm tra marker | Không lấy card bất kỳ cùng suffix để trả kết quả |
| `st2` thay vì `st=2` | Đã sửa serialize query và regression test | Không coi hai dạng là tương đương |
| Seed mở được rồi về homepage trống | Có thể đã ghi footprint; `3981912` cho tiếp tục đúng lịch sử | Homepage không phải kết quả đã ký hay bằng chứng pass CAPTCHA |
| Card lịch sử chưa có sign | Click đúng card; nguồn có thể redirect HTTP sang path mới và thêm sign | Không ghép sign cũ, không giả chữ ký |
| `opened_model_mismatch` khi cùng model nhưng path đổi | Reproduce được redirect từ đúng history request; `3981912` theo provenance và ID đầy đủ | Không cho phép mọi navigation khác path không có provenance |
| Popup request bị chặn khi Frame chưa tồn tại | `3981912` nhận GET đúng scoped model trong trường hợp này | Không mở mọi popup/host |
| Hai lỗi 502 tối 03/11 | Message chung `history_operation_interrupted` trước đây làm mất nguyên nhân gốc | Không thể khẳng định cả hai lỗi cũ cùng nguyên nhân chỉ dựa message; lỗi tái hiện mới đã có bằng chứng riêng |
| Preview không hiện VRay/Corona | Nguồn chuyển selector vào DOM inline; đã thêm đọc/chờ selector và version cache format | Không luôn đợi popup mua mới đọc format |
| Preview hiện cũ hoặc lựa chọn format loạn | Có bản sửa draft TTL, cancel request cũ, tách pending theo format, không cache empty lâu | F5/xóa profile không phải purge đúng ProductCache |
| noVNC pass nhưng Getlink bị CAPTCHA | Có thể là hai context/mode/state khác nhau; hiện có bàn giao đúng phiên và snapshot | Chưa chứng minh nguồn “chỉ kiểm một header”; noVNC không phải cơ chế bảo đảm pass |
| Kéo thủ công xong vẫn đỏ | Có sửa pointer scaling, foreground/capture và thêm network diagnostics | Relay pointer 200 không đồng nghĩa nguồn xác nhận thành công |
| Tự nhảy tab rồi đóng | Đã bỏ việc tạo utility tab khi snapshot; quản lý vòng đời context rõ hơn | Không nên xóa mọi cookie hoặc đóng mọi tab để chữa |
| Link bị hạn chế nhưng cookie còn đủ key | Cookie/account API, model access và xác minh là các điều kiện khác nhau | Không tự đánh dấu account an toàn chỉ vì parse cookie được |
| User bị trừ Credit mà chưa nhận file | Getlink charge ở lúc tạo lịch sử; cần kiểm tra download/token/stream sau đó | Không tự khẳng định đã debit trùng hoặc đã hoàn tiền |
| Stream `terminated` hoặc file chậm | Phân biệt abort, upstream cắt, proxy buffering, Range, băng thông | HTTP 200 hoặc nhiều byte không chứng minh tải hoàn tất |
| Admin không thấy link cũ | Retention cũ có thể đã làm mất field; bản hiện tại giữ page URL | Sửa UI không khôi phục field đã bị xóa trước đây |

## 20. Kết quả kiểm thử

### 20.1. Các mốc mã nguồn liên quan

| Commit | Nội dung chính |
| --- | --- |
| `83fb8a6` | Dùng đúng `st=2` cho seed |
| `fe7763e` | Đọc/chọn format inline trước checkout |
| `ee8179f` | Chờ định dạng, từ chối preview bị chặn |
| `95109a8` | Giữ phiên Direct để xác minh thủ công |
| `ff3966c` | Native Chromium và tái sử dụng browser session |
| `9953612` | Tọa độ pointer và khung Admin |
| `9a4b542` | Network diagnostics an toàn |
| `9684aeb` | Headed display và snapshot đăng nhập mã hóa |
| `4c4aad3` | Foreground phiên, retry hữu hạn lỗi screenshot tạm |
| `3981912` | Homepage seed, canonical HTTP redirect, popup chưa có Frame và diagnostic stage |

### 20.2. Test tự động

`npm run check` của bản `3981912` đã đạt **864 test, 0 fail, 0 skip**, lint và frontend build/artifact check đạt. Đây là kết quả lần chạy đó, không phải một lần chạy mới trong lúc viết tài liệu này.

Các nhóm regression quan trọng có prefix `3d66-`, `getlink-`, `plugin-getlink` trong `backend/test`. Bao gồm marker/sign, đúng model, cookie compatibility, profile persistence/isolation, context lifecycle, manual verification, pointer, chọn format, cache, job fingerprint, debit/history, download HTTP/Range và giữ link audit.

Lần chạy sandbox đầu gặp `EACCES` khi fixture kết nối localhost và quyền symlink; chạy lại với quyền thích hợp đạt. Không chữa bằng cách xóa các test hoặc tắt guard.

Những smoke UI VI/EN, sáng/tối, desktop/mobile của các đợt trước dùng mock/local fixture. **Đợt `3981912` không được mô tả là đã chạy lại toàn bộ smoke UI chỉ vì build frontend đạt.**

### 20.3. Bài thử nguồn thật ngày 03-04/11

| Bài thử | Phạm vi | Kết quả |
| --- | --- | --- |
| Browser lifecycle fixture trên VPS | Mock route, không mua/tải nguồn | Qua được đóng context rồi tái sử dụng browser |
| Seed của model báo lỗi | Đổi ID trước, profile chỉ đọc | Seed về homepage, đúng model có trong history; card lúc đọc chưa có sign |
| Theo dõi click history trước bản vá | Chỉ đúng model, chặn API mua/tải | Quan sát được request history chuyển hướng HTTP sang path khác của cùng full ID và có sign; guard cũ chặn nhầm |
| Chạy luồng mới bằng image `3981912` | Container tạm, snapshot chỉ đọc, không nối CSDL để mua/tải | `originalVisited=false`, có sign, full ID khớp, canonical khớp, DOM model có; khoảng 12 giây |
| Headless với cùng snapshot và code mới | Full Chromium headless, không stealth, profile chỉ đọc | `upstream_verification_required` ngay `seed_navigation`; dừng, không retry kéo CAPTCHA |
| Sau thử headless | Kiểm tra backend production | `productionHeadless=false`, readiness thành công |

Kiểm tra chỉ đọc không xác nhận một giao dịch mua thật hoặc file archive đã tải xong. Các bài thử không tự đổi cookie production, không bật headless cho user và không tự giải CAPTCHA.

## 21. Giới hạn và việc còn lại

### 21.1. Những điều chưa được bảo đảm

- Chưa có bảo đảm CAPTCHA-free cho mọi model/account/thời điểm; headless hiện chưa đạt bài đối chứng.
- Profile chỉ bao phủ cookie/localStorage nguồn, không phải clone toàn bộ browser/noVNC.
- Không thể khôi phục lịch sử URL cũ nếu mọi backup/archive còn lại đều đã thiếu field đó.
- Chưa có benchmark tải lớn cho mọi ISP và mọi file; số đo pipeline không phải tốc độ user cuối.
- Không có transaction phân tán giữa việc nguồn cấp/mua file và commit Credit/history của web. Crash ở ranh giới này cần đối soát, không được tuyên bố exactly-once tuyệt đối từ một mutex RAM.
- Phiên xác minh, context pool và nhiều khóa vẫn nằm ở một process. Chưa có kiến trúc multi-replica hoàn chỉnh cho điều khiển cùng browser.
- Tắt/dổi proxy hoặc browser mode tạo configuration key khác. Không được tự chọn file `.enc` của account/config khác chỉ vì tên file mới hơn.

### 21.2. Các ưu tiên tiếp theo, chưa phải việc đã triển khai

1. Đánh giá tách preview metadata và việc đọc format bị chặn, nhưng không cho user mua khi format/giá/ngữ cảnh chưa được xác thực.
2. Bổ sung QA browser HTTP redirect fixture độc lập để kiểm tra thêm hành vi thật của Playwright ngoài mock unit, nếu tiếp tục đổi popup/resolver.
3. Rà soát khoảng crash sau khi nguồn đã cấp/mua nhưng local chưa commit; thiết kế đối soát trước khi tăng retry/concurrency.
4. Nếu tăng replica: bổ sung distributed locking, quyền sở hữu session, routing nhất quán và quota tài nguyên chung.
5. Chuẩn hóa telemetry theo stage. Error object mới có `operation`/`failure`/`networkCode` an toàn, nhưng `diagnosticSystemLogDetails()` trong controller hiện chỉ copy một số field và upstream stage; không giả định mọi field đã xuất hiện ở màn hình SystemLog Admin.
6. Tăng đo thời gian từng chặng và tốc độ truyền với mẫu có giới hạn, không tạo giao dịch nguồn thật chỉ để benchmark.
7. Khi nguồn đổi HTML/API: cập nhật fixture trước, giữ guard full-ID, sign, owner và Credit; không sửa bằng cách bỏ validation.

Đây là danh sách định hướng/giới hạn, không phải kết quả security audit toàn hệ thống.

## 22. Kiểm tra VPS

Các lệnh dưới chỉ đọc. Chạy từ `/opt/3dipl/app`; dùng đúng quyền truy cập, không paste credential vào tài liệu/log công khai.

### 22.1. Phiên bản và sức khỏe

```bash
cd /opt/3dipl/app
git rev-parse --short HEAD
git log -1 --oneline
sudo docker compose -f compose.production.yml ps backend frontend mongo meilisearch
curl --noproxy '*' -fsS --max-time 10 http://127.0.0.1:5000/ready
df -h /
sudo docker stats --no-stream
```

Git HEAD của thư mục host không tự chứng minh image đang chạy có cùng code. Phải build/recreate và kiểm tra module/container khi cần. Readiness chỉ xác nhận dịch vụ/DB theo endpoint, không kiểm tra đăng nhập hoặc model trên 3D66.

### 22.2. Display và số profile, không lộ secret

```bash
sudo docker compose -f compose.production.yml exec -T backend \
node --input-type=module -e '
import fs from "node:fs/promises";
const directory = process.env.THREED66_BROWSER_PROFILE_DIR || "";
const files = directory
  ? (await fs.readdir(directory)).filter(name => /^[a-f0-9]{64}\.enc$/.test(name))
  : [];
console.log({
  headless: process.env.THREED66_BROWSER_HEADLESS,
  persistenceConfigured: Boolean(directory),
  encryptedProfileCount: files.length
});
' </dev/null
```

Không in `COOKIE_ENCRYPTION_KEY`, nội dung `.enc`, toàn bộ `.Config.Env` hay dump Cookie collection. Profile count không cho biết profile nào đúng cho account/config đang chọn.

### 22.3. Setting thực tế, cookie count và job status

```bash
sudo docker compose -f compose.production.yml exec -T backend \
node --input-type=module -e '
import { connectDb, closeDbConnections } from "./src/config/db.js";
await connectDb();
try {
  const { default: SiteSetting } = await import("./src/models/SiteSetting.js");
  const { default: Cookie } = await import("./src/models/Cookie.js");
  const { default: GetlinkJob } = await import("./src/models/GetlinkJob.js");
  const settings = await SiteSetting.findOne({ key: "homepage" })
    .select("threed66ModelResolveMode getlinkRedownloadDays getlinkRedownloadLimit")
    .lean();
  const jobs = await GetlinkJob.aggregate([
    { $match: { status: { $in: ["queued", "processing", "awaiting_format"] } } },
    { $group: { _id: "$status", count: { $sum: 1 } } }
  ]);
  console.log({
    settings,
    cookieCount: await Cookie.countDocuments({}),
    activeJobs: jobs
  });
} finally {
  await closeDbConnections();
}
' </dev/null
```

Các model được import sau `connectDb()` để giảm nguy cơ kiểm tra nhầm connection trong những công cụ hỗ trợ nhiều database. Lệnh này không xuất cookie, input người dùng, source URL hoặc token.

### 22.4. Log chẩn đoán

```bash
sudo docker compose -f compose.production.yml logs --since=30m backend \
  | grep -E 'THREED66_VERIFICATION_NETWORK|GETLINK_DOWNLOAD_TRANSFER|THREED66_PROFILE_'
```

Network diagnostics của phiên thủ công chỉ ghi session ID nội bộ, host an toàn/`external`, method, resource type, kind và status/error code; deduplicate, tối đa 20 loại event mỗi phút/context. Không ghi path, query, cookie, body hoặc header.

Điều này **không** bảo đảm mọi log khác, access log Nginx hoặc raw Playwright error đều đã được loại credential. Trước khi chia sẻ log tổng phải che `t=`, `sign`, `auth_key`, cookie, Authorization và URL đăng nhập. Dùng correlation ID và giờ để đối chiếu; giờ VN và timestamp UTC của server lệch 7 giờ.

Phân loại nhanh:

| Mã / dữ liệu | Cách hiểu |
| --- | --- |
| `THREED66_CLEAN_LINK_REQUIRED` | Thiếu/sai ngữ cảnh account, model hoặc sign; không bỏ guard |
| `THREED66_REWRITTEN_FOOTPRINT_FAILED` + `upstream_verification_required` | Nguồn yêu cầu xác minh; có thể cần phiên Admin |
| Cùng code + `upstream_verification_pending` | Có phiên đang chờ; không spam thêm job |
| Cùng code + `signed_model_not_found_in_history` | History không có đúng model sau số lượt đọc giới hạn |
| Cùng code + `history_operation_interrupted` | Xem `operation`, `failure`, `networkCode` nếu có trong error log mới |
| `opened_model_mismatch` | ID/path/provenance không đạt; xem chuỗi redirect, không nới sang mọi model |
| `THREED66_PROFILE_*` | Profile/key/quyền/file không đạt; giữ dữ liệu để kiểm tra, không tự xóa |
| `THREED66_VERIFICATION_SESSION` | Lease, account/config, cookie CAS hoặc lưu phiên chưa đạt |
| `THREED66_FORMAT_UNAVAILABLE` | Format đã chọn không còn hợp lệ; preview lại |
| `GETLINK_PRICE_CHANGED` | Plugin cần xác nhận giá mới |
| `GETLINK_JOB_ACTIVE` | User đã có job active |
| `GETLINK_IDEMPOTENCY_CONFLICT` | Cùng request ID nhưng input/format/tùy chọn khác |
| `THREED66_SESSION_INVALID` | Kiểm tra account API báo phiên chưa đăng nhập hoặc redirect login |
| `THREED66_COOKIE_ACCOUNT_MISMATCH` | Cookie đăng nhập account không khớp marker cấu hình |
| `THREED66_AUTH_UNAVAILABLE` | Chưa xác minh được account API; không mặc định là cookie chắc chắn hết hạn |
| HTTP 402 | Thiếu Credit |
| HTTP 429 | Xem rate limit, queue hay download slots; không mặc định là quota Subscription |
| `GETLINK_DOWNLOAD_TRANSFER`, `completed=false` | Stream chưa hoàn tất; đọc số byte và các chặng, không chỉ status đầu |

### 22.5. Cách thử headed/headless an toàn

Không đổi `backend.env` rồi restart production chỉ để làm A/B. Bài thử phù hợp là container tạm dùng đúng image đang chạy, timeout hữu hạn, snapshot đúng account gắn read-only, không có quyền ghi Cookie/credit/history, có guard chặn mua/tải và không log sign/cookie.

Chỉ thay browser mode trong container thử. Giữ lại URL làm dữ liệu để dựng seed, không mở raw user URL trong luồng rewritten. Dừng nếu nguồn yêu cầu xác minh; không thêm stealth, giả fingerprint hoặc tự kéo CAPTCHA để biến bài thử thành vượt kiểm soát truy cập.

Không đưa một script chẩn đoán có credential inline vào Git. Nếu nhiều profile, không chọn bừa `.enc` đầu tiên hoặc mới nhất; phải chứng minh binding account/config trước khi thử.

## 23. Triển khai và rollback

### 23.1. Trước triển khai

- Kiểm tra diff/worktree; giữ nguyên thay đổi không liên quan.
- Chạy test mock/local, không chạy suite tự động lên DB production hoặc mua thật.
- Đợi job đang chạy và các stream quan trọng kết thúc; ghi nhận phiên xác minh RAM sẽ bị đóng khi restart.
- Đảm bảo profile volume còn nguyên và khóa mã hóa không đổi.
- Giữ tag image cũ; kiểm tra dung lượng đĩa trước build.
- Xác nhận commit định triển khai đã được review/push; không tự publish một phần chưa được chấp thuận.

### 23.2. Backend-only khi thay đổi chỉ ở backend

Sau khi đã đáp ứng các điều kiện trên và được phép triển khai:

```bash
bash <<'BASH'
set -euo pipefail
cd /opt/3dipl/app

git pull --ff-only origin main
git log -1 --oneline

stamp="$(date +%Y%m%d-%H%M%S)"
previous_image="$(sudo docker inspect -f '{{.Image}}' 3dipl-backend)"
rollback_tag="3dipl-backend:getlink-before-${stamp}"
sudo docker image tag "$previous_image" "$rollback_tag"
printf 'Rollback image: %s\n' "$rollback_tag"

sudo docker compose -f compose.production.yml build backend </dev/null
sudo docker compose -f compose.production.yml run --rm --no-deps \
  --interactive=false -T -e NODE_ENV=production \
  backend npm run env:check </dev/null

sudo docker compose -f compose.production.yml up -d \
  --no-deps --force-recreate --wait --wait-timeout 180 backend </dev/null

curl --noproxy '*' -fsS --max-time 10 http://127.0.0.1:5000/ready
BASH
```

Khi thay giao diện Admin/Getlink thì cần build/recreate frontend tương ứng và chạy smoke UI phù hợp. Bản `3981912` chỉ cần backend; không vì có lệnh trên mà tự redeploy mọi service, DB hoặc Meilisearch.

`docker compose restart` không reload env file của Compose. Thay env cần recreate và env check. Thay giá trị đã lưu trong Admin có luồng runtime khác, không nhất thiết cần restart.

### 23.3. Sau triển khai

Kiểm tra `/ready`, health/restart count, image đang chạy đúng bản đã build, cookie count/value digest khi cần nhưng không xuất value, mode thực tế trong CSDL, volume và quyền profile. Kiểm tra log mới, không suy ra hết lỗi chỉ từ một request cũ trước deploy.

Một bài thử nguồn thật phải có phạm vi riêng: đúng một model, chỉ đọc khi chưa được phép mua/tải, không gây charge hoặc tăng counter user chỉ để đo. Việc “đọc được model” và “đã tải được file thật” là hai tiêu chí khác nhau.

### 23.4. Rollback

Ưu tiên rollback image backend tương thích, giữ dữ liệu. Đợt triển khai `3981912` đã tạo tag `3dipl-backend:pre-history-3981912`; cần kiểm tra tag còn tồn tại trước khi dùng, không giả định Docker prune chưa xóa.

```bash
# Chỉ dùng sau khi đã kiểm tra tag và được duyệt rollback.
sudo docker image inspect 3dipl-backend:pre-history-3981912 --format '{{.Id}}'
sudo docker image tag 3dipl-backend:pre-history-3981912 3dipl-backend:local
sudo docker compose -f compose.production.yml up -d \
  --no-deps --force-recreate --wait --wait-timeout 180 backend </dev/null
curl --noproxy '*' -fsS --max-time 10 http://127.0.0.1:5000/ready
```

Rollback về trước `3981912` cũng đưa lỗi canonical redirect về lại; không phải phương án chữa lỗi đó. Không build ngay sau khi retag image cũ nếu mục tiêu là chạy lại image đã giữ.

Image quá cũ chưa hỗ trợ headed/display cần env tương thích đã review; không giữ `headless=false` trên image không có display rồi kết luận code rollback hỏng. Không đổi khóa giải mã tùy tiện, không xóa volume profile, không `git reset --hard` hoặc restore DB chỉ để rollback một browser patch.

## 24. Checklist bàn giao

### Trước khi sửa code Getlink

- [ ] Ghi đúng mode, account marker và giai đoạn lỗi; không gom mọi 403/502 thành CAPTCHA.
- [ ] Xác định đang xét metadata, format, mua/resolve file, debit/history hay stream.
- [ ] Xem đúng DB, collection và context; không trộn Cookie, ProductCache và lịch sử.
- [ ] Dùng fixture giả, không đưa signed URL/cookie thật vào source hoặc test.
- [ ] Không bỏ full-ID/sign/owner/price guard để làm một ca pass.

### Trước khi nói đã sửa xong

- [ ] Có regression cho nguyên nhân tái hiện, không chỉ sửa message.
- [ ] `npm run check` đạt trên Node theo repo.
- [ ] Nếu đổi UI, kiểm tra VI/EN, sáng/tối, desktop/mobile và pointer geometry khi có liên quan.
- [ ] Phân biệt mock/local pass với live source pass.
- [ ] Phân biệt source read-only pass với mua/tải thật hoàn tất.
- [ ] Chỉ commit/push đúng phạm vi được phép; không thêm secret hoặc artifact riêng không liên quan.
- [ ] Nếu triển khai: env check, giữ image cũ, drain công việc và kiểm tra readiness/log sau recreate.

### Khi operator bàn giao một lỗi

Gửi correlation ID, giờ theo múi giờ nào, web hay plugin, mode, bước lỗi, job/history ID nội bộ khi phù hợp và ảnh đã che dữ liệu nhạy cảm. Không gửi cookie, mật khẩu, claim token, download token hoặc link CDN có credential.

## 25. Tài liệu liên quan

- [Account validation](GETLINK_ACCOUNT_RESOLUTION.md).
- [Rewritten footprint](GETLINK_REWRITTEN_FOOTPRINT.md).
- [Collection resolution](GETLINK_COLLECTION_RESOLUTION.md).
- [Manual verification](GETLINK_MANUAL_VERIFICATION.md).
- [Native browser sessions và profile](GETLINK_BROWSER_SESSIONS_2026-11-03.md).
- [Reliability review 02/11](GETLINK_RELIABILITY_REVIEW_2026-11-02.md).
- [Getlink transfer](GETLINK_TRANSFER_RUNBOOK.md).
- [Marketplace transfer, để phân biệt luồng thư viện](MARKETPLACE_TRANSFER_RUNBOOK.md).

Một số mô tả trong lịch sử repo được viết trước `3981912` hoặc chỉ nói tới một mode. Khi có khác biệt, đối chiếu commit và mã nguồn hiện tại. Đặc biệt, không áp dụng ràng buộc cũ “opened URL luôn phải giữ nguyên path card” cho trường hợp HTTP redirect có provenance và sign mà bản sửa mới đã xác nhận. Hướng dẫn rewritten và manual verification đi kèm đã được cập nhật các điểm này trong đợt tổng hợp.
