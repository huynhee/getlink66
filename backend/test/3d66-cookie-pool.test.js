import assert from "node:assert/strict";
import test from "node:test";

import { isSwitchable3D66Error } from "../src/utils/3d66CookiePool.js";

test("does not degrade a 3D66 cookie for browser navigation timeouts", () => {
  assert.equal(
    isSwitchable3D66Error({
      status: 504,
      message:
        "3D66 browser navigation timed out after 1 attempts. 3D66 may be slow, blocking this server, or the cookie/session needs refresh. page.goto: Timeout 30000ms exceeded.",
    }),
    false,
  );
});

test("does not degrade a 3D66 cookie for transient connection failures", () => {
  assert.equal(
    isSwitchable3D66Error({
      status: 502,
      message: "3D66 upstream request failed: read ECONNRESET",
    }),
    false,
  );
});

test("continues switching cookies for authentication failures", () => {
  assert.equal(
    isSwitchable3D66Error({
      status: 401,
      message: "3D66 session expired",
    }),
    true,
  );
  assert.equal(
    isSwitchable3D66Error({
      status: 502,
      message: "3D66 login challenge blocked this cookie",
    }),
    true,
  );
});
