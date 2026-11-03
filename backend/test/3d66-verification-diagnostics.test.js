import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { create3D66VerificationDiagnostics } from "../src/utils/3d66VerificationDiagnostics.js";
import { install3D66VerificationGuard } from "../src/utils/3d66VerificationGuard.js";

function request({ url = "https://captcha.aliyuncs.com/verify?token=private-token", method = "POST", type = "xhr", error = "net::ERR_FAILED" } = {}) {
  return { url: () => url, method: () => method, resourceType: () => type, failure: () => ({ errorText: error }),
    isNavigationRequest: () => false,
    headers: () => assert.fail("Do not collect headers"), postData: () => assert.fail("Do not collect bodies") };
}

function fixture(report) {
  const entry = { id: "fixture-session", status: "pending", context: new EventEmitter() };
  const events = [];
  let clock = 1000;
  const diagnostics = create3D66VerificationDiagnostics(entry, { report: report || (event => events.push(event)), now: () => clock });
  return { entry, events, diagnostics, advance: duration => { clock += duration; } };
}

test("manual network diagnostics omit full URLs, paths, query strings, bodies and credentials", () => {
  const { entry, diagnostics, events } = fixture();
  const input = request({ url: "https://private-user:private-password@captcha.aliyuncs.com/private-path?cookie=private-cookie&sign=private-sign#private-fragment" });
  diagnostics.blocked(input);
  entry.context.emit("requestfailed", input);
  entry.context.emit("response", { status: () => 403, request: () => input });
  assert.deepEqual(events.map(event => [event.kind, event.host, event.code]), [
    ["policy_blocked", "captcha.aliyuncs.com", "POLICY_BLOCKED"],
    ["request_failed", "captcha.aliyuncs.com", "net::ERR_FAILED"],
    ["http_error", "captcha.aliyuncs.com", 403],
  ]);
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), ["type", "event", "sessionId", "kind", "host", "method", "resourceType", "code"].sort());
    assert.equal(JSON.stringify(event).includes("private-"), false);
  }
  diagnostics.close();
});

test("unknown hosts and arbitrary errors are reduced to safe labels", () => {
  const { entry, events, diagnostics } = fixture();
  const input = request({ url: "https://private-host.example.test/private-path", method: "private-method", type: "private-type", error: "Failure https://example.test/?token=private-token" });
  entry.context.emit("requestfailed", input);
  assert.equal(events[0].host, "external");
  assert.equal(events[0].method, "OTHER");
  assert.equal(events[0].resourceType, "other");
  assert.equal(events[0].code, "REQUEST_FAILED");
  assert.equal(JSON.stringify(events).includes("private-"), false);
  diagnostics.close();
});

test("successful API responses are visible without logging response bodies or ordinary successful assets", () => {
  const { entry, events, diagnostics } = fixture();
  const reply = (status, input) => ({ status: () => status, request: () => input,
    body: () => assert.fail("Never collect response content") });
  entry.context.emit("response", reply(200, request({ type: "script" })));
  entry.context.emit("response", reply(200, request()));
  entry.context.emit("response", reply(429, request({ type: "script" })));
  assert.deepEqual(events.map(event => [event.kind, event.code]), [["response", 200], ["http_error", 429]]);
  diagnostics.close();
});

test("diagnostic noise is deduplicated and bounded per minute", () => {
  const { diagnostics, events, advance } = fixture();
  const input = request();
  for (let i = 0; i < 50; i++) diagnostics.blocked(input);
  assert.equal(events.length, 1);
  for (let i = 0; i < 100; i++) diagnostics.blocked(request({ url: `https://fixture${i}.aliyuncs.com/` }));
  assert.equal(events.length, 20);
  advance(60_000);
  diagnostics.blocked(input);
  assert.equal(events.length, 21);
  diagnostics.close();
});

test("verified/closed sessions stop collecting diagnostics and remove event listeners", () => {
  const { entry, events, diagnostics } = fixture();
  entry.status = "verified";
  diagnostics.blocked(request());
  assert.equal(events.length, 0);
  entry.status = "pending";
  entry.context.emit("close");
  assert.equal(entry.context.listenerCount("requestfailed"), 0);
  assert.equal(entry.context.listenerCount("response"), 0);
  assert.equal(entry.context.listenerCount("close"), 0);
  diagnostics.blocked(request());
  assert.equal(events.length, 0);
  diagnostics.close();
});

test("diagnostics never change scope policy or make routing fail when the logger fails", async () => {
  const { entry, diagnostics } = fixture();
  diagnostics.close();
  const routes = new Map();
  entry.seed = { productId: "AJI896357711234567", mode: "direct", modelPage: "https://3d.3d66.com/reshtmla/model/items/fixture/model.html" };
  entry.context.route = async (pattern, handler) => { routes.set(pattern, handler); };
  entry.context.unroute = async pattern => { routes.delete(pattern); };
  const remove = await install3D66VerificationGuard(entry, { report() { throw new Error("logger unavailable"); } });
  const actions = [];
  const invoke = input => routes.get("**/*")({ request: () => input,
    continue: () => actions.push("allowed"), abort: () => actions.push("blocked") });
  invoke(request());
  invoke(request({ url: "https://user.3d66.com/api/v1/download/handle" }));
  invoke(request({ url: "https://www.3d66.com/any-post" }));
  invoke(request({ url: "https://external.test/" }));
  assert.deepEqual(actions, ["allowed", "blocked", "blocked", "blocked"]);
  await remove();
  assert.equal(routes.size, 0);
});

test("a route installation failure does not retain diagnostic listeners", async () => {
  const entry = { id: "fixture-session", status: "pending", seed: {}, context: new EventEmitter() };
  entry.context.route = async () => { throw new Error("context closed fixture"); };
  await assert.rejects(install3D66VerificationGuard(entry), /context closed fixture/);
  assert.equal(entry.context.listenerCount("response"), 0);
  assert.equal(entry.context.listenerCount("requestfailed"), 0);
});
