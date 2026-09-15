import assert from "node:assert/strict";
import test from "node:test";

import {
  isAccountScoped3D66Miss,
  isSwitchable3D66Error,
  shouldDegrade3D66Cookie,
} from "../src/utils/3d66CookiePool.js";

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

test("switches accounts without degrading a cookie when its footprint misses the model", () => {
  const error = {
    status: 502,
    code: "THREED66_FOOTPRINT_MODEL_NOT_FOUND",
    message: "Không tìm thấy đúng model vừa mở trong lịch sử truy cập 3D66.",
    details: { stage: "footprint-history" },
  };

  assert.equal(isAccountScoped3D66Miss(error), true);
  assert.equal(isSwitchable3D66Error(error), true);
  assert.equal(shouldDegrade3D66Cookie(error), false);
});

test("still degrades cookies for authentication failures", () => {
  assert.equal(
    shouldDegrade3D66Cookie({ status: 401, message: "3D66 session expired" }),
    true,
  );
});
