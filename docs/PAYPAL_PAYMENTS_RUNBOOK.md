# Thanh toán PayPal cho Credit và Pro

## Trạng thái bàn giao

Đã triển khai trong code; mặc định `PAYPAL_ENABLED=false`. Chưa bật Live hoặc
triển khai VPS. Test tự động dùng memory database và mock PayPal, không thu tiền.
Chưa kiểm thử tích hợp Sandbox do chưa có REST app và thông tin merchant.

Tài liệu chính thức: [Orders v2](https://developer.paypal.com/api/rest/integration/orders-api),
[webhook và xác minh chữ ký](https://developer.paypal.com/api/rest/webhooks/rest/),
[tạo REST app](https://developer.paypal.com/api/get-started/).

## Quy tắc vận hành

- Ngôn ngữ đang chọn EN: PayPal/USD; VI: SePay/VND. Không chọn theo IP.
- Admin > Website > Gói nạp > Credit/Pro: nhập **Giá PayPal (USD)**, tối đa hai
  chữ số thập phân. Để trống để ngừng bán gói đó bằng PayPal.
- Giá USD độc lập với giá VND và chương trình sale VND. `15.25` lưu thành
  `paypalPriceCents=1525`. Không cần sửa các giá VND đang dùng.
- Trial có giá VND bằng 0 vẫn kích hoạt ngay, không cần gateway hoặc giá USD.
- Voucher, Credit thưởng, giới hạn gói và giới hạn voucher dùng chung hai cổng.
  Giá, giảm giá và quyền lợi được chốt theo đơn, không đổi khi sửa gói/ngôn ngữ.
- Credit sau voucher tối thiểu $0.01. Pro giảm xuống 0 dùng `internal_free`.
- Đây là thanh toán từng lần, không đăng ký tự động gia hạn.
- Không tự chuyển EN sang SePay nếu PayPal tắt: gói trả phí không thể mua trong
  EN, nhưng Trial miễn phí vẫn hoạt động.

## Cấu hình

Chỉ bổ sung các khóa sau vào env backend đang dùng. Không thay toàn bộ file env,
không nhập lại Atlas, Drive, SePay hoặc secret đăng nhập. Mỗi khóa chỉ có một dòng.
Không gửi client secret vào chat, frontend hoặc Git.

```dotenv
PAYPAL_ENABLED=false
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_MERCHANT_ID=
```

`PAYPAL_CLIENT_ID` và `PAYPAL_CLIENT_SECRET`: cùng một REST app trong PayPal
Developer Dashboard. `PAYPAL_WEBHOOK_ID`: ID webhook đăng ký trên chính app đó.
`PAYPAL_MERCHANT_ID`: merchant nhận tiền, không phải email, client ID hay buyer ID.
`CLIENT_URL` hiện có phải là địa chỉ web HTTPS, ví dụ `https://3dipl.org`.

Dùng buyer Sandbox riêng với merchant Sandbox để kiểm thử. Không dùng tài khoản
nhận tiền để đóng vai người mua. Chỉ dùng tài khoản Business, REST app Live và
merchant Live đã xác nhận khi mở thanh toán thật.

Production bắt buộc Atlas Core hỗ trợ transaction; không dùng standalone Mongo
để xử lý thu tiền. File/envcheck đã kiểm tra cấu hình PayPal khi bật hoặc khi có
credential, còn các test tự động chỉ dùng memory fixture.

Không đổi `PAYPAL_ENV`, merchant hoặc REST app khi còn đơn đang đối soát của môi
trường cũ. Worker xử lý môi trường cấu hình hiện tại; chuyển Sandbox sang Live
phải hoàn tất đơn Sandbox trước, hoặc dùng môi trường staging tách biệt.

## Webhook

Đăng ký trên app đúng môi trường:

```text
https://3dipl.org/api/payments/paypal/webhook
```

Chọn các sự kiện sau theo danh sách hỗ trợ trong PayPal Dashboard:

```text
CHECKOUT.ORDER.APPROVED
PAYMENT.CAPTURE.COMPLETED
PAYMENT.CAPTURE.PENDING
PAYMENT.CAPTURE.DECLINED
PAYMENT.CAPTURE.REFUNDED
PAYMENT.CAPTURE.REVERSED
CUSTOMER.DISPUTE.CREATED
CUSTOMER.DISPUTE.UPDATED
CUSTOMER.DISPUTE.RESOLVED
```

Code cũng nhận `PAYMENT.CAPTURE.DENIED` để tương thích sự kiện cũ. Không chặn
webhook bằng login, Turnstile hay trang challenge của Cloudflare. Chỉ miễn
challenge cho đúng path webhook nếu cần; vẫn giữ rate limit và xác minh chữ ký.
Endpoint capture của browser vẫn yêu cầu đăng nhập, chủ đơn, CSRF và rate limit.

Chữ ký được xác minh qua PayPal và webhook ID đã cấu hình, sau đó sự kiện được
lưu bền vững trước khi trả 200. Payload giả hoặc sai chữ ký không vào hàng chờ.
Webhook Simulator không thay thế việc mua hàng bằng app/merchant Sandbox thật.

## Luồng đối soát

1. Backend lưu đơn USD và operation PayPal trước khi tạo order ngoài hệ thống.
2. Browser chuyển sang PayPal. Return URL chỉ chứa loại/ID đơn nội bộ; không dùng
   query URL làm bằng chứng thanh toán.
3. Callback hoặc worker lấy order trực tiếp từ PayPal, kiểm tra ID, invoice,
   custom ID, merchant, USD và số tiền.
4. Trước capture, transaction Atlas giữ chỗ giới hạn mua và voucher. Nếu điều kiện
   không còn hợp lệ thì không capture.
5. Capture dùng request ID ổn định; server đọc lại order để xác nhận. Chỉ capture
   `COMPLETED` mới cấp quyền. `PENDING` tiếp tục chờ, bị từ chối không cấp quyền.
6. Capture được lưu trước khi cấp Credit/Pro. Transaction cấp quyền dùng biên nhận
   duy nhất `paypal:<captureId>` và dùng cùng dịch vụ với SePay.
7. Worker chạy mỗi 30 giây, có lease, retry/backoff. Đóng tab hoặc restart backend
   không làm mất đơn đã thu tiền. Retry không tự tạo capture mới cho cùng đơn.
8. Sau duyệt, sự kiện tài khoản hiện có cập nhật số dư/quota trên web và plugin,
   đồng thời gửi Telegram. Trang lịch sử có thể mở lại đơn đang chờ bằng tài khoản,
   không phụ thuộc sessionStorage.

Không xóa reservation của capture chưa biết kết quả. Sau khoảng thời gian an toàn
cho request ID, code dừng tự capture lại và báo đối soát thủ công thay vì thu trùng.
Admin giao dịch PayPal dùng **Đối soát**, không duyệt tay một đơn chưa thu tiền.
Capture đã trả tiền nhưng lỗi cấp quyền được giữ để worker/admin retry; không
đánh dấu thất bại rồi bỏ quyền lợi của người mua.

Refund/reversal/dispute cập nhật số tiền/trạng thái, báo Telegram một lần theo
giao dịch điều chỉnh. **Không tự trừ Credit hoặc thu hồi Pro.** Admin kiểm tra
PayPal và xử lý tài khoản bằng công cụ admin hiện có, có audit log. Tính năng này
không có nút hoàn tiền tự động; hoàn tiền thực hiện trong PayPal.

## API tương thích

```http
POST /api/topup
POST /api/membership/checkout
Idempotency-Key: <uuid-stable-for-this-checkout>
Content-Type: application/json

{"packageId":"<id>","paymentProvider":"paypal","voucherCode":""}
```

Pro dùng `planId` thay `packageId`. Client cũ không gửi `paymentProvider` vẫn dùng
SePay. Giá lấy từ backend, không tin số tiền do client gửi. PayPal response có
`payment.provider="paypal"`, `method="GET"`, `currency="USD"`, `checkoutUrl`.
Contract POST form SePay được giữ nguyên.

```http
POST /api/payments/paypal/orders/topup/:id/capture
POST /api/payments/paypal/orders/membership/:id/capture
GET /api/topup/:id/status
GET /api/membership/orders/:id/status
```

Các đơn/biên nhận mới có currency và số nguyên minor units; dữ liệu cũ được đọc
như VND, không yêu cầu rewrite dữ liệu lịch sử. Catalog trả `payments.paypal.enabled`
để frontend biết cổng đang sẵn sàng hay tắt.

## Triển khai VPS sau khi code được merge

Chuẩn bị backup đã xác minh và cửa sổ triển khai theo runbook hiện có. Trước lần
đầu bật PayPal, nhập giá USD và đạt checklist Sandbox ở môi trường tách biệt.

```bash
cd /opt/3dipl/app
git pull --ff-only origin main
sudoedit /etc/3dipl/production/backend.env
sudo docker compose -f compose.production.yml build backend frontend
sudo docker compose -f compose.production.yml run --rm --no-deps backend npm run env:check
```

Chỉ tiếp tục khi `env:check` đạt; không bỏ qua lỗi. Sau đó:

```bash
sudo docker compose -f compose.production.yml up -d --no-deps --force-recreate backend frontend
sudo docker compose -f compose.production.yml ps
curl -fsS http://127.0.0.1:5000/ready
curl -fsS https://3dipl.org/api/topup/packages
curl -fsS https://3dipl.org/api/membership/plans
sudo docker compose -f compose.production.yml logs --since=10m backend
```

`restart` không nạp env mới; dùng recreate. Không cần đổi Nginx nếu `/api/` hiện
đã proxy về backend. Không cần build lại frontend khi chỉ sửa giá USD trong admin.
Các index mới được tạo khi backend khởi động; không chạy migration phá dữ liệu.

## Kiểm tra tồn đọng chỉ đọc

Kiểm tra OAuth và quyền truy cập Webhook ID mà không tạo đơn/capture, không kết
nối database và không in credential/token:

```bash
sudo docker compose -f compose.production.yml run --rm --no-deps backend npm run paypal:check
sudo docker compose -f compose.production.yml exec -T backend npm run paypal:check
```

`run` đọc env mới trong file, còn `exec` dùng env của container đang chạy. Nếu
`run` đạt nhưng `exec` báo OAuth `401 invalid_client`, credentials trong container
có thể chưa được cập nhật. Sau khi xác nhận đúng môi trường/credentials, recreate
backend để nạp env mới; `restart` không đủ. Không đổi Sandbox thành Live để né lỗi.

Lỗi mới ghi rõ `oauth` hoặc `api`, HTTP, issue và debug ID an toàn; không ghi raw
response, secret, token hoặc Authorization. `401 invalid_client` ở OAuth: kiểm tra
cặp Client ID/Secret cùng App và đúng môi trường. OAuth đạt nhưng API webhook
`404`: kiểm tra Webhook ID cùng App/môi trường. `PAYPAL_API_TIMEOUT` là timeout
kết nối/đọc response, khác với PayPal trả HTTP từ chối. Không retry capture thủ
công để né timeout; để luồng đối soát kiểm tra kết quả trước.

Lệnh dưới không in secret, token, link thanh toán hoặc raw webhook; không sửa đơn:

```bash
cd /opt/3dipl/app
sudo docker compose -f compose.production.yml exec -T backend node --input-type=module -e '
import { connectDb, closeDbConnections } from "./src/config/db.js";
await connectDb();
try {
  const { default: Payment } = await import("./src/models/PaypalPayment.js");
  const { default: Event } = await import("./src/models/PaypalWebhookEvent.js");
  const env = process.env.PAYPAL_ENV || "sandbox";
  console.log("PayPal", { enabled: process.env.PAYPAL_ENABLED, environment: env });
  console.log("Payments", await Payment.aggregate([
    { $match: { environment: env } },
    { $group: { _id: "$state", count: { $sum: 1 } } }
  ]));
  console.log("Pending events", await Event.countDocuments({ environment: env, state: "pending" }));
  console.dir(await Payment.find({ environment: env, attempts: { $gte: 3 }, state: { $nin: ["settled", "stopped"] } })
    .select("kind orderId state attempts lastError nextAttemptAt").limit(20).lean(), { depth: null });
} finally { await closeDbConnections(); }
'
```

`captured` tồn lâu: kiểm tra Atlas và lỗi cấp quyền. `capture_pending`: chờ trạng
thái PayPal, không duyệt tay. `PAYPAL_*_MISMATCH`: kiểm tra merchant/môi trường/số
tiền, không sửa giá đơn để ép duyệt. `PAYPAL_CAPTURE_UNCERTAIN`: kiểm tra capture
trong PayPal, không xóa operation/reservation để thử thu lại.
`review` / `PAYPAL_CAPTURE_ADJUSTED`: capture đã hoàn tiền trước lúc cấp quyền;
giữ capture và reservation để kiểm tra thủ công, không tự capture hoặc cấp lại.

Admin Tổng quan có doanh thu VND và USD tách riêng. USD có tiền thu, phí, hoàn tiền
và net; không cộng hai tiền tệ vào một tổng. Giao dịch/lịch sử luôn dùng currency
của đơn, không dùng ngôn ngữ hiện tại để đổi tiền tệ.

## Checklist Sandbox trước Live

- Credit, Pro và DAILY add-on: đúng USD, đúng merchant, quyền lợi và giá đã chốt.
- Trial miễn phí khi gateway tắt; EN thiếu giá USD không cho mua; VI/SePay vẫn đúng.
- Voucher và giới hạn mua dùng chung; hai callback cùng lúc không cấp quyền trùng.
- Capture PENDING, callback mất mạng, đóng tab, refresh mất sessionStorage.
- Restart backend sau khi PayPal đã capture: nhận đủ quyền lợi, chỉ một receipt.
- Giả/sai/trùng webhook không tạo charge hoặc quyền lợi sai.
- Header và plugin nhận account event; Telegram báo đúng USD và không lặp duyệt.
- Refund/dispute được ghi nhận, không tự thu hồi quyền lợi.
- Báo cáo VND/USD, phí và hoàn tiền chính xác; admin đối soát không duyệt đơn unpaid.

Kiểm thử local:

```bash
npm run check
npm run build --prefix frontend -- --outDir ../qa-report/paypal-dist
node backend/scripts/qa-paypal.js qa-report/paypal-dist qa-report/paypal-ui
```

## Tắt cổng và rollback

Đổi **chỉ** `PAYPAL_ENABLED=false`, giữ nguyên ENV và bốn credential, rồi recreate
backend. Điều này chặn đơn PayPal mới, vẫn xác minh webhook và đối soát đơn cũ.
Không xóa collection/receipt/reservation hoặc secret khi còn đơn chưa xử lý xong.

Không rollback về binary chưa có worker PayPal khi còn capture chưa settled.
Nếu cần rollback giao diện, giữ backend đối soát này chạy cho đến khi đơn cũ hoàn
tất. Không restore database snapshot trước thanh toán để sửa UI: có thể mất biên
nhận chống cấp quyền trùng. Dùng backup/restore chỉ theo quy trình sự cố đã duyệt.
