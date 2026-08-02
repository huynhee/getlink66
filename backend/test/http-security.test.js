import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHelmetOptions,
  TURNSTILE_ORIGIN,
  validatedJsonBodyLimit,
} from "../src/config/httpSecurity.js";

test("production CSP allows the exact Cloudflare Turnstile origin when enabled", () => {
  const options = buildHelmetOptions({
    production: true,
    turnstileEnabled: true,
  });
  const directives = options.contentSecurityPolicy.directives;

  assert.ok(directives.scriptSrc.includes(TURNSTILE_ORIGIN));
  assert.ok(directives.connectSrc.includes(TURNSTILE_ORIGIN));
  assert.ok(directives.frameSrc.includes(TURNSTILE_ORIGIN));
  assert.ok(!directives.scriptSrc.includes("*"));
  assert.deepEqual(directives.frameAncestors, ["'none'"]);
  assert.equal(options.hsts.maxAge, 31_536_000);
});

test("Turnstile origin is absent when the integration is disabled", () => {
  const directives = buildHelmetOptions({
    production: true,
    turnstileEnabled: false,
  }).contentSecurityPolicy.directives;

  assert.ok(!directives.scriptSrc.includes(TURNSTILE_ORIGIN));
  assert.ok(!directives.connectSrc.includes(TURNSTILE_ORIGIN));
  assert.ok(!directives.frameSrc.includes(TURNSTILE_ORIGIN));
});

test("development keeps CSP and HSTS disabled", () => {
  const options = buildHelmetOptions({ production: false });
  assert.equal(options.contentSecurityPolicy, false);
  assert.equal(options.hsts, false);
});

test("JSON request body limit is bounded and requires explicit units", () => {
  assert.equal(validatedJsonBodyLimit("100KB"), "100kb");
  assert.equal(validatedJsonBodyLimit("1mb"), "1mb");
  assert.throws(() => validatedJsonBodyLimit("1000000000"), /must use b, kb or mb/);
  assert.throws(() => validatedJsonBodyLimit("11mb"), /between 1kb and 10mb/);
  assert.throws(() => validatedJsonBodyLimit("512b"), /between 1kb and 10mb/);
});
