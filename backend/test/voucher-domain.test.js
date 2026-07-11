import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: Topup } = await import("../src/models/Topup.js");
const { default: Voucher } = await import("../src/models/Voucher.js");
const { updateVoucher, deleteVoucher } = await import("../src/controllers/adminController.js");
const { assertVoucherTarget } = await import("../src/utils/voucherCheckoutService.js");
const { voucherUnavailableMessage } = await import("../src/utils/voucherStatus.js");

function mockResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return payload;
    },
  };
}

function nextOrThrow(error) {
  if (error) throw error;
}

test("voucher scope matrix keeps Credit, Pro, and shared vouchers distinct", () => {
  const credit = { targetKind: "credit", discountPercent: 10, creditBonus: 2 };
  const pro = { targetKind: "pro", discountPercent: 10, creditBonus: 0 };
  const shared = { targetKind: "all", discountPercent: 10, creditBonus: 0 };

  assert.doesNotThrow(() => assertVoucherTarget(credit, { target: "topup" }));
  assert.throws(() => assertVoucherTarget(credit, { target: "membership" }), /Credit/);
  assert.doesNotThrow(() => assertVoucherTarget(pro, { target: "membership" }));
  assert.throws(() => assertVoucherTarget(pro, { target: "topup" }), /Pro/);
  assert.doesNotThrow(() => assertVoucherTarget(shared, { target: "topup" }));
  assert.doesNotThrow(() => assertVoucherTarget(shared, { target: "membership" }));
  assert.throws(() => assertVoucherTarget(shared, { target: "unknown" }), /không hợp lệ/);
});

test("vouchers with transactions keep immutable identity and archive instead of deleting", async () => {
  const user = await User.create({ email: "voucher-lock@example.test", name: "Voucher lock" });
  const voucher = await Voucher.create({
    code: "LOCKED2026",
    targetKind: "credit",
    isActive: true,
    creditBonus: 5,
    discountPercent: 0,
    usageLimit: 10,
    perUserLimit: 1,
    applicablePackageIds: [],
    expireAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  await Topup.create({
    userId: user._id,
    amount: 100000,
    credit: 105,
    voucherCode: voucher.code,
    type: "sepay",
    status: "pending",
    paymentCode: "LOCKEDVOUCHER123",
  });

  const updateResponse = mockResponse();
  await updateVoucher({
    params: { id: voucher._id },
    body: {
      code: voucher.code,
      targetKind: "pro",
      isActive: true,
      creditBonus: 0,
      discountPercent: 10,
      usageLimit: 10,
      perUserLimit: 1,
      applicablePackageIds: [],
      expireAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
      description: "",
    },
  }, updateResponse, nextOrThrow);
  assert.equal(updateResponse.statusCode, 409);
  assert.match(updateResponse.payload.message, /phạm vi/);

  const deleteResponse = mockResponse();
  await deleteVoucher({ params: { id: voucher._id } }, deleteResponse, nextOrThrow);
  const archived = await Voucher.findById(voucher._id);

  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(deleteResponse.payload.archived, true);
  assert.equal(archived.isActive, false);
  assert.equal(voucherUnavailableMessage(archived), "Voucher đã ngừng hoạt động.");
});
