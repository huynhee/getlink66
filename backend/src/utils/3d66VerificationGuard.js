import { create3D66VerificationDiagnostics } from "./3d66VerificationDiagnostics.js";
import { is3D66FootprintHome, is3D66FootprintModelPage, matches3D66FootprintProduct } from "./3d66RewrittenFootprintResolver.js";
import { assert3D66AccountProductId, modelIdsShareExactAssetIdentity } from "./3d66CleanLink.js";

const VENDOR_DOMAINS = ["alicdn.com", "aliyuncs.com", "aliyun.com"];
const FOOTPRINT = "https://user.3d66.com/newUser/index/index/footprint";

export function manual3D66RequestAllowed(request, { productId, initialUrl, mode = "rewritten_footprint", modelPage,
  sourceFirst = false, sourceProductId, legacyIds, sourceUrl }) {
  let url;
  try { url = new URL(request.url()); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const source = url.hostname === "3d66.com" || url.hostname.endsWith(".3d66.com");
  const vendor = VENDOR_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith("." + domain));
  if (!source && !vendor) return false;
  if (mode === "direct" && url.origin + url.pathname === FOOTPRINT) return false;
  if (/\/(?:download|pay|payment|purchase|order)(?:s)?(?:[/.]|$)/i.test(url.pathname)) return false;
  // Source-site mutations stay disabled; the vendor widget handles manual verification.
  if (source && !["GET", "HEAD", "OPTIONS"].includes(request.method())) return false;
  let modelOrigin;
  try { modelOrigin = new URL(modelPage || initialUrl).origin; } catch { return false; }
  const candidateId = url.searchParams.get("sof");
  let ownModel = legacyIds ? matches3D66FootprintProduct(url, candidateId, { legacyIds, url: sourceUrl }) : candidateId === productId;
  if (sourceFirst && !legacyIds && !ownModel) {
    try { assert3D66AccountProductId(candidateId); ownModel = modelIdsShareExactAssetIdentity(candidateId, productId); }
    catch { /* A source account ID never authorizes a download. */ }
  }
  const initialSource = sourceFirst && url.origin + url.pathname === modelPage && candidateId === sourceProductId;
  const targetModel = is3D66FootprintModelPage(url) && url.origin === modelOrigin
    && url.searchParams.getAll("sof").length === 1 && (ownModel || initialSource)
    && url.searchParams.getAll("id").every(id => id === candidateId)
    && (mode !== "direct" || url.origin + url.pathname === modelPage);
  const modelPath = /\/items\//.test(url.pathname);
  if (mode === "direct" && modelPath && !targetModel) return false;
  if (request.isNavigationRequest()) {
    if (modelPath && !targetModel) return false;
    let mainFrame;
    try { const frame = request.frame(); mainFrame = frame === frame.page().mainFrame(); }
    catch {
      // Chromium can emit the first popup request before its Frame exists. Keep it bound to this model.
      return targetModel && request.method() === "GET";
    }
    if (mainFrame && !(url.href === initialUrl || (mode !== "direct" && (url.origin + url.pathname === FOOTPRINT
      || is3D66FootprintHome(url.href)))
      || targetModel)) return false;
  }
  return true;
}

export async function install3D66VerificationGuard(entry, diagnosticsOptions) {
  const diagnostics = create3D66VerificationDiagnostics(entry, diagnosticsOptions);
  const guard = route => {
    const request = route.request();
    if (manual3D66RequestAllowed(request, {
      productId: entry.seed.productId, initialUrl: entry.initialUrl, mode: entry.seed.mode, modelPage: entry.seed.modelPage,
      sourceFirst: entry.seed.sourceFirst, sourceProductId: entry.seed.sourceProductId,
      legacyIds: entry.seed.legacyVerifiedProductId || entry.seed.legacyCacheProbeId
        ? [entry.seed.legacyVerifiedProductId || entry.seed.legacyCacheProbeId] : entry.seed.legacyIds,
      sourceUrl: entry.seed.url,
    })) return route.continue();
    diagnostics.blocked(request);
    return route.abort("blockedbyclient");
  };
  try { await entry.context.route("**/*", guard); }
  catch (error) { diagnostics.close(); throw error; }
  return async () => {
    try { await entry.context.unroute("**/*", guard); }
    finally { diagnostics.close(); }
  };
}
