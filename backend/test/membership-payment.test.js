import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
process.env.SEPAY_SECRET_KEY = "test-sepay-secret";

const { default: User } = await import("../src/models/User.js");
const { default: MembershipOrder } = await import("../src/models/MembershipOrder.js");
const { default: DailyDownloadQuota } = await import("../src/models/DailyDownloadQuota.js");
const { default: PaymentReceipt } = await import("../src/models/PaymentReceipt.js");
const { sepayIpn } = await import("../src/controllers/paymentController.js");
const { approvePendingMembershipOrder, vietnamDayKey } = await import("../src/utils/membershipService.js");

function sepayRequest(paymentCode, transactionId, amount = 50000) {
  return {
    body: {
      notification_type: "ORDER_PAID",
      order: { order_invoice_number: paymentCode, order_amount: amount },
      transaction: {
        transaction_status: "APPROVED",
        transaction_id: transactionId,
        transaction_amount: amount,
      },
    },
    get(name) {
      if (String(name).toLowerCase() === "content-type") return "application/json";
      if (String(name).toLowerCase() === "x-secret-key") return "test-sepay-secret";
      return "";
    },
  };
}

async function invokeIpn(req) {
  let status = 200;
  let payload;
  await sepayIpn(
    req,
    {
      status(code) {
        status = code;
        return this;
      },
      json(value) {
        payload = value;
        return value;
      },
    },
    (error) => {
      throw error;
    },
  );
  return { status, payload };
}

test("a signed late Pro payment activates once", async () => {
  const user = await User.create({ email: "late-pro@example.test", name: "Late Pro" });
  const order = await MembershipOrder.create({
    userId: user._id,
    planId: "plan-late-pro",
    planCode: "SILVER",
    planName: "Silver",
    amount: 50000,
    durationDays: 30,
    dailyDownloadLimit: 100,
    status: "rejected",
    paymentCode: "PROLATE123456",
    gatewayProvider: "sepay",
    rejectionReason: "expired",
  });

  const first = await invokeIpn(sepayRequest(order.paymentCode, "late-pro-tx-1"));
  assert.equal(first.status, 200);
  assert.equal(first.payload.ok, true);
  const activatedUser = await User.findById(user._id);
  assert.ok(new Date(activatedUser.proUntil) > new Date());

  const second = await invokeIpn(sepayRequest(order.paymentCode, "late-pro-tx-1"));
  assert.equal(second.payload.ok, true);
  assert.equal(second.payload.duplicate, true);
  assert.equal(
    new Date((await User.findById(user._id)).proUntil).getTime(),
    new Date(activatedUser.proUntil).getTime(),
  );
});

test("daily plan adds quota without replacing an active monthly expiry", async () => {
  const originalExpiry = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  const user = await User.create({
    email: "daily-addon@example.test",
    name: "Daily add-on",
    proUntil: originalExpiry,
    proDailyDownloadLimit: 100,
  });
  const order = await MembershipOrder.create({
    userId: user._id,
    planId: "plan-daily-addon",
    planCode: "DAILY",
    planName: "Daily",
    amount: 50000,
    durationDays: 1,
    dailyDownloadLimit: 100,
    status: "pending",
    paymentCode: "PRODAILY123456",
  });

  const result = await approvePendingMembershipOrder(order);
  const updatedUser = await User.findById(user._id);
  const quota = await DailyDownloadQuota.findOne({
    dayKey: vietnamDayKey(),
    userId: user._id,
    tier: "member",
  });

  assert.equal(result.order.isQuotaAddon, true);
  assert.equal(new Date(updatedUser.proUntil).getTime(), originalExpiry.getTime());
  assert.equal(quota.bonusLimit, 100);
});

test("a bank transaction claimed by Credit cannot activate Pro", async () => {
  const user = await User.create({ email: "cross-payment@example.test", name: "Cross payment" });
  const order = await MembershipOrder.create({
    userId: user._id,
    planId: "cross-plan",
    planCode: "SILVER",
    planName: "Silver",
    amount: 199000,
    durationDays: 30,
    status: "pending",
    paymentCode: "PROCROSS123456",
  });
  await PaymentReceipt.create({
    gatewayTransactionId: "cross-kind-transaction-1",
    provider: "sepay",
    topupId: "credit-topup-id",
    amount: 199000,
  });

  await assert.rejects(
    approvePendingMembershipOrder(order, {
      gatewayProvider: "sepay",
      gatewayTransactionId: "cross-kind-transaction-1",
    }),
    (error) => error?.code === "DUPLICATE_GATEWAY_TRANSACTION",
  );
  assert.equal((await MembershipOrder.findById(order._id)).status, "pending");
  assert.equal((await User.findById(user._id)).proUntil || null, null);
});
