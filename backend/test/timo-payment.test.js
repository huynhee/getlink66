import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { OAuth2Client } from "google-auth-library";
import { dkimSign } from "mailauth/lib/dkim/sign.js";
import { dkimVerify } from "mailauth/lib/dkim/verify.js";
import { sealMessage } from "mailauth/lib/arc/index.js";
import { Resolver } from "node:dns/promises";
import { useMemoryDb } from "../src/config/memoryStore.js";
import { timoConfiguration, timoConfigurationIssues } from "../src/config/timoConfig.js";
import { parseTimoBody, verifyTimoNotification } from "../src/utils/timoNotification.js";
useMemoryDb();
const { default: User } = await import("../src/models/User.js");
const { default: Topup } = await import("../src/models/Topup.js");
const { default: Pack } = await import("../src/models/TopupPackage.js");
const { default: Plan } = await import("../src/models/MembershipPlan.js");
const { default: MembershipOrder } = await import("../src/models/MembershipOrder.js");
const { default: PaymentReceipt } = await import("../src/models/PaymentReceipt.js");
const { default: Event } = await import("../src/models/TimoMailEvent.js");
const { default: State } = await import("../src/models/TimoMailState.js");
const { default: Reservation } = await import("../src/models/PaymentBenefitReservation.js");
const { default: Voucher } = await import("../src/models/Voucher.js");
const { default: SiteSetting } = await import("../src/models/SiteSetting.js");
const { default: SubscriptionPeriod } = await import("../src/models/SubscriptionPeriod.js");
const { createTimoCheckout, settleTimoMailEvent } = await import("../src/utils/timoPaymentService.js");
const { createTopup } = await import("../src/controllers/topupController.js");
const { createMembershipCheckout } = await import("../src/controllers/membershipController.js");
const { bankPaymentStatus, adminPaymentProvider, adminUpdatePaymentProvider, adminRetryTimo } = await import("../src/controllers/timoPaymentController.js");
const { vndPaymentRouting, newPaymentProvider } = await import("../src/utils/vndPaymentRouting.js");
const { default: adminRoutes } = await import("../src/routes/adminRoutes.js");
const { csrfProtection, issueCsrfToken } = await import("../src/middleware/csrf.js");
const { reconcileTimoOnce } = await import("../src/utils/timoMailJob.js");
const { assertTimoMailbox } = await import("../src/utils/timoGmail.js");
const { sepayIpn } = await import("../src/controllers/paymentController.js");
const { adminCancelTopup, adminCancelMembershipOrder } = await import("../src/controllers/adminV1Controller.js");

let user;
let pack;
beforeEach(async () => {
  mock.restoreAll();
  Object.assign(process.env, {
    VND_PAYMENT_PROVIDER: "timo", TIMO_ENABLED: "true", TIMO_MAIL_WORKER_ENABLED: "true",
    TIMO_ACCOUNT_NO: "1000000000000", TIMO_ACCOUNT_NAME: "TEST MERCHANT",
    TIMO_GMAIL_ADDRESS: "timo-fixture@gmail.com", TIMO_GMAIL_CLIENT_ID: "fixture-client",
    TIMO_GMAIL_CLIENT_SECRET: "fixture-secret", TIMO_GMAIL_REFRESH_TOKEN: "fixture-refresh",
    TIMO_MAIL_START_AT: new Date(Date.now() - 3600_000).toISOString(),
    TELEGRAM_ENABLED: "false", TOPUP_PACKAGE_CATALOG_MIGRATION_ENABLED: "false",
    SEPAY_ENABLED: "true", SEPAY_MERCHANT_ID: "fixture-merchant", SEPAY_SECRET_KEY: "fixture-sepay-secret",
  });
  mock.method(OAuth2Client.prototype, "request", async (options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.url, "https://gmail.googleapis.com/gmail/v1/users/me/profile");
    return { data: { emailAddress: process.env.TIMO_GMAIL_ADDRESS } };
  });
  for (const Model of [User, Topup, Pack, Plan, MembershipOrder, PaymentReceipt, Event, State, Reservation, Voucher, SiteSetting, SubscriptionPeriod]) await Model.deleteMany({});
  user = await User.create({ name: "Fixture", email: "fixture@example.test", credit: 0 });
  pack = await Pack.create({ name: "Credit fixture", price: 10000, credit: 50, isActive: true });
});

async function invoke(controller, body = {}, { params = {}, owner = user, key = "timo-fixture-idempotency-0001" } = {}) {
  let payload;
  let status = 200;
  await controller({ body, params, user: owner, get: (name) => name.toLowerCase() === "idempotency-key" ? key : "" }, {
    status(code) { status = code; return this; }, set() {}, json(value) { payload = value; return value; },
  }, (error) => { throw error; });
  return { payload, status };
}

async function checkout(body = {}) {
  const result = await invoke(createTopup, { packageId: pack._id, paymentProvider: "timo", ...body });
  return result.payload;
}

function mockEmptyMailbox() {
  mock.method(OAuth2Client.prototype, "request", async (options) => {
    assert.equal(options.method, "GET");
    if (options.url.endsWith("/profile")) return { data: { emailAddress: process.env.TIMO_GMAIL_ADDRESS } };
    if (options.url.endsWith("/messages")) return { data: { messages: [] } };
    throw new Error("Unexpected fixture Gmail request");
  });
}

async function verifiedEvent(order, changes = {}) {
  return Event.create({ _id: crypto.randomUUID(), mailbox: process.env.TIMO_GMAIL_ADDRESS, gmailMessageId: "aabbcc", accountNo: process.env.TIMO_ACCOUNT_NO,
    state: "verified", signedMessageIdHash: crypto.randomBytes(32).toString("hex"), paymentCode: order.paymentCode,
    amount: order.amountMinor, occurredAt: new Date(), nextAttemptAt: new Date(0), ...changes });
}

function body(code = "NAPEXAMPLE123456", direction = "tăng", amount = "10.000") {
  return `TEST MERCHANT thân mến, Tài khoản Spend Account vừa ${direction} ${amount} VND vào 18/10/2026 04:06. Số dư hiện tại: 999.999.999 VND. Mô tả: Sender ${code}. Cảm ơn Quý khách đã sử dụng dịch vụ Timo Digital Bank by BVBank!`;
}

test("Timo configuration is opt-in and requires dedicated credentials and a worker", () => {
  assert.deepEqual(timoConfigurationIssues({}), []);
  assert.deepEqual(timoConfigurationIssues(process.env), []);
  assert.equal(timoConfiguration().bankId, "963388");
  const errors = timoConfigurationIssues({ ...process.env, TIMO_GMAIL_REFRESH_TOKEN: "", TIMO_MAIL_WORKER_ENABLED: "false" });
  assert.ok(errors.some((message) => message.includes("REFRESH_TOKEN")));
  assert.ok(errors.some((message) => message.includes("WORKER_ENABLED")));
});

test("parse actual bank template, never confuse balance with incoming amount", () => {
  const notice = parseTimoBody(body(), timoConfiguration());
  assert.equal(notice.amount, 10000);
  assert.equal(notice.paymentCode, "NAPEXAMPLE123456");
  assert.equal(notice.occurredAt.toISOString(), "2026-10-17T21:06:00.000Z");
  assert.equal(parseTimoBody(body("NAPEXAMPLE123456", "giảm"), timoConfiguration()).ignored, true);
  assert.throws(() => parseTimoBody(body("NAPEXAMPLE123456 PROEXAMPLE123456"), timoConfiguration()), { code: "TIMO_AMBIGUOUS_PAYMENT_CODE" });
  assert.throws(() => parseTimoBody(body().replace("TEST MERCHANT", "OTHER OWNER"), timoConfiguration()), { code: "TIMO_OWNER_MISMATCH" });
  assert.throws(() => parseTimoBody(body().replace("18/10/2026", "31/02/2026"), timoConfiguration()), { code: "TIMO_DATE_INVALID" });
  assert.throws(() => parseTimoBody(body("", "tăng", "10.00"), timoConfiguration()), { code: "TIMO_AMOUNT_INVALID" });
  assert.throws(() => parseTimoBody(body(""), timoConfiguration()), { code: "TIMO_PAYMENT_CODE_MISSING" });
});

const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ format: "pem", type: "pkcs8" });
const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
async function signedEmail({ code, to = process.env.TIMO_GMAIL_ADDRESS, domain = "timo.vn", limited = false, multipart = false, currentTime = false } = {}) {
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).replace(",", "");
  const html = `<p>${currentTime ? body(code).replace("18/10/2026 04:06", now) : body(code)}</p>\r\n`;
  const content = multipart ? `--fixture-body\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}--fixture-body--\r\n` : html;
  const contentType = multipart ? 'multipart/mixed; boundary="fixture-body"' : "text/html; charset=utf-8";
  const raw = `From: Timo Support <support@timo.vn>\r\nTo: ${to}\r\nSubject: Thông báo thay đổi số dư tài khoản\r\nMessage-ID: <fixture-${crypto.randomUUID()}@timo.vn>\r\nMIME-Version: 1.0\r\nContent-Type: ${contentType}\r\n\r\n${content}`;
  const signed = await dkimSign(raw, { signTime: new Date(Date.now() - 60_000), headerList: "from:to:subject:message-id:mime-version:content-type", signatureData: [{ signingDomain: domain, selector: "fixture", privateKey, ...(limited ? { maxBodyLength: 10 } : {}) }] });
  assert.equal(signed.errors.length, 0);
  return Buffer.from(signed.signatures + raw);
}
const verifyFixture = (raw, options) => dkimVerify(raw, { ...options, resolver: async () => [[`v=DKIM1; k=rsa; p=${publicKey}`]] });

test("verify cryptographic DKIM, reject changed body, forged auth headers and wrong mailbox", async () => {
  const raw = await signedEmail();
  const config = timoConfiguration();
  const notice = await verifyTimoNotification(raw, config, { verify: verifyFixture });
  assert.equal(notice.amount, 10000);
  assert.match(notice.signedMessageIdHash, /^[a-f0-9]{64}$/);
  await assert.rejects(verifyTimoNotification(Buffer.from(raw.toString().replace("10.000", "50.000")), config, { verify: verifyFixture }), { code: "TIMO_DKIM_INVALID" });
  const unsigned = raw.toString().slice(raw.toString().indexOf("From:"));
  await assert.rejects(verifyTimoNotification(Buffer.from("Authentication-Results: mx.google.com; dkim=pass header.d=timo.vn\r\n" + unsigned), config, { verify: verifyFixture }), { code: "TIMO_DKIM_INVALID" });
  await assert.rejects(verifyTimoNotification(await signedEmail({ to: "other@gmail.com" }), config, { verify: verifyFixture }), { code: "TIMO_RECIPIENT_MISMATCH" });
  await assert.rejects(verifyTimoNotification(await signedEmail({ domain: "attacker.test" }), config, { verify: verifyFixture }), { code: "TIMO_DKIM_INVALID" });
  await assert.rejects(verifyTimoNotification(await signedEmail({ limited: true }), config, { verify: verifyFixture }), { code: "TIMO_DKIM_INVALID" });
});

test("Timo checkout uses immutable VND and bank snapshots without granting credit", async () => {
  const first = await checkout();
  assert.equal(first.payment.provider, "timo");
  assert.equal(first.payment.bankId, "963388");
  assert.equal(first.topup.bankId, "963388");
  assert.equal(first.topup.currency, "VND");
  assert.equal(first.topup.accountName, "TEST MERCHANT");
  assert.equal((await User.findById(user._id)).credit, 0);
  const url = new URL(first.payment.qrUrl);
  assert.equal(url.origin, "https://img.vietqr.io");
  assert.equal(url.pathname, "/image/963388-1000000000000-compact2.png");
  assert.equal(url.searchParams.get("amount"), "10000");
  assert.equal(url.searchParams.get("addInfo"), first.topup.paymentCode);
  await Pack.findByIdAndUpdate(pack._id, { price: 20000, credit: 999 });
  process.env.TIMO_ACCOUNT_NO = "2000000000000";
  const replay = await checkout();
  assert.equal(replay.topup.amount, 10000);
  assert.equal(replay.topup.credit, 50);
  assert.equal(replay.payment.accountNo, "1000000000000");
  assert.equal(await Topup.countDocuments({}), 1);
});

test("legacy BVBank QR snapshots still replay and settle without switching the stored bank", async () => {
  const { topup } = await checkout();
  await Topup.findByIdAndUpdate(topup._id, { bankId: "970454" });
  const legacy = await checkout();
  assert.equal(legacy.topup._id, topup._id);
  assert.equal(legacy.payment.bankId, "970454");
  assert.equal(new URL(legacy.payment.qrUrl).pathname, "/image/970454-1000000000000-compact2.png");
  const own = await invoke(bankPaymentStatus, {}, { params: { kind: "topup", id: topup._id } });
  assert.equal(own.payload.payment.bankId, "970454");
  const event = await verifiedEvent(legacy.topup);
  await settleTimoMailEvent(event._id);
  await settleTimoMailEvent(event._id);
  assert.equal((await User.findById(user._id)).credit, 50);
  assert.equal(await PaymentReceipt.countDocuments({}), 1);
  const next = await invoke(createTopup, { packageId: pack._id, paymentProvider: "timo" }, { key: "timo-new-bank-second-order-0002" });
  assert.equal(next.payload.payment.bankId, "963388");
});

test("concurrent and replayed email settlement grants credit once", async () => {
  const { topup } = await checkout();
  const event = await verifiedEvent(topup);
  await Promise.all([settleTimoMailEvent(event._id), settleTimoMailEvent(event._id)]);
  await settleTimoMailEvent(event._id);
  assert.equal((await User.findById(user._id)).credit, 50);
  assert.equal(await PaymentReceipt.countDocuments({}), 1);
  assert.equal((await Event.findById(event._id)).state, "applied");
});

test("underpayment, overpayment, old transfer and wrong account never grant benefits", async () => {
  const { topup } = await checkout();
  for (const changes of [{ amount: 9999 }, { amount: 10001 }, { accountNo: "3000000000000" }, { occurredAt: new Date(Date.now() - 600_000) }]) {
    const event = await verifiedEvent(topup, changes);
    await assert.rejects(settleTimoMailEvent(event._id));
  }
  assert.equal((await User.findById(user._id)).credit, 0);
  assert.equal(await PaymentReceipt.countDocuments({}), 0);
});

test("a bank-issued message ID cannot pay a second order", async () => {
  const first = await checkout();
  const one = await verifiedEvent(first.topup);
  await settleTimoMailEvent(one._id);
  const second = await invoke(createTopup, { packageId: pack._id, paymentProvider: "timo" }, { key: "timo-fixture-second-order-0002" });
  const two = await verifiedEvent(second.payload.topup, { signedMessageIdHash: one.signedMessageIdHash });
  await assert.rejects(settleTimoMailEvent(two._id), { code: "TIMO_RECEIPT_CONFLICT" });
  assert.equal((await User.findById(user._id)).credit, 50);
});

test("bank payment detail is bound to the signed-in owner", async () => {
  const { topup } = await checkout();
  const other = await User.create({ email: "other@example.test", name: "Other" });
  const response = await invoke(bankPaymentStatus, {}, { params: { kind: "topup", id: topup._id }, owner: other });
  assert.equal(response.status, 404);
  const own = await invoke(bankPaymentStatus, {}, { params: { kind: "topup", id: topup._id } });
  assert.equal(own.payload.payment.accountName, "TEST MERCHANT");
  assert.equal(own.payload.order.gatewayPayload, undefined);
  assert.equal(await State.countDocuments({}), 0);
});

test("subscription and free trial keep existing activation and scheduling rules", async () => {
  const plan = await Plan.create({ code: "MONTH50", name: "Month50", price: 10000, durationDays: 30, dailyDownloadLimit: 50, billingPeriod: "month", isActive: true });
  const response = await invoke(createMembershipCheckout, { planId: plan._id, paymentProvider: "timo" });
  assert.equal(response.payload.payment.provider, "timo");
  assert.equal(response.payload.payment.bankId, "963388");
  assert.equal(new URL(response.payload.payment.qrUrl).pathname, "/image/963388-1000000000000-compact2.png");
  const order = await MembershipOrder.findById(response.payload.order._id);
  const event = await verifiedEvent(order);
  await settleTimoMailEvent(event._id);
  assert.equal((await MembershipOrder.findById(order._id)).status, "approved");
  assert.equal((await User.findById(user._id)).proDailyDownloadLimit, 50);
  const trial = await Plan.create({ code: "TRIAL", name: "Trial", price: 0, durationDays: 7, dailyDownloadLimit: 100, isActive: true });
  const free = await invoke(createMembershipCheckout, { planId: trial._id, paymentProvider: "timo" }, { key: "timo-fixture-free-trial-0001" });
  assert.equal(free.payload.status, "approved");
  assert.equal(free.payload.payment, null);
  assert.equal(free.payload.order.gatewayProvider, "internal_free");
});

test("Gmail credentials are checked against the configured mailbox and only GETs are allowed", async () => {
  mock.method(OAuth2Client.prototype, "request", async (options) => {
    assert.equal(options.method, "GET");
    assert.equal(new URL(options.url).origin, "https://gmail.googleapis.com");
    return { data: { emailAddress: "wrong@gmail.com" } };
  });
  await assert.rejects(assertTimoMailbox(), { code: "TIMO_GMAIL_ACCOUNT_MISMATCH" });
});

test("worker recovers verified payment after restart and polls mail with durable checkpoints", async () => {
  const { topup } = await checkout();
  await verifiedEvent(topup);
  mock.method(OAuth2Client.prototype, "request", async (options) => {
    assert.equal(options.method, "GET");
    const path = new URL(options.url).pathname;
    if (path.endsWith("/profile")) return { data: { emailAddress: process.env.TIMO_GMAIL_ADDRESS } };
    if (path.endsWith("/messages")) return { data: { messages: [] } };
    throw new Error("Unexpected Gmail operation");
  });
  await reconcileTimoOnce();
  assert.equal((await User.findById(user._id)).credit, 50);
  const state = await State.findById(process.env.TIMO_GMAIL_ADDRESS);
  assert.ok(state.lastSuccessAt);
  assert.equal(state.lockOwner, "");
  await reconcileTimoOnce();
  assert.equal((await User.findById(user._id)).credit, 50);
});

test("Timo scans every five seconds for either pending order kind and returns to idle when canceled", async () => {
  mockEmptyMailbox();
  assert.equal((await reconcileTimoOnce()).nextPollMs, 30000);
  const { topup } = await checkout();
  assert.equal((await reconcileTimoOnce()).nextPollMs, 5000);
  await invoke(adminCancelTopup, {}, { params: { id: topup._id } });
  assert.equal((await reconcileTimoOnce()).nextPollMs, 30000);
  const plan = await Plan.create({ code: "MONTH50", name: "Month50", price: 10000, durationDays: 30,
    dailyDownloadLimit: 50, billingPeriod: "month", isActive: true });
  const response = await invoke(createMembershipCheckout, { planId: plan._id, paymentProvider: "timo" });
  assert.equal((await reconcileTimoOnce()).nextPollMs, 5000);
  await invoke(adminCancelMembershipOrder, {}, { params: { id: response.payload.order._id } });
  assert.equal((await reconcileTimoOnce()).nextPollMs, 30000);
});

test("scheduled scans share a durable five-second cooldown and mailbox lease", async () => {
  const { topup } = await checkout();
  let profileCalls = 0;
  let listCalls = 0;
  mock.method(OAuth2Client.prototype, "request", async (options) => {
    if (options.url.endsWith("/profile")) { profileCalls += 1; return { data: { emailAddress: process.env.TIMO_GMAIL_ADDRESS } }; }
    assert.ok(options.url.endsWith("/messages"));
    listCalls += 1;
    return { data: { messages: [] } };
  });
  const results = await Promise.all(Array.from({ length: 20 }, () => reconcileTimoOnce({ scheduled: true })));
  assert.equal(results.filter((result) => !result.busy).length, 1);
  assert.equal(results.find((result) => !result.busy).nextPollMs, 5000);
  assert.equal(profileCalls, 1);
  assert.equal(listCalls, 1);
  assert.equal((await reconcileTimoOnce({ scheduled: true })).busy, true);
  assert.equal(profileCalls, 1);
  await State.findByIdAndUpdate(process.env.TIMO_GMAIL_ADDRESS, { lastAttemptAt: new Date(Date.now() - 6000) });
  assert.equal((await reconcileTimoOnce({ scheduled: true })).processed, 0);
  assert.equal(profileCalls, 2);
  assert.equal((await Topup.findById(topup._id)).status, "pending");
  assert.equal((await User.findById(user._id)).credit, 0);
});

test("Gmail failures persist exponential backoff across wakes and a successful admin check resets it", async () => {
  let calls = 0;
  mock.method(OAuth2Client.prototype, "request", async () => {
    calls += 1;
    throw Object.assign(new Error("PRIVATE-CREDENTIAL"), { response: { status: 400, data: { error: "invalid_grant" } } });
  });
  await assert.rejects(reconcileTimoOnce({ scheduled: true }), (error) => error.gmailReason === "INVALID_GRANT" && error.retryAfterMs === 30000);
  assert.equal(calls, 1);
  assert.equal((await reconcileTimoOnce({ scheduled: true })).busy, true);
  assert.equal(calls, 1);
  await assert.rejects(reconcileTimoOnce(), (error) => error.retryAfterMs === 60000);
  const state = await State.findById(process.env.TIMO_GMAIL_ADDRESS);
  assert.equal(state.pollFailureCount, 2);
  assert.ok(new Date(state.pollBackoffUntil).getTime() > Date.now() + 59000);
  assert.equal((await reconcileTimoOnce({ scheduled: true })).busy, true);
  assert.equal(calls, 2);
  mockEmptyMailbox();
  await reconcileTimoOnce();
  const recovered = await State.findById(process.env.TIMO_GMAIL_ADDRESS);
  assert.equal(recovered.pollFailureCount, 0);
  assert.equal(recovered.pollBackoffUntil, null);
  assert.equal(recovered.lastError, "");
});

test("rate limits fetching a bank message also back off the entire scheduled scanner", async () => {
  const id = `${process.env.TIMO_GMAIL_ADDRESS}:abc123`;
  await Event.create({ _id: id, gmailMessageId: "abc123", mailbox: process.env.TIMO_GMAIL_ADDRESS,
    accountNo: process.env.TIMO_ACCOUNT_NO, state: "pending", nextAttemptAt: new Date(0) });
  let reads = 0;
  mock.method(OAuth2Client.prototype, "request", async (options) => {
    if (options.url.endsWith("/profile")) return { data: { emailAddress: process.env.TIMO_GMAIL_ADDRESS } };
    if (options.url.endsWith("/messages")) return { data: { messages: [] } };
    reads += 1;
    throw Object.assign(new Error("Fixture rate limit"), { response: { status: 429, data: {} } });
  });
  await assert.rejects(reconcileTimoOnce({ scheduled: true }), (error) => error.gmailReason === "RATE_LIMITED" && error.retryAfterMs === 30000);
  assert.equal((await Event.findById(id)).state, "pending");
  assert.equal((await State.findById(process.env.TIMO_GMAIL_ADDRESS)).pollFailureCount, 1);
  assert.equal((await reconcileTimoOnce({ scheduled: true })).busy, true);
  assert.equal(reads, 1);
  assert.equal(await PaymentReceipt.countDocuments({}), 0);
});

test("scheduled batches cap raw mail processing and still grant a duplicated payment once", async () => {
  const { topup } = await checkout();
  for (let index = 0; index < 6; index += 1) await verifiedEvent(topup);
  mockEmptyMailbox();
  const first = await reconcileTimoOnce({ scheduled: true });
  assert.equal(first.processed, 5);
  assert.equal(first.nextPollMs, 5000);
  assert.equal(await Event.countDocuments({ state: "verified" }), 1);
  assert.equal((await User.findById(user._id)).credit, 50);
  await State.findByIdAndUpdate(process.env.TIMO_GMAIL_ADDRESS, { lastAttemptAt: new Date(Date.now() - 6000) });
  assert.equal((await reconcileTimoOnce({ scheduled: true })).processed, 1);
  assert.equal((await User.findById(user._id)).credit, 50);
  assert.equal(await PaymentReceipt.countDocuments({}), 1);
});

test("retry re-reads and cryptographically verifies Gmail ARC before settling once", async () => {
  const { topup } = await checkout();
  const original = await signedEmail({ code: topup.paymentCode, multipart: true, currentTime: true });
  const bank = await verifyFixture(original);
  const google = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const record = `v=DKIM1; k=rsa; p=${google.publicKey.export({ format: "der", type: "spki" }).toString("base64")}`;
  const arcHeaders = await sealMessage(original, { signingDomain: "google.com", selector: "fixture",
    privateKey: google.privateKey.export({ format: "pem", type: "pkcs8" }), algorithm: "rsa-sha256", cv: "none",
    signTime: new Date(Date.now() - 30_000), headerList: "from:to:subject:message-id:mime-version:dkim-signature",
    authResults: `mx.google.com; dkim=pass header.i=@timo.vn header.s=fixture header.b=${bank.results[0].signature.slice(0, 8)}; dmarc=pass header.from=timo.vn` });
  const raw = Buffer.concat([arcHeaders, original]);
  mock.method(Resolver.prototype, "resolveTxt", async (domain) => {
    assert.ok(["fixture._domainkey.timo.vn", "fixture._domainkey.google.com"].includes(domain));
    // The bank's current DNS key no longer verifies the original bank signature.
    return [[record]];
  });
  const id = `${process.env.TIMO_GMAIL_ADDRESS}:abc123`;
  await Event.create({ _id: id, mailbox: process.env.TIMO_GMAIL_ADDRESS, gmailMessageId: "abc123", accountNo: process.env.TIMO_ACCOUNT_NO,
    state: "review", reason: "TIMO_DKIM_INVALID", attempts: 1 });
  mock.method(OAuth2Client.prototype, "request", async (options) => {
    if (options.url.endsWith("/profile")) return { data: { emailAddress: process.env.TIMO_GMAIL_ADDRESS } };
    if (options.url.endsWith("/messages")) return { data: { messages: [{ id: "abc123" }] } };
    assert.ok(options.url.endsWith("/messages/abc123"));
    return { data: { id: "abc123", internalDate: String(Date.now()), raw: raw.toString("base64url") } };
  });
  const retry = await invoke(adminRetryTimo, {}, { params: { id } });
  assert.equal(retry.payload.queued, true);
  assert.equal((await User.findById(user._id)).credit, 0);
  await reconcileTimoOnce();
  const event = await Event.findById(id);
  assert.equal(event.state, "applied");
  assert.equal(event.authenticationMethod, "gmail_arc");
  assert.equal((await Topup.findById(topup._id)).gatewayPayload.authenticationMethod, "gmail_arc");
  assert.equal((await User.findById(user._id)).credit, 50);
  await reconcileTimoOnce();
  assert.equal((await User.findById(user._id)).credit, 50);
  assert.equal(await PaymentReceipt.countDocuments({}), 1);
});

test("disabling new Timo checkout does not disable reconciliation of paid orders", async () => {
  const { topup } = await checkout();
  const event = await verifiedEvent(topup);
  process.env.TIMO_ENABLED = "false";
  process.env.VND_PAYMENT_PROVIDER = "sepay";
  await settleTimoMailEvent(event._id);
  assert.equal((await User.findById(user._id)).credit, 50);
  await assert.rejects(createTimoCheckout("topup", await Topup.create({ userId: user._id, amountMinor: 10000, amount: 10000, currency: "VND", credit: 50,
    status: "pending", gatewayProvider: "timo", paymentCode: "NAPNEWORDER1234", expiresAt: new Date(Date.now() + 60000) })), { code: "TIMO_NOT_CONFIGURED" });
});

test("SePay cannot approve a Timo order even with a valid SePay IPN secret", async () => {
  const { topup } = await checkout();
  process.env.SEPAY_SECRET_KEY = "fixture-sepay-secret";
  let payload;
  await sepayIpn({ body: { notification_type: "ORDER_PAID", order: { order_invoice_number: topup.paymentCode },
    transaction: { transaction_status: "APPROVED", transaction_id: "fixture-tx", transaction_amount: 10000 } },
  get(name) { return name === "content-type" ? "application/json" : name === "x-secret-key" ? process.env.SEPAY_SECRET_KEY : ""; } },
  { json(value) { payload = value; }, status() { return this; } }, (error) => { throw error; });
  assert.equal(payload.ok, false);
  assert.equal((await User.findById(user._id)).credit, 0);
  assert.equal(await PaymentReceipt.countDocuments({}), 0);
});

test("late genuine transfers are not lost after local order cancellation", async () => {
  const { topup } = await checkout();
  await Topup.findByIdAndUpdate(topup._id, { status: "rejected", rejectionReason: "expired", expiresAt: new Date(0) });
  const event = await verifiedEvent(topup);
  await settleTimoMailEvent(event._id);
  assert.equal((await User.findById(user._id)).credit, 50);
  const second = await verifiedEvent(topup);
  await assert.rejects(settleTimoMailEvent(second._id), { code: "TIMO_ORDER_ALREADY_HANDLED" });
  assert.equal((await User.findById(user._id)).credit, 50);
});

test("an unavailable Gmail account prevents creating a new payment order", async () => {
  mock.method(OAuth2Client.prototype, "request", async () => { throw Object.assign(new Error("private access token secret"), { response: { status: 401 } }); });
  await assert.rejects(checkout(), (error) => {
    assert.equal(error.code, "TIMO_GMAIL_UNAVAILABLE");
    assert.equal(JSON.stringify(error).includes("secret"), false);
    assert.equal(error.message.includes("token"), false);
    return true;
  });
  assert.equal(await Topup.countDocuments({}), 0);
});

test("Gmail failures expose only allowlisted diagnostics, never Google response secrets", async () => {
  const cases = [
    [{ response: { status: 401, data: { error: "invalid_client", error_description: "PRIVATE-CREDENTIAL" } } }, "INVALID_CLIENT"],
    [{ response: { status: 400, data: { error: "invalid_grant" } } }, "INVALID_GRANT"],
    [{ response: { status: 403, data: { error: { message: "PRIVATE-CREDENTIAL", details: [{ reason: "SERVICE_DISABLED" }] } } } }, "GMAIL_API_DISABLED"],
    [{ response: { status: 403, data: { error: { errors: [{ reason: "insufficientPermissions" }] } } } }, "INSUFFICIENT_SCOPE"],
    [{ response: { status: 429, data: {} } }, "RATE_LIMITED"],
    [{ code: "ENOTFOUND" }, "DNS_FAILED"],
    [{ code: "ETIMEDOUT" }, "TIMEOUT"],
    [{ code: "CERT_HAS_EXPIRED" }, "TLS_FAILED"],
    [{ response: { status: 500, data: { error: "PRIVATE-CREDENTIAL" } } }, "GOOGLE_UNAVAILABLE"],
    [{ response: { status: 400, data: { error: "PRIVATE-CREDENTIAL" } } }, "BAD_REQUEST"],
  ];
  for (const [failure, reason] of cases) {
    mock.method(OAuth2Client.prototype, "request", async () => { throw Object.assign(new Error("PRIVATE-CREDENTIAL"), failure, { config: { headers: { authorization: "Bearer PRIVATE-CREDENTIAL" } } }); });
    await assert.rejects(assertTimoMailbox(), (error) => {
      assert.equal(error.code, "TIMO_GMAIL_UNAVAILABLE");
      assert.equal(error.status, 503);
      assert.equal(error.gmailReason, reason);
      assert.ok(error.gmailHint);
      assert.equal(error.gmailStatus, failure.response?.status || 0);
      assert.equal(`${error.stack}\n${JSON.stringify(error)}`.includes("PRIVATE-CREDENTIAL"), false);
      return true;
    });
  }
});

test("mailbox reconciliation preserves sanitized Gmail reason and returns 503, not 500", async () => {
  mock.method(OAuth2Client.prototype, "request", async () => { throw Object.assign(new Error("PRIVATE-CREDENTIAL"), {
    response: { status: 400, data: { error: "invalid_grant", error_description: "PRIVATE-CREDENTIAL" } },
  }); });
  await assert.rejects(reconcileTimoOnce(), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.code, "TIMO_GMAIL_UNAVAILABLE");
    assert.equal(error.gmailReason, "INVALID_GRANT");
    assert.equal(JSON.stringify(error).includes("PRIVATE-CREDENTIAL"), false);
    return true;
  });
  const state = await State.findById(process.env.TIMO_GMAIL_ADDRESS);
  assert.equal(state.lastError, "TIMO_GMAIL_UNAVAILABLE (INVALID_GRANT)");
  assert.equal(state.lockOwner, "");
  assert.equal(await PaymentReceipt.countDocuments({}), 0);
  assert.equal((await User.findById(user._id)).credit, 0);
});

test("admin cancellation releases Timo voucher and purchase reservations for both order kinds", async () => {
  await Voucher.create({ code: "TIMOFIXTURE", discountPercent: 10, usageLimit: 10, usedCount: 0,
    perUserLimit: 2, appliesTo: "all", isActive: true, expireAt: new Date(Date.now() + 3600_000) });
  const { topup } = await checkout({ voucherCode: "TIMOFIXTURE" });
  const plan = await Plan.create({ code: "MONTH50", name: "Month50", price: 10000, durationDays: 30,
    dailyDownloadLimit: 50, billingPeriod: "month", isActive: true });
  const membership = await invoke(createMembershipCheckout, { planId: plan._id, paymentProvider: "timo", voucherCode: "TIMOFIXTURE" });
  assert.equal(await Reservation.countDocuments({ state: "held" }), 2);
  assert.equal((await Voucher.findOne({ code: "TIMOFIXTURE" })).usedCount, 2);
  await invoke(adminCancelTopup, {}, { params: { id: topup._id } });
  await invoke(adminCancelMembershipOrder, {}, { params: { id: membership.payload.order._id } });
  assert.equal(await Reservation.countDocuments({ state: "held" }), 0);
  assert.equal((await Voucher.findOne({ code: "TIMOFIXTURE" })).usedCount, 0);
  assert.equal((await User.findById(user._id)).credit, 0);
  assert.equal(await PaymentReceipt.countDocuments({}), 0);
});

test("a mismatched Gmail message identity stays in review without granting funds", async () => {
  const { topup } = await checkout();
  const eventId = `${process.env.TIMO_GMAIL_ADDRESS}:abc123`;
  await Event.create({ _id: eventId, gmailMessageId: "abc123", mailbox: process.env.TIMO_GMAIL_ADDRESS,
    accountNo: process.env.TIMO_ACCOUNT_NO, state: "pending", attempts: 0, nextAttemptAt: new Date(0) });
  const raw = await signedEmail({ code: topup.paymentCode });
  mock.method(OAuth2Client.prototype, "request", async (options) => {
    if (options.url.endsWith("/profile")) return { data: { emailAddress: process.env.TIMO_GMAIL_ADDRESS } };
    if (options.url.endsWith("/messages")) return { data: { messages: [] } };
    // A malformed MIME representation from the mailbox must never reach settlement.
    return { data: { id: "wrong-id", internalDate: String(Date.now()), raw: raw.toString("base64url") } };
  });
  await reconcileTimoOnce();
  assert.equal((await Event.findById(eventId)).state, "review");
  assert.equal((await User.findById(user._id)).credit, 0);
});

test("admin switches VND routing persistently without changing env or leaking credentials", async () => {
  const initial = await invoke(adminPaymentProvider);
  assert.equal(initial.payload.source, "env");
  assert.equal(initial.payload.provider, "timo");
  const result = await invoke(adminUpdatePaymentProvider, { provider: "sepay" });
  assert.equal(result.payload.source, "database");
  assert.equal(result.payload.provider, "sepay");
  assert.equal(process.env.VND_PAYMENT_PROVIDER, "timo");
  assert.equal(JSON.stringify(result.payload).includes("fixture-secret"), false);
  assert.equal((await vndPaymentRouting()).provider, "sepay");
  await invoke(adminUpdatePaymentProvider, { provider: "env" });
  assert.equal((await vndPaymentRouting()).provider, "timo");
  assert.equal((await vndPaymentRouting()).source, "env");
});

test("switching to incomplete or mismatched Gmail configuration never changes routing", async () => {
  await invoke(adminUpdatePaymentProvider, { provider: "sepay" });
  process.env.TIMO_GMAIL_REFRESH_TOKEN = "";
  const missing = await invoke(adminUpdatePaymentProvider, { provider: "timo" });
  assert.equal(missing.status, 409);
  assert.equal(missing.payload.code, "PAYMENT_PROVIDER_NOT_READY");
  process.env.TIMO_GMAIL_REFRESH_TOKEN = "fixture-refresh";
  mock.method(OAuth2Client.prototype, "request", async () => ({ data: { emailAddress: "wrong@gmail.com" } }));
  await assert.rejects(invoke(adminUpdatePaymentProvider, { provider: "timo" }), { code: "TIMO_GMAIL_ACCOUNT_MISMATCH" });
  assert.equal((await vndPaymentRouting()).provider, "sepay");
});

test("routing rejects unsupported providers and credential fields in admin requests", async () => {
  for (const body of [{ provider: "paypal" }, { provider: "timo", secret: "injected" }, { provider: { value: "timo" } }]) {
    assert.equal((await invoke(adminUpdatePaymentProvider, body)).status, 400);
  }
  assert.equal(await SiteSetting.countDocuments({}), 0);
});

test("legacy Credit and Subscription requests use the current admin-selected VND provider", async () => {
  process.env.VND_PAYMENT_PROVIDER = "sepay";
  await invoke(adminUpdatePaymentProvider, { provider: "timo" });
  const topup = await invoke(createTopup, { packageId: pack._id });
  const plan = await Plan.create({ code: "MONTH50", name: "Month50", price: 10000, durationDays: 30,
    dailyDownloadLimit: 50, billingPeriod: "month", isActive: true });
  const membership = await invoke(createMembershipCheckout, { planId: plan._id });
  assert.equal(topup.payload.payment.provider, "timo");
  assert.equal(membership.payload.payment.provider, "timo");
});

test("a provider switch preserves pending Credit and Subscription replays and settlement", async () => {
  const { topup } = await checkout();
  const plan = await Plan.create({ code: "MONTH50", name: "Month50", price: 10000, durationDays: 30,
    dailyDownloadLimit: 50, billingPeriod: "month", isActive: true });
  const membership = await invoke(createMembershipCheckout, { planId: plan._id, paymentProvider: "timo" });
  await invoke(adminUpdatePaymentProvider, { provider: "sepay" });
  const replay = await invoke(createTopup, { packageId: pack._id });
  const replayMembership = await invoke(createMembershipCheckout, { planId: plan._id });
  assert.equal(replay.payload.payment.provider, "timo");
  assert.equal(replayMembership.payload.payment.provider, "timo");
  const event = await verifiedEvent(topup);
  await settleTimoMailEvent(event._id);
  assert.equal((await User.findById(user._id)).credit, 50);
  assert.equal(await MembershipOrder.countDocuments({}), 1);
  assert.equal(membership.payload.order._id, replayMembership.payload.order._id);
});

test("stale VND checkout is rejected before creating an order; PayPal remains independent", async () => {
  await invoke(adminUpdatePaymentProvider, { provider: "sepay" });
  await assert.rejects(checkout(), { code: "PAYMENT_PROVIDER_CHANGED" });
  assert.equal(await Topup.countDocuments({}), 0);
  assert.equal(await newPaymentProvider("paypal"), "paypal");
  const latest = await invoke(createTopup, { packageId: pack._id });
  assert.equal(latest.payload.payment.provider, "sepay");
});

test("legacy internal-free orders without a requested provider still replay after switching", async () => {
  const plan = await Plan.create({ code: "TRIAL", name: "Trial", price: 0, durationDays: 7,
    dailyDownloadLimit: 100, isActive: true });
  const first = await invoke(createMembershipCheckout, { planId: plan._id });
  await MembershipOrder.findByIdAndUpdate(first.payload.order._id, { $unset: { requestedPaymentProvider: "" } });
  await invoke(adminUpdatePaymentProvider, { provider: "sepay" });
  const replay = await invoke(createMembershipCheckout, { planId: plan._id });
  assert.equal(replay.payload.status, "approved");
  assert.equal(replay.payload.payment, null);
  assert.equal(await MembershipOrder.countDocuments({}), 1);
});

test("HTTP admin provider changes require login, admin, 2FA and CSRF", async (t) => {
  process.env.ADMIN_EMAILS = user.email;
  process.env.ADMIN_2FA_REQUIRED = "true";
  const app = express();
  app.use(express.json(), cookieParser());
  app.use((req, _res, next) => {
    req.user = req.get("x-fixture-role") ? { ...user, role: req.get("x-fixture-role"), isTwoFactorEnabled: true } : undefined;
    req.jwtPayload = { is2FAVerified: req.get("x-fixture-2fa") === "yes" };
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.get("/api/auth/csrf", issueCsrfToken);
  app.use(csrfProtection);
  app.use("/api/admin", adminRoutes);
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokenResponse = await fetch(base + "/api/auth/csrf");
  const { csrfToken } = await tokenResponse.json();
  const headers = { "content-type": "application/json", "x-csrf-token": csrfToken,
    cookie: tokenResponse.headers.get("set-cookie").split(";")[0], "x-fixture-role": "admin", "x-fixture-2fa": "yes" };
  const patch = (overrides) => fetch(base + "/api/admin/payments/provider", {
    method: "PATCH", headers: { ...headers, ...overrides }, body: JSON.stringify({ provider: "sepay" }),
  });
  assert.equal((await patch({ "x-fixture-role": "" })).status, 401);
  assert.equal((await patch({ "x-fixture-role": "user" })).status, 403);
  assert.equal((await patch({ "x-fixture-2fa": "" })).status, 403);
  assert.equal((await patch({ "x-csrf-token": "" })).status, 403);
  assert.equal(await SiteSetting.countDocuments({}), 0);
  assert.equal((await patch({})).status, 200);
  assert.equal((await vndPaymentRouting()).provider, "sepay");
});
