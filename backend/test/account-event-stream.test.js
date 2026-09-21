import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { accountEvents } from "../src/controllers/accountEventController.js";
import { publishAccountInvalidation } from "../src/utils/accountEventBus.js";

function response() {
  const res = new EventEmitter();
  res.chunks = [];
  res.status = () => res;
  res.set = () => res;
  res.write = (chunk) => { res.chunks.push(chunk); return true; };
  res.destroy = () => { res.destroyed = true; res.emit("close"); };
  res.end = () => { res.writableEnded = true; res.emit("close"); };
  return res;
}

test("plugin invalidation arriving during authorization is not lost", async () => {
  const res = response();
  let release;
  let checks = 0;
  accountEvents({ user: { _id: "busy-stream" } }, res, {
    authorize: async () => {
      if (++checks === 1) await new Promise((resolve) => { release = resolve; });
      return true;
    },
  });
  try {
    publishAccountInvalidation("busy-stream", "first");
    publishAccountInvalidation("busy-stream", "second");
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(checks, 2);
    assert.equal(res.chunks.filter((chunk) => chunk.includes("event: account.updated")).length, 2);
  } finally { res.end(); }
});

test("plugin stream closes when access expires", async () => {
  const res = response();
  accountEvents({ user: { _id: "expiring-stream" } }, res, {
    authorize: async () => true,
    expiresAt: Date.now() - 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(res.writableEnded, true);
  assert.equal(publishAccountInvalidation("expiring-stream", "later"), 0);
});

test("plugin stream stops on revocation before emitting account data", async () => {
  const req = { user: { _id: "revoked-stream" } };
  const res = response();
  accountEvents(req, res, { authorize: async () => false });
  publishAccountInvalidation("revoked-stream", "topup_approved");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(res.writableEnded, true);
  assert.doesNotMatch(res.chunks.join(""), /event: account.updated/);
  assert.equal(publishAccountInvalidation("revoked-stream", "again"), 0);
});

test("plugin stream emits invalidation only while authorization is valid", async () => {
  const res = response();
  accountEvents({ user: { _id: "authorized-stream" } }, res, { authorize: async () => true });
  try {
    publishAccountInvalidation("authorized-stream", "secret-reason");
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(res.chunks.join(""), /event: account.updated/);
    assert.doesNotMatch(res.chunks.join(""), /secret-reason/);
  } finally { res.end(); }
});

test("account stream lives until the response closes, not until the incoming request finishes", () => {
  const req = new EventEmitter();
  req.user = { _id: "stream-user" };
  const res = response();
  accountEvents(req, res);
  try {
    req.emit("close");
    assert.equal(publishAccountInvalidation("stream-user", "topup_approved"), 1);
    assert.match(res.chunks.join(""), /event: account.updated/);
    res.end();
    assert.equal(publishAccountInvalidation("stream-user", "topup_approved"), 0);
  } finally { res.end(); }
});

test("slow event consumers are disconnected without retaining an unbounded output buffer", () => {
  const req = new EventEmitter();
  req.user = { _id: "slow-stream" };
  const res = response();
  accountEvents(req, res);
  try {
    res.write = () => false;
    publishAccountInvalidation("slow-stream", "getlink_charged");
    assert.equal(res.destroyed, true);
    assert.equal(publishAccountInvalidation("slow-stream", "getlink_charged"), 0);
  } finally { res.end(); }
});
