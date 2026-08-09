import test from "node:test";
import assert from "node:assert/strict";
import { serializeAdminUser } from "../src/controllers/adminController.js";

test("admin user serialization never includes the TOTP secret", () => {
  const serialized = serializeAdminUser({
    _id: "user-1",
    email: "admin@example.test",
    name: "Admin",
    role: "admin",
    credit: 10,
    twoFactorSecret: "must-not-leak",
    isTwoFactorEnabled: true,
  });

  assert.equal(Object.hasOwn(serialized, "twoFactorSecret"), false);
  assert.equal(serialized.isTwoFactorEnabled, true);
  assert.equal(serialized.isPro, false);
});

test("admin user serialization exposes the active Pro state", () => {
  const serialized = serializeAdminUser({
    _id: "user-pro",
    email: "pro@example.test",
    name: "Pro User",
    proUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  assert.equal(serialized.isPro, true);
});
