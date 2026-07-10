import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
process.env.SEPAY_SECRET_KEY = "test-sepay-secret";

const { default: User } = await import("../src/models/User.js");
const { default: Topup } = await import("../src/models/Topup.js");
const { sepayIpn } = await import("../src/controllers/paymentController.js");

function sepayRequest(paymentCode, transactionId) {
  return {
    body: {
      notification_type: "ORDER_PAID",
      order: { order_invoice_number: paymentCode, order_amount: 1000 },
      transaction: {
        transaction_status: "APPROVED",
        transaction_id: transactionId,
        transaction_amount: 1000,
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

test("a signed late SePay payment reopens an expired order exactly once", async () => {
  const user = await User.create({
    email: "late-payment@example.test",
    name: "Late payment",
    credit: 0,
  });
  const topup = await Topup.create({
    userId: user._id,
    amount: 1000,
    credit: 10,
    type: "sepay",
    status: "rejected",
    paymentCode: "NAPLATE123456",
    gatewayProvider: "sepay",
    rejectionReason: "expired",
  });

  const first = await invokeIpn(sepayRequest(topup.paymentCode, "late-tx-1"));
  assert.equal(first.status, 200);
  assert.equal(first.payload.ok, true);
  assert.equal(first.payload.creditAdded, 10);
  assert.equal((await User.findById(user._id)).credit, 10);

  const second = await invokeIpn(sepayRequest(topup.paymentCode, "late-tx-1"));
  assert.equal(second.payload.duplicate, true);
  assert.equal((await User.findById(user._id)).credit, 10);
});
