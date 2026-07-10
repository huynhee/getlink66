import test from "node:test";
import assert from "node:assert/strict";
import * as OTPAuth from "otpauth";
import { encryptSecret } from "../src/utils/secretBox.js";
import { verify2FALogin } from "../src/controllers/authController.js";

test("2FA login verifies an encrypted TOTP secret", async () => {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: "3DiPL",
    label: "admin@example.test",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  const token = totp.generate();
  const cookies = [];
  let payload;

  await verify2FALogin(
    {
      body: { token },
      user: {
        _id: "admin-user-1",
        email: "admin@example.test",
        isTwoFactorEnabled: true,
        twoFactorSecret: encryptSecret(secret.base32),
      },
      ip: "127.0.0.1",
      get(name) {
        return String(name).toLowerCase() === "user-agent" ? "node-test" : "";
      },
    },
    {
      cookie(name, value, options) {
        cookies.push({ name, value, options });
      },
      status() {
        return this;
      },
      json(value) {
        payload = value;
        return value;
      },
    },
    (error) => {
      throw error;
    },
  );

  assert.equal(payload.ok, true);
  assert.deepEqual(
    cookies.map((item) => item.name),
    ["accessToken", "refreshToken"],
  );
});
