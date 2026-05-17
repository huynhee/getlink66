import crypto from "node:crypto";

const PREFIX = "enc:v1:";

function encryptionSecret() {
  const secret = process.env.COOKIE_ENCRYPTION_KEY || process.env.SESSION_SECRET || "";
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("COOKIE_ENCRYPTION_KEY or SESSION_SECRET must be at least 32 characters in production.");
  }
  return secret || "dev-cookie-encryption-key";
}

function key() {
  return crypto.createHash("sha256").update(encryptionSecret()).digest();
}

function b64(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function unb64(value) {
  return Buffer.from(value, "base64url");
}

export function encryptSecret(value = "") {
  const plain = String(value || "");
  if (!plain || plain.startsWith(PREFIX)) return plain;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${b64(iv)}.${b64(tag)}.${b64(encrypted)}`;
}

export function decryptSecret(value = "") {
  const encoded = String(value || "");
  if (!encoded.startsWith(PREFIX)) return encoded;

  const [ivPart, tagPart, encryptedPart] = encoded.slice(PREFIX.length).split(".");
  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error("Encrypted secret has invalid format.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), unb64(ivPart));
  decipher.setAuthTag(unb64(tagPart));
  return Buffer.concat([decipher.update(unb64(encryptedPart)), decipher.final()]).toString("utf8");
}
