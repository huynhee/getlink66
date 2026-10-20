import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const { default: Topup } = await import("../src/models/Topup.js");
const { default: MembershipOrder } = await import("../src/models/MembershipOrder.js");
const { getOverview } = await import("../src/controllers/adminController.js");

beforeEach(async () => {
  await Topup.deleteMany({});
  await MembershipOrder.deleteMany({});
});

async function overview(period = "day") {
  let payload;
  await getOverview({ query: { period } }, { json(value) { payload = value; } }, (error) => { throw error; });
  return payload.overview;
}

function topup(fields = {}) {
  return Topup.create({ userId: "000000000000000000000001", amount: 10000, credit: 50,
    status: "approved", paidAt: new Date(), ...fields });
}

function membership(fields = {}) {
  return MembershipOrder.create({ userId: "000000000000000000000001", planId: "000000000000000000000002",
    planName: "Fixture subscription", amount: 20000, durationDays: 30, dailyDownloadLimit: 50,
    paymentCode: `PROFIXTURE${crypto.randomUUID()}`, status: "approved", paidAt: new Date(), ...fields });
}

function chartTotals(rows) {
  return rows.reduce((total, row) => ({ revenue: total.revenue + row.revenue, count: total.count + row.count }), { revenue: 0, count: 0 });
}

test("overview combines SePay and Timo Credit/Subscription revenue in VND, with PayPal separate", async () => {
  await topup({ gatewayProvider: "sepay", currency: "VND", amount: 50000, amountMinor: 50000 });
  await topup({ gatewayProvider: "timo", currency: "VND" });
  await topup({ amount: 20000 });
  await membership({ gatewayProvider: "sepay", currency: "VND", amount: 199000 });
  await membership({ gatewayProvider: "timo", currency: "VND", isQuotaAddon: true });
  await membership({ gatewayProvider: "timo", currency: "VND", amount: 50000 });
  await topup({ gatewayProvider: "paypal", currency: "USD", amount: 1.25, amountMinor: 125 });
  await membership({ gatewayProvider: "paypal", currency: "USD", amount: 3.75, amountMinor: 375 });
  for (const gatewayProvider of ["sepay", "timo", "paypal"]) {
    for (const status of ["pending", "rejected"]) {
      await topup({ gatewayProvider, status, amount: 900000, expiresAt: new Date(Date.now() + 3600_000) });
      await membership({ gatewayProvider, status, amount: 900000 });
    }
  }
  for (const period of ["day", "month", "year"]) {
    const data = await overview(period);
    assert.deepEqual(chartTotals(data.revenueChart), { revenue: 349000, count: 6 });
    assert.deepEqual(chartTotals(data.usdRevenueChart), { revenue: 5, count: 2 });
    assert.equal(data.revenue, 349000);
    assert.equal(data.todayRevenue, 349000);
    assert.equal(data.weekRevenue, 349000);
    assert.equal(data.revenueByCurrency.VND.creditRevenueMinor, 80000);
    assert.equal(data.revenueByCurrency.VND.proRevenueMinor, 269000);
    assert.equal(data.revenueByCurrency.USD.grossMinor, 500);
    assert.equal(data.averageTopupAmount, 26667);
    assert.equal(data.approvedTopups, 4);
    assert.equal(data.topPackages.reduce((sum, row) => sum + row.revenue, 0), 80000);
  }
  assert.equal(await Topup.countDocuments({ status: "pending" }), 3);
  assert.equal(await MembershipOrder.countDocuments({ status: "pending" }), 3);
});

test("revenue buckets use the payment date and Vietnam midnight for both providers and currencies", async () => {
  const shifted = new Date(Date.now() + 7 * 3600_000);
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 7 * 3600_000;
  const before = new Date(midnight - 1);
  const after = new Date(midnight + 1);
  const todayKey = shifted.toISOString().slice(0, 10);
  const yesterdayKey = new Date(midnight - 1 + 7 * 3600_000).toISOString().slice(0, 10);
  await topup({ gatewayProvider: "sepay", paidAt: before });
  await topup({ paidAt: null, amount: 5000 });
  await membership({ gatewayProvider: "timo", paidAt: after });
  await topup({ gatewayProvider: "paypal", currency: "USD", amount: 1, paidAt: before });
  await membership({ gatewayProvider: "paypal", currency: "USD", amount: 2, paidAt: after });
  const data = await overview();
  assert.equal(data.revenueChart.find((row) => row.date === yesterdayKey).revenue, 10000);
  assert.equal(data.revenueChart.find((row) => row.date === todayKey).revenue, 25000);
  assert.equal(data.usdRevenueChart.find((row) => row.date === yesterdayKey).revenue, 1);
  assert.equal(data.usdRevenueChart.find((row) => row.date === todayKey).revenue, 2);
  assert.equal(data.todayRevenue, 25000);
  assert.equal(data.weekRevenue, 35000);
});

test("charts honor immutable minor-unit snapshots, legacy prices and exact USD cents", async () => {
  await topup({ currency: "VND", amount: 900000, amountMinor: 25000 });
  await membership({ gatewayProvider: "timo", currency: "VND", amount: 900000, amountMinor: 15000 });
  await membership({ gatewayProvider: "internal_free", amount: 10000, amountMinor: 0 });
  await topup({ gatewayProvider: "paypal", currency: "USD", amount: 0.1 });
  await membership({ gatewayProvider: "paypal", currency: "USD", amount: 0.2 });
  const data = await overview();
  assert.deepEqual(chartTotals(data.revenueChart), { revenue: 40000, count: 3 });
  assert.deepEqual(chartTotals(data.usdRevenueChart), { revenue: 0.3, count: 2 });
  assert.equal(data.revenue, data.revenueByCurrency.VND.grossMinor);
  assert.equal(data.todayRevenue, 40000);
  assert.equal(data.weekRevenue, 40000);
});

test("a subscription-only catalog has VND revenue without a Credit topup", async () => {
  await membership({ gatewayProvider: "timo" });
  await membership({ gatewayProvider: "sepay", amount: 30000 });
  const data = await overview();
  assert.deepEqual(chartTotals(data.revenueChart), { revenue: 50000, count: 2 });
  assert.deepEqual(chartTotals(data.usdRevenueChart), { revenue: 0, count: 0 });
  assert.equal(data.revenue, 50000);
  assert.equal(data.averageTopupAmount, 0);
  assert.equal(data.approvedTopups, 0);
  assert.deepEqual(data.topPackages, []);
});

test("empty revenue charts preserve their period lengths and invalid-period fallback", async () => {
  for (const [period, length] of [["day", 14], ["month", 12], ["year", 5], ["invalid", 14]]) {
    const data = await overview(period);
    assert.equal(data.revenueChart.length, length);
    assert.equal(data.usdRevenueChart.length, length);
    assert.deepEqual(chartTotals(data.revenueChart), { revenue: 0, count: 0 });
    assert.deepEqual(chartTotals(data.usdRevenueChart), { revenue: 0, count: 0 });
  }
});
