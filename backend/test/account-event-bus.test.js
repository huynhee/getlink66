import test from "node:test";
import assert from "node:assert/strict";
import {
  publishAccountEvent,
  subscribeAccountEvents,
} from "../src/utils/accountEventBus.js";

test("account events are delivered only to the matching user", () => {
  const firstUserEvents = [];
  const secondUserEvents = [];
  const unsubscribeFirst = subscribeAccountEvents("user-1", (event) => {
    firstUserEvents.push(event);
  });
  const unsubscribeSecond = subscribeAccountEvents("user-2", (event) => {
    secondUserEvents.push(event);
  });

  const delivered = publishAccountEvent("user-1", {
    type: "account.updated",
    data: { user: { _id: "user-1", credit: 28 } },
  });

  unsubscribeFirst();
  unsubscribeSecond();
  assert.equal(delivered, 1);
  assert.equal(firstUserEvents.length, 1);
  assert.equal(firstUserEvents[0].data.user.credit, 28);
  assert.equal(secondUserEvents.length, 0);
});

test("unsubscribed account listeners receive no later events", () => {
  const events = [];
  const unsubscribe = subscribeAccountEvents("user-3", (event) => events.push(event));
  unsubscribe();

  assert.equal(publishAccountEvent("user-3", { type: "account.updated" }), 0);
  assert.equal(events.length, 0);
});

