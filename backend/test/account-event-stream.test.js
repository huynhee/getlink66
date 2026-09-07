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
