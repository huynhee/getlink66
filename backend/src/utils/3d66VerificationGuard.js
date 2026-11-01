const VENDOR_DOMAINS = ["alicdn.com", "aliyuncs.com", "aliyun.com"];
const FOOTPRINT = "https://user.3d66.com/newUser/index/index/footprint";

export function manual3D66RequestAllowed(request, { productId, initialUrl }) {
  let url;
  try { url = new URL(request.url()); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const source = url.hostname === "3d66.com" || url.hostname.endsWith(".3d66.com");
  const vendor = VENDOR_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith("." + domain));
  if (!source && !vendor) return false;
  if (/\/(?:download|pay|payment|purchase|order)(?:s)?(?:[/.]|$)/i.test(url.pathname)) return false;
  // Source-site mutations stay disabled; the vendor widget handles manual verification.
  if (source && !["GET", "HEAD", "OPTIONS"].includes(request.method())) return false;
  if (request.isNavigationRequest()) {
    const targetModel = url.origin === "https://3d.3d66.com" && /^\/reshtmla\/model\/items\/[^/]+\/[^/]+\.html$/.test(url.pathname)
      && url.searchParams.getAll("sof").length === 1 && url.searchParams.get("sof") === productId
      && url.searchParams.getAll("id").every(id => id === productId);
    if (url.pathname.includes("/model/items/") && !targetModel) return false;
    let mainFrame;
    try { const frame = request.frame(); mainFrame = frame === frame.page().mainFrame(); } catch { return false; }
    if (mainFrame && !(url.href === initialUrl || url.origin + url.pathname === FOOTPRINT
      || targetModel)) return false;
  }
  return true;
}

export async function install3D66VerificationGuard(entry) {
  const guard = route => manual3D66RequestAllowed(route.request(), {
    productId: entry.seed.productId, initialUrl: entry.initialUrl,
  }) ? route.continue() : route.abort("blockedbyclient");
  await entry.context.route("**/*", guard);
  return () => entry.context.unroute("**/*", guard);
}
