import { isMemoryDb } from "../config/memoryStore.js";
import PaypalPayment from "../models/PaypalPayment.js";
import PaypalWebhookEvent from "../models/PaypalWebhookEvent.js";
import PaypalAdjustment from "../models/PaypalAdjustment.js";
import PaymentBenefitReservation from "../models/PaymentBenefitReservation.js";

export async function ensurePaypalIndexes() {
  if (isMemoryDb()) return;
  for (const Model of [PaypalPayment, PaypalWebhookEvent, PaypalAdjustment, PaymentBenefitReservation]) {
    await Model.createIndexes();
  }
}
