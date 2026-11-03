import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { encryptSecret, decryptSecret } from "./secretBox.js";
import logger from "./logger.js";

const maxBytes = 1024 * 1024;
const sourceDomain = value => /(^|\.)3d66\.com$/i.test(String(value).replace(/^\./, ""));

function profileError(code) {
  return Object.assign(new Error("The saved browser authentication profile is unavailable. Its files have not been cleared."), { code, status: 503 });
}

function validateState(state) {
  if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins)
    || state.cookies.length > 1000 || state.origins.length > 100) throw profileError("THREED66_PROFILE_INVALID");
  for (const cookie of state.cookies) {
    if (!sourceDomain(cookie.domain) || typeof cookie.name !== "string" || typeof cookie.value !== "string") {
      throw profileError("THREED66_PROFILE_INVALID");
    }
  }
  for (const origin of state.origins) {
    const url = new URL(origin.origin);
    if (url.protocol !== "https:" || url.origin !== origin.origin || !sourceDomain(url.hostname)
      || !Array.isArray(origin.localStorage) || origin.localStorage.some(item => typeof item.name !== "string" || typeof item.value !== "string")) {
      throw profileError("THREED66_PROFILE_INVALID");
    }
  }
  return state;
}

export function create3D66BrowserProfileStore({ directory = () => process.env.THREED66_BROWSER_PROFILE_DIR || "",
  encrypt = encryptSecret, decrypt = decryptSecret,
  report = code => logger.warn({ event: code }, "Getlink browser authentication profile operation failed") } = {}) {
  const writes = new Map();
  const configured = () => String(typeof directory === "function" ? directory() : directory).trim();

  async function location(key) {
    const root = configured();
    if (!root) return null;
    if (!/^[a-f0-9]{64}$/.test(key) || !path.isAbsolute(root) || path.resolve(root) === path.parse(path.resolve(root)).root) {
      throw profileError("THREED66_PROFILE_CONFIG_INVALID");
    }
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) {
      throw profileError("THREED66_PROFILE_DIRECTORY_UNSAFE");
    }
    await fs.chmod(root, 0o700);
    return path.join(root, `${key}.enc`);
  }

  function failure(code) {
    try { report(code); } catch { /* A logger failure must not expose the underlying error. */ }
    return profileError(code);
  }

  async function write(key, state) {
    let temporary;
    try {
      const file = await location(key);
      if (!file) return;
      validateState(state);
      const plain = JSON.stringify({ version: 1, key, state });
      if (Buffer.byteLength(plain) > maxBytes) throw profileError("THREED66_PROFILE_INVALID");
      const existing = await fs.lstat(file).catch(error => { if (error.code !== "ENOENT") throw error; });
      if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)) throw profileError("THREED66_PROFILE_FILE_UNSAFE");
      temporary = `${file}.${crypto.randomBytes(12).toString("hex")}.tmp`;
      const handle = await fs.open(temporary, "wx", 0o600);
      try { await handle.writeFile(encrypt(plain), "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temporary, file);
      temporary = null;
    } catch { throw failure("THREED66_PROFILE_SAVE_FAILED"); }
    finally { if (temporary) await fs.unlink(temporary).catch(() => {}); }
  }

  return {
    enabled: () => Boolean(configured()),
    async load(key) {
      let handle;
      try {
        const file = await location(key);
        if (!file) return null;
        const link = await fs.lstat(file);
        if (!link.isFile() || link.isSymbolicLink() || link.nlink !== 1) throw profileError("THREED66_PROFILE_FILE_UNSAFE");
        handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes * 2) throw profileError("THREED66_PROFILE_INVALID");
        if (process.platform !== "win32" && (stat.mode & 0o077)) throw profileError("THREED66_PROFILE_FILE_UNSAFE");
        const encoded = await handle.readFile("utf8");
        if (!encoded.startsWith("enc:v1:")) throw profileError("THREED66_PROFILE_INVALID");
        const plain = decrypt(encoded);
        if (Buffer.byteLength(plain) > maxBytes) throw profileError("THREED66_PROFILE_INVALID");
        const envelope = JSON.parse(plain);
        if (envelope.version !== 1 || envelope.key !== key) throw profileError("THREED66_PROFILE_INVALID");
        return validateState(envelope.state);
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw failure("THREED66_PROFILE_LOAD_FAILED");
      } finally { await handle?.close().catch(() => {}); }
    },
    async save(key, state) {
      if (!configured()) return;
      const previous = writes.get(key) || Promise.resolve();
      const pending = previous.catch(() => {}).then(() => write(key, state));
      writes.set(key, pending);
      try { await pending; }
      finally { if (writes.get(key) === pending) writes.delete(key); }
    },
  };
}
