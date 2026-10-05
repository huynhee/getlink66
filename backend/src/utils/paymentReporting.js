import { paymentReceiptMoney } from "./paymentMoney.js";

export function paymentSummary(topups = [], memberships = []) {
  const totals = {
    VND: { currency: "VND", creditRevenueMinor: 0, proRevenueMinor: 0, grossMinor: 0, feesMinor: 0, refundedMinor: 0, netMinor: 0, count: 0 },
    USD: { currency: "USD", creditRevenueMinor: 0, proRevenueMinor: 0, grossMinor: 0, feesMinor: 0, refundedMinor: 0, netMinor: 0, count: 0 },
  };
  for (const [rows, key] of [[topups, "creditRevenueMinor"], [memberships, "proRevenueMinor"]]) {
    for (const row of rows) {
      const { currency, amountMinor } = paymentReceiptMoney(row);
      const total = totals[currency];
      if (!total) continue;
      total[key] += amountMinor;
      total.grossMinor += amountMinor;
      total.count += 1;
      if (row.gatewayProvider === "paypal") {
        total.feesMinor += Number(row.paypalFeeMinor || 0);
        total.refundedMinor += Number(row.paypalRefundMinor || 0);
      }
    }
  }
  for (const total of Object.values(totals)) total.netMinor = total.grossMinor - total.feesMinor - total.refundedMinor;
  return totals;
}

export function paymentRecordFields(order) {
  return {
    ...paymentReceiptMoney(order),
    paypalEnvironment: order.paypalEnvironment || "",
    paypalOrderId: order.paypalOrderId || "",
    paypalCaptureId: order.paypalCaptureId || "",
    paypalFeeMinor: Number(order.paypalFeeMinor || 0),
    paypalRefundMinor: Number(order.paypalRefundMinor || 0),
    paypalDisputeStatus: order.paypalDisputeStatus || "",
    paymentReconciliationStatus: order.paymentReconciliationStatus || "",
  };
}
