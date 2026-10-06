import User from "../models/User.js";
import logger from "./logger.js";
import { refreshSubscriptionUser } from "./subscriptionScheduleService.js";

let timer = null;
let running = null;

export async function transitionDueSubscriptions({ at = new Date(), limit = 100 } = {}) {
  const users = await User.find({ subscriptionManaged: true, subscriptionNextTransitionAt: { $ne: null, $lte: at } })
    .sort({ subscriptionNextTransitionAt: 1 }).limit(limit);
  const errors = [];
  for (const user of users) {
    try { await refreshSubscriptionUser(user, { at }); }
    catch (error) { errors.push({ userId: String(user._id), message: error.message }); }
  }
  return { inspected: users.length, errors };
}

function run() {
  if (running) return running;
  running = transitionDueSubscriptions().then((result) => {
    if (result.errors.length) logger.error(result, "Subscription transitions failed; account requests will retry");
  }).catch((error) => logger.error({ err: error }, "Subscription schedule worker failed"))
    .finally(() => { running = null; });
  return running;
}

export function startSubscriptionScheduleJob() {
  if (timer || process.env.SUBSCRIPTION_SCHEDULE_JOB_ENABLED === "false") return;
  run();
  timer = setInterval(run, 30000);
  timer.unref?.();
}

export async function stopSubscriptionScheduleJob() {
  if (timer) clearInterval(timer);
  timer = null;
  await running;
}
