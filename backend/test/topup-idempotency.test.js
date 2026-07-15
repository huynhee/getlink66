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
const { default: Topup } = await import("../src/models/Topup.js");
const { default: TopupPackage } = await import("../src/models/TopupPackage.js");
const { createTopup, getPackages } = await import("../src/controllers/topupController.js");

async function invokeCreateTopup(req) {
  let status = 200;
  let payload;
  await createTopup(
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
      status = Number(error?.status || 500);
      payload = { message: error?.message || "Unknown error" };
    },
  );
  return { status, payload };
}

async function invokeGetPackages() {
  let payload;
  let caught;
  await getPackages(
    {},
    {
      json(value) {
        payload = value;
        return value;
      },
    },
    (error) => {
      caught = error;
    },
  );
  if (caught) throw caught;
  return payload;
}

test("Credit package migration creates the requested five-package catalog once", async () => {
  await Topup.deleteMany({});
  await TopupPackage.deleteMany({});
  await TopupPackage.create({
    name: "GÓI STARTER",
    price: 50000,
    credit: 140,
    salePercent: 0,
    features: ["Old package"],
    isActive: true,
    sortOrder: 10,
  });

  const first = await invokeGetPackages();
  assert.equal(first.packages.length, 5);
  assert.deepEqual(
    first.packages.map((pack) => pack.code),
    ["EXPERIENCE", "STARTER", "BASIC", "PRO_CREDIT", "TEAM"],
  );

  const experience = first.packages[0];
  assert.equal(experience.price, 10000);
  assert.equal(experience.credit, 28);
  assert.equal(experience.maxTopupsPerUser, 1);

  const basic = first.packages.find((pack) => pack.code === "BASIC");
  assert.equal(basic.price, 130000);
  assert.equal(basic.salePrice, 120000);
  assert.equal(basic.salePercent, 7);

  const starter = first.packages.find((pack) => pack.code === "STARTER");
  await TopupPackage.findByIdAndUpdate(starter._id, { price: 66000 });
  const second = await invokeGetPackages();
  assert.equal(second.packages.find((pack) => pack.code === "STARTER").price, 66000);
});

test("Experience package allows only one active top-up per account", async () => {
  await Topup.deleteMany({});
  const user = await User.create({
    email: "experience-limit@example.test",
    name: "Experience limit",
    credit: 0,
  });
  const pack = await TopupPackage.findOne({ code: "EXPERIENCE" });
  const makeRequest = (key) => ({
    user,
    body: { packageId: pack._id, type: "sepay" },
    get(name) {
      return String(name).toLowerCase() === "idempotency-key" ? key : "";
    },
  });

  const first = await invokeCreateTopup(makeRequest("experience-limit-test-0001"));
  const second = await invokeCreateTopup(makeRequest("experience-limit-test-0002"));

  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.match(second.payload.message, /giới hạn nạp gói này/i);
  assert.equal(await Topup.countDocuments({ userId: user._id, packageId: pack._id }), 1);
});

test("topup idempotency key returns the original order", async () => {
  const user = await User.create({
    email: "idempotency@example.test",
    name: "Idempotency",
    credit: 0,
  });
  const pack = await TopupPackage.create({
    name: "TEST",
    price: 10000,
    credit: 10,
    isActive: true,
  });
  const key = "topup-idempotency-test-0001";
  const req = {
    user,
    body: { packageId: pack._id, type: "sepay" },
    get(name) {
      return String(name).toLowerCase() === "idempotency-key" ? key : "";
    },
  };

  const first = await invokeCreateTopup(req);
  const second = await invokeCreateTopup(req);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.payload.idempotentReplay, true);
  assert.equal(String(second.payload.topup._id), String(first.payload.topup._id));
  assert.equal(await Topup.countDocuments({ userId: user._id }), 1);
});

test("topup idempotency key rejects a different request", async () => {
  const user = await User.create({
    email: "idempotency-conflict@example.test",
    name: "Idempotency conflict",
    credit: 0,
  });
  const firstPack = await TopupPackage.create({
    name: "FIRST TEST",
    price: 10000,
    credit: 10,
    isActive: true,
  });
  const secondPack = await TopupPackage.create({
    name: "SECOND TEST",
    price: 20000,
    credit: 20,
    isActive: true,
  });
  const key = "topup-idempotency-conflict-0001";
  const makeRequest = (packageId) => ({
    user,
    body: { packageId, type: "sepay" },
    get(name) {
      return String(name).toLowerCase() === "idempotency-key" ? key : "";
    },
  });

  const first = await invokeCreateTopup(makeRequest(firstPack._id));
  const conflict = await invokeCreateTopup(makeRequest(secondPack._id));

  assert.equal(first.status, 200);
  assert.equal(conflict.status, 409);
  assert.match(conflict.payload.message, /already used/i);
  assert.equal(await Topup.countDocuments({ userId: user._id }), 1);
});
