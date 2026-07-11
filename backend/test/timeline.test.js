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
