import Cookie from "../models/Cookie.js";
import { decryptSecret, encryptSecret } from "./secretBox.js";
import { accountMarkerFromUserId } from "./parse3d66.js";
import { required3D66AccountMarker } from "./3d66CleanLink.js";
import { inspect3D66CookieHeader } from "./3d66CookieHeader.js";
import { assert3D66RewrittenFootprintLink } from "./3d66RewrittenFootprintResolver.js";
import { threed66VerificationStore, verificationCookieHash } from "./3d66VerificationStore.js";
import { get3D66VerificationConfigurationKey, resume3D66Verification, serializeCookies } from "./3d66BrowserService.js";
import { cacheVerified3D66Footprint } from "./3d66Service.js";

function failure(message, status = 409) {
  return Object.assign(new Error(message), { status, code: "THREED66_VERIFICATION_SESSION" });
}

export async function verify3D66ContextAccount(entry, cookieValue) {
  let response;
  try {
    response = await entry.context.request.get("https://user.3d66.com/new-user-api/api/v1/user/info", {
      timeout: 10000, maxRedirects: 0, headers: { accept: "application/json", ...(cookieValue ? { cookie: cookieValue } : {}) },
    });
    const payload = await response.json();
    const userId = String(payload?.data?.basic?.user_id ?? "");
    if (!response.ok() || Number(payload?.code) !== 200 || !/^[1-9]\d{5,19}$/.test(userId)) {
      throw failure("Cannot verify the signed-in 3D66 account. Keep this session open and retry.", 422);
    }
    if (accountMarkerFromUserId(userId) !== required3D66AccountMarker()) {
      throw failure("The signed-in account does not match the configured 3D66 account ID.", 422);
    }
  } catch (error) {
    if (error.code === "THREED66_VERIFICATION_SESSION") throw error;
    throw failure("Cannot verify the 3D66 account right now. Keep this session open and retry.", 503);
  } finally { await response?.dispose().catch(() => {}); }
}

export function create3D66VerificationService({ store = threed66VerificationStore, cookieModel = Cookie,
  configurationKey = get3D66VerificationConfigurationKey, resume = resume3D66Verification,
  verifyAccount = verify3D66ContextAccount, decrypt = decryptSecret, encrypt = encryptSecret,
  prime = cacheVerified3D66Footprint } = {}) {
  async function checkConfiguration(entry) {
    if (configurationKey() !== entry.configurationKey) {
      await store.discard(entry.id);
      throw failure("3D66 configuration changed. Retry the original request to create a new verification session.");
    }
  }

  async function sourceCookie(entry) {
    const cookies = await cookieModel.find({ isActive: { $ne: false }, status: { $ne: "disabled" } })
      .select("value isActive status").limit(50).lean();
    const source = cookies.find(cookie => {
      try { return verificationCookieHash(decrypt(cookie.value)) === entry.cookieHash; }
      catch { return false; }
    });
    if (!source) {
      await store.discard(entry.id);
      throw failure("The source cookie was changed or disabled. Retry the original request.");
    }
    return source;
  }

  return {
    async list() { return { sessions: await store.list() }; },
    async claim(id, owner) {
      const entry = store.get(id);
      await checkConfiguration(entry);
      await sourceCookie(entry);
      return store.claim(id, owner);
    },
    async frame(id, owner, token) {
      await checkConfiguration(store.get(id));
      return store.frame(id, owner, token);
    },
    async input(id, owner, token, input) {
      await checkConfiguration(store.get(id));
      await store.input(id, owner, token, input);
      return { ok: true };
    },
    async reload(id, owner, token) {
      return store.operate(id, owner, token, async entry => {
        await checkConfiguration(entry);
        await sourceCookie(entry);
        if (entry.pointerDown) { await entry.page.mouse.up(); entry.pointerDown = false; }
        await entry.page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
        return { ok: true };
      });
    },
    async complete(id, owner, token) {
      return store.operate(id, owner, token, async entry => {
        await checkConfiguration(entry);
        const source = await sourceCookie(entry);
        const result = await resume(entry);
        assert3D66RewrittenFootprintLink(result.url, { ...entry.seed,
          modelPage: result.canonicalModelPage || entry.seed.modelPage });
        const cookieValue = serializeCookies(await entry.context.cookies());
        if (!inspect3D66CookieHeader(cookieValue).hasRequiredKeys) throw failure("The verified browser has no complete source session cookie.", 422);
        await verifyAccount(entry, cookieValue);
        if (serializeCookies(await entry.context.cookies()) !== cookieValue) {
          throw failure("The source session was refreshed. Verify and save it again.");
        }
        await checkConfiguration(entry);
        // Never overwrite a cookie edited by another admin while verification was in progress.
        const saved = await cookieModel.findOneAndUpdate({ _id: source._id, value: source.value,
          isActive: { $ne: false }, status: { $ne: "disabled" } }, { $set: {
          value: encrypt(cookieValue), status: "active", failureCount: 0, cooldownUntil: null,
          lastErrorMessage: "", lastTestOk: true, lastTestAt: new Date(), lastTestMessage: "Verified in retained Getlink browser",
        } }, { new: true });
        if (!saved) throw failure("The source cookie changed. Nothing was overwritten.");
        entry.cookieHash = verificationCookieHash(cookieValue);
        prime(entry.seed, result, cookieValue);
        await store.verified(entry, cookieValue);
        return { ok: true };
      });
    },
    async release(id, owner, token) { await store.release(id, owner, token); return { ok: true }; },
    async cancel(id, owner, token) { await store.cancel(id, owner, token); return { ok: true }; },
  };
}

export const threed66VerificationService = create3D66VerificationService();
