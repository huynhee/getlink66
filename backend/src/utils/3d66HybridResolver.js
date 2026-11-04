import crypto from "node:crypto";
import { assert3D66CleanModelUrl, required3D66AccountMarker } from "./3d66CleanLink.js";
import { build3D66FootprintSeed } from "./3d66RewrittenFootprintResolver.js";

function inputError(reason) {
  return Object.assign(new Error("Invalid or ambiguous 3D66 model URL."), {
    status: 400, code: "THREED66_HYBRID_INPUT_INVALID", details: { stage: "hybrid-input", reason },
  });
}

export function validate3D66HybridInput(value) {
  let url;
  try { url = new URL(value); } catch { throw inputError("invalid_url"); }
  if (url.searchParams.getAll("sof").length !== 1 || url.searchParams.getAll("sign").length > 1
    || url.searchParams.getAll("id").length > 1
    || url.searchParams.getAll("id").some(id => id !== url.searchParams.get("sof"))) {
    throw inputError("ambiguous_model_fields");
  }
  url.hash = "";
  try {
    const seed = build3D66FootprintSeed(url.href);
    const marker = required3D66AccountMarker();
    const digits = seed.sourceProductId.slice(3);
    if (digits.startsWith(marker) && digits.length - marker.length >= 5) {
      seed.productId = `A${seed.sourceProductId.slice(1)}`;
      seed.url = `${seed.modelPage}?${new URLSearchParams({ sof: seed.productId, st: "2" })}`;
    }
    return { ...seed, inputUrl: url.href };
  }
  catch (error) {
    if (error.code === "THREED66_CLEAN_LINK_REQUIRED") throw error;
    throw inputError(error.details?.reason || "invalid_model_identity");
  }
}

// Metadata is never a download authorization. Only remember() admits signed account links.
export function create3D66HybridResolver({ readMetadata, openModel, configurationKey = () => "",
  now = Date.now, linkTtlMs = 120_000, metadataTtlMs = 30_000, maxEntries = 200 } = {}) {
  const links = new Map();
  const metadata = new Map();
  const metadataPending = new Map();
  const pending = new Map();
  const configurationChanged = () => Object.assign(new Error("Getlink configuration changed. Retry the preview."), {
    status: 409, code: "THREED66_HYBRID_CONFIGURATION_CHANGED", details: { stage: "hybrid-preview", reason: "configuration_changed" },
  });

  function key(seed, cookie) {
    return crypto.createHash("sha256").update(JSON.stringify([
      seed.modelPage, seed.productId, cookie, required3D66AccountMarker(), configurationKey(),
    ])).digest("hex");
  }

  function cached(map, id, ttl) {
    const entry = map.get(id);
    if (!entry || now() - entry.at >= ttl || now() < entry.at) { map.delete(id); return null; }
    return entry.value;
  }

  function put(map, id, value) {
    map.delete(id);
    map.set(id, { at: now(), value });
    while (map.size > maxEntries) map.delete(map.keys().next().value);
  }

  function validateResult(seed, result) {
    const productId = assert3D66CleanModelUrl(result?.url, { expectedProductId: seed.sourceProductId });
    const parsed = new URL(result.url);
    if (parsed.origin !== "https://3d.3d66.com"
      || !/^\/reshtmla\/model\/items\/[^/]+\/[^/]+\.html$/.test(parsed.pathname)
      || productId.slice(1).toUpperCase() !== seed.productId.slice(1).toUpperCase()) {
      throw inputError("resolved_model_mismatch");
    }
    return { ...result, productId, canonicalModelPage: parsed.origin + parsed.pathname };
  }

  function remember(value, result, cookie) {
    const seed = validate3D66HybridInput(value);
    const valid = validateResult(seed, result);
    put(links, key(seed, cookie), valid);
    return valid;
  }

  async function read(value, cookie) {
    const seed = validate3D66HybridInput(value);
    const id = key(seed, cookie);
    const previous = cached(metadata, id, metadataTtlMs);
    if (metadata.has(id)) return previous;
    if (metadataPending.has(id)) return metadataPending.get(id);
    const task = (async () => {
      const result = await readMetadata(seed.inputUrl, cookie);
      if (key(seed, cookie) !== id) throw configurationChanged();
      put(metadata, id, result);
      return result;
    })();
    metadataPending.set(id, task);
    try { return await task; }
    finally { if (metadataPending.get(id) === task) metadataPending.delete(id); }
  }

  async function ensure(value, cookie, includeFormatOptions) {
    const seed = validate3D66HybridInput(value);
    const id = key(seed, cookie);
    if (pending.has(id)) await pending.get(id);
    const previous = cached(links, id, linkTtlMs);
    if (previous && (!includeFormatOptions || previous.inspection?.formatsChecked)) return validateResult(seed, previous);
    if (pending.has(id)) return ensure(value, cookie, includeFormatOptions);
    const task = (async () => {
      let candidate = previous;
      if (!candidate) {
        try { candidate = validateResult(seed, { url: seed.inputUrl, route: "signed_input" }); }
        catch { /* A foreign or unsigned input is read-only until rewritten by the source. */ }
      }
      if (candidate && !includeFormatOptions) return remember(value, candidate, cookie);
      const early = await read(value, cookie);
      if (!candidate && early?.verifiedModelUrl) {
        try { candidate = validateResult(seed, { url: early.verifiedModelUrl, route: "api_link" }); }
        catch { /* An API-supplied candidate still needs the exact account/model gate. */ }
      }
      if (candidate && !includeFormatOptions) {
        if (key(seed, cookie) !== id) throw configurationChanged();
        return remember(value, candidate, cookie);
      }
      // API selectors are usable only with a separately verified URL, never with a foreign source URL.
      if (candidate && early?.formatOptionsSource === "api" && early.formatOptionsComplete === true) {
        if (key(seed, cookie) !== id) throw configurationChanged();
        return remember(value, { ...candidate, inspection: { metadata: early, formatsChecked: true } }, cookie);
      }
      const result = await openModel(seed.inputUrl, cookie, { resolvedLink: candidate, includeFormatOptions });
      if (key(seed, cookie) !== id) throw configurationChanged();
      return remember(value, result, cookie);
    })();
    pending.set(id, task);
    try { return await task; }
    finally { if (pending.get(id) === task) pending.delete(id); }
  }

  return { read, remember,
    resolve: (value, cookie) => ensure(value, cookie, false),
    prepare: (value, cookie) => ensure(value, cookie, true),
    clear() { links.clear(); metadata.clear(); },
  };
}
