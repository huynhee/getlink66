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
});
