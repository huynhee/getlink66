import test from "node:test";
import assert from "node:assert/strict";
import { classifyAuditResult, validAuditArgs } from "../../scripts/npm-audit-retry.js";

test("critical vulnerabilities never become an npm outage because of advisory text", () => {
  const stdout = JSON.stringify({
    metadata: { vulnerabilities: { critical: 1 } },
    vulnerabilities: { example: { title: "Service Unavailable 503", url: "https://example.test/503" } },
  });
  assert.equal(classifyAuditResult({ code: 1, stdout }), "failed");
  assert.equal(classifyAuditResult({ code: 0, stdout }), "failed");
  assert.equal(classifyAuditResult({ code: 1, stdout, timedOut: true }), "failed");
});

test("only structured npm service errors or timeout permit the unavailable outcome", () => {
  assert.equal(classifyAuditResult({ code: 1, stdout: '{"error":{"code":"E503"}}' }), "unavailable");
  assert.equal(classifyAuditResult({ code: 1, errorCode: "ENOTFOUND" }), "unavailable");
  assert.equal(classifyAuditResult({ code: 1, timedOut: true }), "unavailable");
  for (const stdout of ["503", "Service Unavailable", '{"error":{"code":"EAUDITNOLOCK"}}', "{}"]) {
    assert.equal(classifyAuditResult({ code: 1, stdout }), "failed");
  }
});

test("audit success requires a completed structured report and argument allowlist stays strict", () => {
  const stdout = '{"metadata":{"vulnerabilities":{"critical":0}}}';
  assert.equal(classifyAuditResult({ code: 0, stdout }), "passed");
  assert.equal(classifyAuditResult({ code: 0, stdout, timedOut: true }), "failed");
  assert.equal(classifyAuditResult({ code: 0, stdout: "" }), "failed");
  assert.equal(validAuditArgs(["--audit-level=critical", "--prefix", "backend", "--omit=dev"]), true);
  assert.equal(validAuditArgs(["--prefix", "backend & echo unsafe"]), false);
});
