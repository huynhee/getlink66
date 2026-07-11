import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
process.env.SEPAY_ENABLED = "true";
process.env.SEPAY_ENV = "sandbox";
process.env.SEPAY_MERCHANT_ID = "test-merchant";
process.env.SEPAY_SECRET_KEY = "test-secret-key";
process.env.CLIENT_URL = "http://localhost:5173";

const { default: User } = await import("../src/models/User.js");
const { default: MembershipPlan } = await import("../src/models/MembershipPlan.js");
const { default: MembershipOrder } = await import("../src/models/MembershipOrder.js");
const { createMembershipCheckout } = await import("../src/controllers/membershipController.js");

async function invokeCheckout(req) {
  let status = 200;
  let payload;
  await createMembershipCheckout(
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

test("membership checkout replays the same idempotent order", async () => {
  const user = await User.create({ email: "member-idempotency@example.test", name: "Member" });
  const plan = await MembershipPlan.create({
    code: "TEST-MONTH",
    name: "Test month",
    price: 199000,
    durationDays: 30,
    dailyDownloadLimit: 100,
    isActive: true,
  });
  const key = "membership-idempotency-test-0001";
  const req = {
    user,
    body: { planId: plan._id },
    get(name) {
      return String(name).toLowerCase() === "idempotency-key" ? key : "";
    },
  };

  const first = await invokeCheckout(req);
  const second = await invokeCheckout(req);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.payload.idempotentReplay, true);
  assert.equal(String(second.payload.order._id), String(first.payload.order._id));
  assert.equal(await MembershipOrder.countDocuments({ userId: user._id }), 1);
});

test("membership idempotency key cannot be reused for another plan", async () => {
  const user = await User.create({ email: "member-conflict@example.test", name: "Conflict" });
  const firstPlan = await MembershipPlan.create({
    code: "TEST-FIRST",
    name: "First",
    price: 100000,
    durationDays: 30,
    isActive: true,
  });
  const secondPlan = await MembershipPlan.create({
    code: "TEST-SECOND",
    name: "Second",
    price: 200000,
    durationDays: 90,
    isActive: true,
  });
  const key = "membership-idempotency-conflict-0001";
  const request = (planId) => ({
    user,
    body: { planId },
    get(name) {
      return String(name).toLowerCase() === "idempotency-key" ? key : "";
    },
  });

  const first = await invokeCheckout(request(firstPlan._id));
  const conflict = await invokeCheckout(request(secondPlan._id));

  assert.equal(first.status, 200);
  assert.equal(conflict.status, 409);
  assert.match(conflict.payload.message, /already used/i);
  assert.equal(await MembershipOrder.countDocuments({ userId: user._id }), 1);
});
