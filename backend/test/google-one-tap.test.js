import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";
import { verifyGoogleOneTapCredential } from "../src/utils/googleOneTap.js";

useMemoryDb();

const { upsertGoogleAccount } = await import("../src/utils/googleAccountService.js");
const { googleOneTapConfig, googleOneTapLogin } = await import("../src/controllers/authController.js");
const { default: User } = await import("../src/models/User.js");
const credential = "x".repeat(150);

function verifier(payload) {
  return async ({ idToken, audience }) => {
    assert.equal(idToken, credential);
    assert.equal(audience, "test-client.apps.googleusercontent.com");
    return { getPayload: () => payload };
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    status(value) { this.statusCode = value; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(value) { this.payload = value; return this; },
  };
}

test("One Tap validates audience and a verified email before accepting identity", async () => {
  const identity = await verifyGoogleOneTapCredential(credential, {
    clientId: "test-client.apps.googleusercontent.com",
    verifyIdToken: verifier({
      sub: "google-user-1",
      email: "USER@gmail.com",
      email_verified: true,
      name: "Google User",
    }),
  });
  assert.equal(identity.subject, "google-user-1");
  assert.equal(identity.email, "USER@gmail.com");

  await assert.rejects(
    verifyGoogleOneTapCredential(credential, {
      clientId: "test-client.apps.googleusercontent.com",
      verifyIdToken: verifier({ sub: "google-user-1", email: "user@gmail.com", email_verified: false }),
    }),
    /not verified/,
  );
  await assert.rejects(verifyGoogleOneTapCredential("forged", {
    clientId: "test-client.apps.googleusercontent.com",
    verifyIdToken: () => assert.fail("Short credentials must be rejected before verification"),
  }), /Invalid Google credential/);
});

test("One Tap reuses the Google subject without resetting credit or roles", async () => {
  const previousAdmins = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "one-tap-admin@gmail.com";
  try {
    const first = await upsertGoogleAccount({
      subject: "google-admin-1",
      email: "one-tap-admin@gmail.com",
      name: "Admin",
    });
    assert.equal(first.role, "admin");
    await User.findByIdAndUpdate(first._id, { $set: { credit: 17 } });
    const again = await upsertGoogleAccount({
      subject: "google-admin-1",
      email: "one-tap-admin@gmail.com",
      name: "Updated name",
    });
    assert.equal(String(again._id), String(first._id));
    assert.equal(again.credit, 17);
    assert.equal(again.name, "Updated name");
    await assert.rejects(
      upsertGoogleAccount({ subject: "different-google-account", email: "one-tap-admin@gmail.com" }),
      (error) => error.code === "GOOGLE_ACCOUNT_CONFLICT",
    );
  } finally {
    if (previousAdmins === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previousAdmins;
  }
});

test("One Tap does not silently link an unhosted third-party email", async () => {
  await User.create({ email: "external@example.test", name: "Existing User", credit: 12 });
  await assert.rejects(
    upsertGoogleAccount({ subject: "external-google-id", email: "external@example.test" }),
    (error) => error.code === "GOOGLE_ACCOUNT_CONFLICT",
  );
  const linked = await upsertGoogleAccount({
    subject: "external-google-id",
    email: "external@example.test",
    allowUnhostedEmailLink: true,
  });
  assert.equal(linked.credit, 12);
  assert.equal(linked.googleSubject, "external-google-id");
});

test("One Tap config disables the prompt without a Google client ID", () => {
  const previous = process.env.GOOGLE_CLIENT_ID;
  try {
    delete process.env.GOOGLE_CLIENT_ID;
    const response = responseRecorder();
    googleOneTapConfig({}, response);
    assert.deepEqual(response.payload, { enabled: false, clientId: "" });
    assert.equal(response.headers["Cache-Control"], "no-store");
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previous;
  }
});

test("One Tap rejects malformed credentials without creating a login session", async () => {
  const previous = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  try {
    const response = responseRecorder();
    await googleOneTapLogin(
      { body: { credential: "forged" }, ip: "127.0.0.1", path: "/google/one-tap" },
      response,
      (error) => assert.fail(error?.message || "Unexpected next call"),
    );
    assert.equal(response.statusCode, 401);
    assert.match(response.payload.message, /could not be verified/);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previous;
  }
});
