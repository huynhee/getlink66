const subscribersByUser = new Map();
const MAX_SUBSCRIBERS_PER_USER = 8;

function normalizedUserId(userId) {
  return String(userId?._id || userId || "").trim();
}

export function subscribeAccountEvents(userId, listener) {
  const key = normalizedUserId(userId);
  if (!key || typeof listener !== "function") return null;

  const subscribers = subscribersByUser.get(key) || new Set();
  if (subscribers.size >= MAX_SUBSCRIBERS_PER_USER) return null;
  subscribers.add(listener);
  subscribersByUser.set(key, subscribers);

  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) subscribersByUser.delete(key);
  };
}

export function publishAccountEvent(userId, event) {
  const key = normalizedUserId(userId);
  const subscribers = subscribersByUser.get(key);
  if (!subscribers?.size) return 0;

  let delivered = 0;
  for (const listener of [...subscribers]) {
    try {
      listener(event);
      delivered += 1;
    } catch {
      subscribers.delete(listener);
    }
  }
  if (!subscribers.size) subscribersByUser.delete(key);
  return delivered;
}

