import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: Topup } = await import("../src/models/Topup.js");
const { default: Getlink } = await import("../src/models/Getlink.js");
const { default: MembershipOrder } = await import("../src/models/MembershipOrder.js");
const { buildUserTimeline } = await import("../src/utils/timelineService.js");

test("timeline reports exact totals beyond the first page and hides upstream URLs", async () => {
  const user = await User.create({ email: "timeline@example.test", name: "Timeline" });
  for (let index = 0; index < 25; index += 1) {
    await Topup.create({
      userId: user._id,
      amount: 10000,
      credit: 10,
      type: "sepay",
      status: "approved",
      paymentCode: `NAPTIMELINE${String(index).padStart(6, "0")}`,
    });
  }
  await Getlink.create({
    userId: user._id,
    productId: "MODEL123456",
    title: "Private source test",
    sourceUrl: "https://www.3d66.com/model/private",
    resolvedSourceUrl: "https://www.3d66.com/model/private?sign=secret",
    imageUrl: "https://respic.3d66.com/private.jpg",
    creditUsed: 10,
  });

  const page = await buildUserTimeline({ userId: user._id, type: "all", page: 2, limit: 10 });
  const getlink = (await buildUserTimeline({ userId: user._id, type: "getlink", page: 1, limit: 10 })).events[0];

  assert.equal(page.pagination.total, 26);
  assert.equal(page.pagination.totalPages, 3);
  assert.equal(page.events.length, 10);
  assert.equal("sourceUrl" in getlink.metadata, false);
  assert.equal("resolvedSourceUrl" in getlink.metadata, false);
  assert.equal("imageUrl" in getlink.metadata, false);
});

test("approved Pro vouchers appear in the voucher timeline", async () => {
  const user = await User.create({ email: "timeline-pro-voucher@example.test", name: "Voucher" });
  await MembershipOrder.create({
    userId: user._id,
    planId: "timeline-plan",
    planCode: "SILVER",
    planName: "Silver",
    amount: 150000,
    discountAmount: 49000,
    voucherCode: "PROTIMELINE",
    durationDays: 30,
    status: "approved",
    paymentCode: "PROTIMELINE123456",
    paidAt: new Date(),
  });

  const timeline = await buildUserTimeline({ userId: user._id, type: "voucher", page: 1, limit: 10 });
  assert.equal(timeline.pagination.total, 1);
  assert.equal(timeline.events[0].metadata.targetKind, "pro");
  assert.equal(timeline.events[0].metadata.discountAmount, 49000);
});

test("all timeline does not duplicate a Credit transaction as a voucher event", async () => {
  const user = await User.create({ email: "timeline-credit-voucher@example.test", name: "Credit voucher" });
  await Topup.create({
    userId: user._id,
    amount: 90000,
    originalAmount: 100000,
    discountAmount: 10000,
    credit: 100,
    voucherCode: "CREDITLINE",
    type: "sepay",
    status: "approved",
    paymentCode: "CREDITLINE123456",
    paidAt: new Date(),
  });
  const all = await buildUserTimeline({ userId: user._id, type: "all", page: 1, limit: 10 });
  const vouchers = await buildUserTimeline({ userId: user._id, type: "voucher", page: 1, limit: 10 });

  assert.equal(all.pagination.total, 1);
  assert.equal(all.events[0].type, "credit");
  assert.equal(all.events[0].amount, 100);
  assert.equal(vouchers.pagination.total, 1);
  assert.equal(vouchers.events[0].type, "voucher");
  assert.equal(vouchers.events[0].metadata.targetKind, "credit");
});

test("pending payments expose planned values without reporting completed balance movement", async () => {
  const user = await User.create({ email: "timeline-pending@example.test", name: "Pending" });
  await Topup.create({
    userId: user._id,
    amount: 100000,
    credit: 100,
    type: "sepay",
    status: "pending",
    paymentCode: "PENDINGCREDIT123",
  });
  await MembershipOrder.create({
    userId: user._id,
    planId: "pending-plan",
    planCode: "GOLD",
    planName: "Gold",
    amount: 149000,
    durationDays: 90,
    status: "pending",
    paymentCode: "PENDINGPRO123456",
  });

  const credit = (await buildUserTimeline({ userId: user._id, type: "credit" })).events[0];
  const pro = (await buildUserTimeline({ userId: user._id, type: "pro" })).events[0];

  assert.equal(credit.amount, 0);
  assert.equal(credit.metadata.creditAmount, 100);
  assert.equal(pro.amount, 0);
  assert.equal(pro.metadata.amountMoney, 149000);
});

test("manual credit adjustment exposes the balance change in user history", async () => {
  const user = await User.create({ email: "timeline-manual-credit@example.test", name: "Manual credit" });
  await Topup.create({
    userId: user._id,
    amount: 0,
    credit: -6,
    type: "manual",
    status: "approved",
    paidAt: new Date(),
    manualBalanceBefore: 10,
    manualBalanceAfter: 4,
  });

  const event = (await buildUserTimeline({ userId: user._id, type: "credit" })).events[0];
  assert.equal(event.title, "Admin điều chỉnh credit");
  assert.equal(event.amount, -6);
  assert.equal(event.metadata.isManualAdjustment, true);
  assert.equal(event.metadata.manualBalanceBefore, 10);
  assert.equal(event.metadata.manualBalanceAfter, 4);
});
