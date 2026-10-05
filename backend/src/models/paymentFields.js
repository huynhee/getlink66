export const paymentMoneyFields = {
  currency: { type: String, enum: ["VND", "USD"], default: "VND" },
  originalAmountMinor: { type: Number, min: 0 },
  discountAmountMinor: { type: Number, min: 0 },
  amountMinor: { type: Number, min: 0 },
  requestedPaymentProvider: { type: String, enum: ["sepay", "paypal"] },
  paypalEnvironment: { type: String, enum: ["sandbox", "live"] },
  paypalOrderId: String,
  paypalCaptureId: String,
  paypalFeeMinor: { type: Number, default: 0 },
  paypalRefundMinor: { type: Number, default: 0 },
  paypalDisputeStatus: String,
  paymentReconciliationStatus: String,
};
