import MembershipPlan from "../models/MembershipPlan.js";
import { activateSubscriptionCatalog, prepareSubscriptionCatalog, setSubscriptionCheckoutEnabled } from "../utils/subscriptionCatalogService.js";
import { rejectUnknownKeys } from "../utils/validators.js";

async function respondCatalog(res, catalog) {
  const plans = await MembershipPlan.find().sort({ sortOrder: 1, price: 1, _id: 1 }).lean();
  res.json({ plans, catalog });
}

export async function adminPrepareSubscriptionCatalog(req, res, next) {
  try {
    if (rejectUnknownKeys(req.body || {}, [])) return res.status(400).json({ message: "Invalid catalog request" });
    await respondCatalog(res, await prepareSubscriptionCatalog());
  } catch (error) { next(error); }
}

export async function adminActivateSubscriptionCatalog(req, res, next) {
  try {
    if (rejectUnknownKeys(req.body || {}, [])) return res.status(400).json({ message: "Invalid catalog request" });
    await respondCatalog(res, await activateSubscriptionCatalog());
  } catch (error) { next(error); }
}

export async function adminSetSubscriptionCheckout(req, res, next) {
  try {
    if (rejectUnknownKeys(req.body || {}, ["enabled"])) return res.status(400).json({ message: "Invalid catalog request" });
    await respondCatalog(res, await setSubscriptionCheckoutEnabled(req.body?.enabled));
  } catch (error) { next(error); }
}
