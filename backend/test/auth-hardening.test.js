import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { logout } = await import("../src/controllers/authController.js");
const { adminOnly, adminTwoFactorRequired } = await import("../src/middleware/adminOnly.js");
const { default: User } = await import("../src/models/User.js");

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("logout clears both auth cookies even when session revocation storage fails", async () => {
  const originalUpdate = User.findByIdAndUpdate;
  User.findByIdAndUpdate = async () => {
    throw new Error("database unavailable");
  };
  const cleared = [];
  let forwarded;
  try {
    await logout(
      { user: { _id: "logout-user" } },
      {
        clearCookie(name, options) {
          cleared.push({ name, options });
        },
        json() {
          assert.fail("logout must not report success when revocation failed");
        },
      },
      (error) => {
        forwarded = error;
      },
    );
  } finally {
    User.findByIdAndUpdate = originalUpdate;
  }

  assert.equal(forwarded?.message, "database unavailable");
  assert.deepEqual(cleared.map((entry) => entry.name), [
    "accessToken",
    "refreshToken",
  ]);
  assert.ok(cleared.every((entry) => entry.options.path === "/"));
});

test("admin 2FA is required by default in production", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousRequired = process.env.ADMIN_2FA_REQUIRED;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.ADMIN_2FA_REQUIRED;
    assert.equal(adminTwoFactorRequired(), true);

    process.env.ADMIN_2FA_REQUIRED = "false";
    assert.equal(adminTwoFactorRequired(), false);
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
    restoreEnv("ADMIN_2FA_REQUIRED", previousRequired);
  }
});

test("production admin access is blocked until 2FA enrollment", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousRequired = process.env.ADMIN_2FA_REQUIRED;
  const previousEmails = process.env.ADMIN_EMAILS;
  let status = 200;
  let payload;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.ADMIN_2FA_REQUIRED;
    process.env.ADMIN_EMAILS = "admin@example.test";
    adminOnly(
      {
        user: {
          role: "admin",
          email: "admin@example.test",
          isTwoFactorEnabled: false,
        },
        jwtPayload: {},
        path: "/dashboard",
      },
      {
        status(code) {
          status = code;
          return this;
        },
        json(value) {
          payload = value;
          return value;
        },
      },
      () => assert.fail("admin without 2FA must not pass"),
    );
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
    restoreEnv("ADMIN_2FA_REQUIRED", previousRequired);
    restoreEnv("ADMIN_EMAILS", previousEmails);
  }

  assert.equal(status, 403);
  assert.equal(payload.code, "2FA_SETUP_REQUIRED");
});
