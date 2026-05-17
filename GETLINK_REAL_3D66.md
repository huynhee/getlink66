# Triển khai getlink thật 3D66

Backend hiện đã có luồng gọi API tải thật của 3D66 qua endpoint:

```txt
POST https://user.3d66.com/api/v1/download/handle
```

File chính:

```txt
backend/src/utils/3d66Service.js
backend/src/controllers/getlinkController.js
backend/src/utils/parse3d66.js
```

## 1. Cấu hình `.env`

Trong `backend/.env`, bật chế độ thật:

```env
THREED66_MOCK=false
THREED66_DOWNLOAD_ENDPOINT=https://user.3d66.com/api/v1/download/handle
THREED66_TIMEOUT_MS=30000
THREED66_SITE_CONTEXTS=
```

`THREED66_ORIGIN` không bắt buộc. Nếu không set, backend tự chọn origin theo link model:

```txt
https://su.3d66.com  -> site=6
https://3d.3d66.com  -> site=1, file_format=1
```

Chỉ set `THREED66_ORIGIN` khi muốn ép tất cả request dùng một origin cố định.

Nếu 3D66 có thêm subdomain mới, có thể khai báo map context bằng JSON trong `.env`:

```env
THREED66_SITE_CONTEXTS={"vr.3d66.com":{"site":"2","pageType":"5","accessSourceSite":"2","accessSourcePage":"5"}}
```

Map này sẽ merge với map mặc định của backend.

Nếu muốn quay lại mock để test UI:

```env
THREED66_MOCK=true
```

Sau khi sửa `.env`, phải restart backend.

## 2. Cookie 3D66

Admin vào `/admin`, mục Cookie 3D66, dán cookie tài khoản 3D66 đang đăng nhập.

Cookie tối thiểu nên có:

```txt
PHPSESSID
login_token
login_sign
Hm_lvt_bh_ud
Hm_lvt_bh_ud_uid_front
```

Backend chỉ lưu cookie ở server/database, không trả cookie về frontend.

Sau khi dán cookie, bấm `Kiểm tra`. Nếu hợp lệ, UI sẽ báo cookie OK. Nếu thiếu key hoặc cookie hết hạn, backend sẽ trả lỗi rõ.

## 3. Luồng getlink thật

Khi user gọi:

```txt
POST /api/getlink
```

Backend xử lý:

```txt
1. Kiểm tra user đã đăng nhập và còn credit.
2. Extract productId từ URL, ưu tiên query `sof` nếu có.
3. Check ProductCache.
4. Nếu cache còn hạn, trả link cache.
5. Nếu chưa có cache hoặc link auth_key gần hết hạn:
   - Fetch trang model 3D66 bằng cookie admin.
   - Parse `ll_id`, `token`, `up_time`.
   - Build payload form giống request thật trên Chrome.
   - POST tới `https://user.3d66.com/api/v1/download/handle`.
   - Lấy URL `https://down.3d66.com/...`.
6. Lưu hoặc update ProductCache.
7. Trừ 1 credit.
8. Ghi Getlink history.
9. Trả link tải cho user.
```

Nếu 3D66 lỗi, cookie sai, thiếu `token/up_time/ll_id`, hoặc response không có link tải, backend sẽ không trừ credit.

## 4. Payload 3D66 đang dùng

Backend gửi dạng:

```txt
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
Origin: https://su.3d66.com
Referer: https://su.3d66.com/
```

Các field cố định:

```txt
action=user_pay_download
rartype=1
needtype=1
st=2
source=0
click_res_source=1
collect=0
model_num=1
site=6
page_type=5
access_source_site=6
access_source_page=5
position=1
down_type=0
is_business=0
is_commercial=false
```

Các field động:

```txt
ll_id      lấy từ query `sof` hoặc HTML page
token      parse từ HTML/JS page
up_time    parse từ HTML/JS page
resUrl     URL model đầy đủ, có sof/sign/alichlgref
referrer   URL model không có alichlgref
uid        lấy từ cookie Hm_lvt_bh_ud
uid_front  lấy từ cookie Hm_lvt_bh_ud_uid_front
browser    user-agent Chrome giả lập
```

Với link dạng `https://3d.3d66.com/reshtmla/model/...`, backend đổi các field context thành:

```txt
site=1
access_source_site=1
file_format=1
Origin: https://3d.3d66.com
Referer: https://3d.3d66.com/
```

Với link dạng `https://su.3d66.com/reshtmla/sketchup/...`, backend giữ:

```txt
site=6
access_source_site=6
Origin: https://su.3d66.com
Referer: https://su.3d66.com/
```

Map mặc định hiện có:

```txt
3d.3d66.com    -> site=1,  access_source_site=1,  access_source_page=5, file_format=1
su.3d66.com    -> site=6,  access_source_site=6,  access_source_page=5
tietu.3d66.com -> site=11, access_source_site=14, access_source_page=1
cad.3d66.com   -> site=6,  access_source_site=6,  access_source_page=5
xiaoguotu.3d66.com    -> site=6, access_source_site=6, access_source_page=5
fanganwenben.3d66.com -> site=6, access_source_site=6, access_source_page=5
linggantu.3d66.com    -> site=6, access_source_site=6, access_source_page=5
3d66.com              -> site=6, access_source_site=6, access_source_page=5
www.3d66.com          -> site=6, access_source_site=6, access_source_page=5
```

`cad`, `xiaoguotu`, `fanganwenben`, `linggantu` đang dùng fallback `site=6` cho đến khi bắt được payload `download/handle` thật của từng host. Nếu payload thật khác, thêm override vào `THREED66_SITE_CONTEXTS`.

Domain gốc `3d66.com`/`www.3d66.com` được giữ nguyên origin nếu user gửi link trực tiếp từ domain này.

Với các dạng còn lại, bắt request `download/handle` trên Chrome rồi lấy các field này:

```txt
origin
site
page_type
access_source_site
access_source_page
file_format nếu có
```

Sau đó thêm vào `THREED66_SITE_CONTEXTS`.

Nếu cookie có key `resUrlreferrer`, backend ưu tiên đọc context từ cookie này:

```txt
site
page_type
access_source_site
access_source_page
```

Cách này giúp hỗ trợ thêm các subdomain khác như `tietu.3d66.com` khi 3D66 tự lưu context vào cookie.

### 4.1. API `popPrice`

Request:

```txt
POST https://user.3d66.com/api/v1/download/popPrice
```

Đây là API kiểm tra popup/giá trước khi tải, không phải API trả link file. Nó có thể trả data user hoặc thông tin hiển thị popup, nhưng không có URL `down.3d66.com`.

Luồng getlink vẫn cần response từ:

```txt
POST https://user.3d66.com/api/v1/download/handle
```

với `data` là link:

```txt
https://down.3d66.com/...
```

## 5. Response hợp lệ

Response tải hợp lệ có dạng:

```json
{
  "status": 200,
  "data": "https://down.3d66.com/allres/res/....rar?auth_key=...",
  "msg": "...",
  "request_id": "..."
}
```

Backend chỉ chấp nhận khi:

```txt
status/code = 200
data là string
data bắt đầu bằng https://down.3d66.com/
```

## 6. Cache và link hết hạn

Link 3D66 có `auth_key`, thường là link có hạn.

Backend sẽ:

- Cache theo `ll_id/sof` nếu parse được.
- Nếu link cache còn hạn, trả luôn từ DB.
- Nếu `auth_key` còn dưới 5 phút hoặc đã hết hạn, gọi lại 3D66 để refresh link.
- Giữ lock theo product để tránh nhiều request cùng mua/tải trùng.

## 7. Test nhanh

1. Đảm bảo MongoDB chạy ổn.
2. Đảm bảo backend login Google được.
3. Set:

```env
THREED66_MOCK=false
```

4. Restart backend:

```bash
npm run dev --prefix backend
```

5. Vào `/admin`, dán cookie 3D66, bấm `Kiểm tra`.
6. Vào `/getlink`, dán link model 3D66 thật.
7. Nếu thành công, response trả link `down.3d66.com` và user bị trừ 1 credit.

## 8. Lỗi thường gặp

Thiếu cookie:

```txt
3D66 cookie missing required keys: ...
```

Cách xử lý: đăng nhập lại 3D66 trên Chrome, copy lại cookie mới.

Không parse được tham số:

```txt
Cannot build 3D66 download request. Missing: token, up_time, ll_id/sof
```

Cách xử lý: bắt thêm request/page script từ DevTools vì 3D66 có thể đổi nơi lưu token.

API 3D66 không trả link:

```txt
3D66 download failed: <msg> (<request_id>)
```

Cách xử lý: kiểm tra cookie, quyền VIP, số dư/tài khoản 3D66, hoặc payload có bị 3D66 đổi field không.

Backend không chạy:

```txt
querySrv ECONNREFUSED _mongodb._tcp...
```

Cách xử lý: Mongo đang lỗi. Chuyển sang Mongo local hoặc sửa Atlas connection string trước khi test getlink.

## 9. Lưu ý bảo mật

- Không gửi cookie 3D66 công khai.
- Không lưu file model trên server.
- Không trả cookie/admin credential về frontend.
- Nếu cookie đã từng gửi qua kênh không an toàn, nên logout 3D66 để thu hồi session rồi lấy cookie mới.

## 10. Quy đổi credit

Quy đổi nạp tiền:

```txt
1 tệ = 4.000 VND
1 tệ = 10 credit web
=> 1 credit web = 400 VND
```

Ví dụ:

```txt
50.000 VND / 4.000 = 12,5 tệ
12,5 * 10 = 125 credit web
```

Biến cấu hình:

```env
VND_PER_CNY=4000
WEB_CREDIT_PER_CNY=10
```

Khi tải model, nếu 3D66 trả giá model là `28 credit`, web sẽ trừ đúng `28 credit` từ tài khoản user. Nếu chưa đọc được giá từ response/API 3D66, backend fallback tạm `1 credit` để không làm hỏng luồng getlink.
# Huong Lay Metadata 3D66

## Muc tieu

Khi user nhap link 3D66, backend can lay truoc:

- Ma model: `ll_id` / `sof`
- Ten model
- Anh demo
- Gia goc 3D66: vi du `28下载币`
- Credit can tru tren web: dung dung gia 3D66, vi du `28下载币` thi tru `28 credit`

Sau khi user xac nhan tai, backend moi goi API download va tru credit.

## Van de hien tai

Node `fetch` dang bi Aliyun WAF chan. Response backend nhan duoc khong phai HTML model that, ma la challenge page:

```html
<textarea id="renderData" style="display:none">...</textarea>
<meta name="aliyun_waf_aa" ...>
setCookie("acw_sc__v2", ...)
```

Vi vay parser khong thay duoc:

- `h1.model-name`
- `meta[property="og:image"]`
- `.orginal-price`
- `#detail_data`

Ket qua se bi fallback ve:

- title = productId
- imageUrl = rong
- creditCost = 1

## Huong dung

Dung 2 tang lay metadata:

1. Tang nhanh: `fetch` HTML thuong.
2. Tang fallback: Playwright/headless Chromium khi gap Aliyun WAF.

Neu HTML tra ve la HTML model that thi lay bang parser la nhanh nhat. Neu HTML tra ve challenge page thi bat buoc dung browser vi WAF can JavaScript de set cookie `acw_sc__v2`.

## Buoc 1: Fetch HTML

Backend fetch URL model voi cookie admin 3D66:

```txt
GET https://3d.3d66.com/reshtmla/...
Cookie: PHPSESSID=...; login_token=...; login_sign=...; acw_sc__v2=...
User-Agent: Chrome desktop
Referer: https://www.3d66.com/
```

Neu response co cac selector nay thi parse truc tiep:

```html
<h1 class="model-name" title="...">...</h1>
<meta property="og:image" content="...">
<div class="orginal-price tp-font-regular">38下载币</div>
<input type="hidden" id="detail_data" value="...">
```

## Buoc 2: Phat hien WAF/challenge

Neu response co mot trong cac dau hieu sau thi khong parse nua, chuyen sang Playwright:

```txt
aliyun_waf
aliyunwaf
renderData
acw_sc__v2
hasTitleTag = false
hasScriptOnlyShell = true
```

Day la ly do hien tai `inspect` bao:

```json
{
  "looksLikeChallenge": true,
  "hasScriptOnlyShell": true,
  "hasTitleTag": false
}
```

## Buoc 3: Fallback bang Playwright

Playwright mo Chromium that, gan cookie admin vao browser context, vao link model va cho page render xong.

Can cai:

```powershell
cd backend
npm install playwright
npx playwright install chromium
```

Luon parse trong DOM sau khi browser load:

```js
await page.goto(modelUrl, { waitUntil: "domcontentloaded" });
await page.waitForSelector(
  "h1.model-name, #detail_data, meta[property='og:image'], .llimgs",
  { timeout: 15000 }
);
```

Lay data:

```js
const metadata = await page.evaluate(() => {
  const detailInput = document.querySelector("#detail_data");
  const detail = detailInput ? JSON.parse(detailInput.value) : null;
  const res = detail?.data?.res || {};

  const productId =
    res.ll_id ||
    document.querySelector(".ll-id")?.textContent?.trim() ||
    document.querySelector(".slide-ll-id b")?.textContent?.trim() ||
    document.querySelector("[data-sof]")?.getAttribute("data-sof") ||
    new URLSearchParams(location.search).get("sof");

  const title =
    res.res_name_txt ||
    document.querySelector("h1.model-name")?.getAttribute("title") ||
    document.querySelector("h1.model-name")?.textContent?.trim() ||
    document.title;

  const imageUrl =
    document.querySelector("#swiper_max_html .llimgs")?.src ||
    document.querySelector(".detail-swiper .llimgs")?.src ||
    document.querySelector("meta[property='og:image']")?.content ||
    res.res_img?.find((img) => img.is_cover)?.img_pic ||
    res.res_img_dg;

  const originalPriceText =
    document.querySelector(".orginal-price")?.textContent ||
    document.querySelector(".price")?.textContent;

  const priceFromText = Number((originalPriceText || "").match(/\d+(\.\d+)?/)?.[0]);
  const priceFromDetail = Number(res.res_price || res.coupon_after_price || 0);

  return {
    productId,
    title,
    imageUrl,
    originalPrice: priceFromText || priceFromDetail || 1,
    creditCost: Math.ceil(priceFromText || priceFromDetail || 1),
    sourceUrl: location.href
  };
});
```

## Buoc 4: Luu cache metadata

Sau khi lay duoc metadata, luu vao `ProductCache`:

```js
{
  productId: "AJI896357718777714",
  sourceUrl: "https://cad.3d66.com/reshtmla/...",
  title: "现代弧面异型造型天花节点大样图施工图CAD",
  imageUrl: "https://respic.3d66.com/coverimg/...",
  creditCost: 38,
  originalPrice: 38,
  updatedAt: new Date()
}
```

Neu lan sau user nhap lai cung model thi doc cache, khong can fetch 3D66 nua.

## Buoc 5: Tru credit truoc khi tai

Flow dung:

```txt
1. User nhap link
2. Backend preview metadata
3. Frontend hien ten, anh, gia
4. User bam tai
5. Backend check credit >= creditCost
6. Backend goi 3D66 download API
7. Chi khi lay duoc link/file thanh cong moi tru credit
8. Tao history va tra link proxy noi bo
```

Khong nen tru credit o buoc preview, vi preview chi la xem thong tin.

## Cac domain can ho tro

```txt
3d.3d66.com
su.3d66.com
cad.3d66.com
xiaoguotu.3d66.com
fanganwenben.3d66.com
tietu.3d66.com
linggantu.3d66.com
www.3d66.com
3d66.com
```

Moi domain co the co HTML hoi khac nhau, nen thu tu lay nen la:

1. `#detail_data`
2. DOM chinh: `h1.model-name`, `.llimgs`, `.orginal-price`
3. Meta fallback: `title`, `meta[property="og:image"]`
4. URL fallback: query `sof`

## Cach test nhanh

1. Luu cookie 3D66 trong admin.
2. Bam test cookie, phai co `PHPSESSID`, `login_token`, `login_sign`.
3. Goi inspect:

```powershell
Invoke-RestMethod `
  -Uri "http://localhost:5000/api/getlink/inspect" `
  -Method POST `
  -ContentType "application/json" `
  -WebSession $session `
  -Body '{"url":"https://cad.3d66.com/reshtmla/cad/items/9e/9eyLnkfjG44L6iX.html?sof=AJI896357718777714"}'
```

4. Neu `looksLikeChallenge=true`, parser HTML thuong se khong bao gio lay duoc metadata.
5. Sau khi them Playwright, inspect/preview phai tra:

```json
{
  "productId": "AJI896357718777714",
  "title": "现代弧面异型造型天花节点大样图施工图CAD",
  "imageUrl": "https://respic.3d66.com/coverimg/cad/...",
  "creditCost": 38
}
```

## Ket luan

HTML la cach nhanh nhat neu 3D66 tra HTML that. Nhung voi tinh trang hien tai, backend dang gap Aliyun WAF, nen huong on dinh la them Playwright fallback. Parser da dung logic nhung khong co du lieu that de parse, nen ket qua van chi ra `productId` va `1 credit`.
