import { assert3D66AccountProductId, modelIdsShareExactAssetIdentity, required3D66AccountMarker } from "./3d66CleanLink.js";
import { is3D66CadModelUrl, seal3D66CadVerification } from "./3d66CadProof.js";
import { accountMarkerFromUserId } from "./parse3d66.js";

export function cadVerificationError(reason, status = 422) {
  return Object.assign(new Error("The CAD resource could not be verified. No purchase was attempted."), {
    status, code: "THREED66_CLEAN_LINK_REQUIRED", details: { stage: "cad-verification", reason },
  });
}

export function read3D66CadDocument() {
  let detail;
  try { detail = JSON.parse(globalThis.document.querySelector("#detail_data")?.value || "null"); }
  catch { return null; }
  const res = detail?.data?.res;
  if (!res || typeof res !== "object") return null;
  return {
    pageUrl: globalThis.location.href, code: detail.code, productId: res.ll_id, publicAssetId: res.ll_id_out,
    resourceType: res.res_type, deleted: res.is_delete, sourceAccountId: detail.data.sof_user_id,
    originUrl: res.origin_ll_url, price: res.res_price, fileFormat: res.file_format,
    formatVersion: res.cad_version || res.soft_version || "", suffix: res.res_suffix || "",
  };
}

function checkDocument(doc, expectedId) {
  const sourceUrl = doc?.originUrl == null || doc?.originUrl === "" ? doc?.pageUrl : doc.originUrl;
  if (!doc || Number(doc.code) !== 200 || Number(doc.resourceType) !== 8 || Number(doc.deleted) !== 0
    || doc.deleted == null || !is3D66CadModelUrl(doc.pageUrl) || !is3D66CadModelUrl(sourceUrl)) {
    throw cadVerificationError("invalid_cad_document");
  }
  const page = new URL(doc.pageUrl), origin = new URL(sourceUrl);
  for (const url of [page, origin]) {
    if (url.searchParams.getAll("sof").length !== 1 || url.searchParams.get("sof") !== doc.productId
      || url.searchParams.has("sign") || url.searchParams.getAll("id").length > 1
      || url.searchParams.getAll("id").some(id => id !== doc.productId)) throw cadVerificationError("ambiguous_cad_identity");
  }
  assert3D66AccountProductId(doc.productId);
  const marker = required3D66AccountMarker();
  // CAD's public ll_id_out is independent of the account-scoped SOF suffix.
  const assetId = doc.productId.slice(3 + marker.length);
  if (!/^[1-9]\d{4,19}$/.test(assetId) || !/^[1-9]\d{0,19}$/.test(String(doc.publicAssetId))
    || !modelIdsShareExactAssetIdentity(doc.productId, expectedId)
    || page.origin + page.pathname !== origin.origin + origin.pathname) throw cadVerificationError("cad_model_mismatch");
  return { marker, assetId, sourceUrl };
}

async function readResponse(request) {
  let response;
  try {
    response = await request();
    if (!response.ok() || response.status() !== 200) throw cadVerificationError("cad_source_unavailable", 503);
    const body = await response.body();
    if (body.length > 512 * 1024) throw cadVerificationError("cad_response_too_large", 503);
    const data = JSON.parse(body.toString("utf8"));
    if (Number(data?.code ?? data?.status) !== 200) throw cadVerificationError("cad_source_rejected");
    return data;
  } catch (error) {
    if (error.code === "THREED66_CLEAN_LINK_REQUIRED") throw error;
    throw cadVerificationError("cad_source_unavailable", 503);
  } finally { await response?.dispose().catch(() => {}); }
}

export async function verify3D66CadPage({ page, context, expectedId, cookieValue, configurationKey }) {
  const doc = await page.evaluate(read3D66CadDocument);
  const { marker, assetId, sourceUrl } = checkDocument(doc, expectedId);
  const account = await readResponse(() => context.request.get("https://user.3d66.com/new-user-api/api/v1/user/info", {
    timeout: 10000, maxRedirects: 0, headers: { accept: "application/json", cookie: cookieValue },
  }));
  const accountId = String(account?.data?.basic?.user_id ?? "");
  if (!/^[1-9]\d{5,19}$/.test(accountId) || accountMarkerFromUserId(accountId) !== marker
    || String(doc.sourceAccountId) !== accountId) throw cadVerificationError("cad_account_mismatch");
  const pop = await readResponse(() => context.request.post("https://user.3d66.com/api/v1/download/pop", {
    timeout: 10000, maxRedirects: 0, form: { sof: doc.productId, res_type: "8" },
    headers: { accept: "application/json", cookie: cookieValue, origin: "https://cad.3d66.com",
      referer: "https://cad.3d66.com/", "x-requested-with": "XMLHttpRequest" },
  }));
  const info = pop?.data?.resInfo;
  if (!info || info.sof !== doc.productId || Number(info.res_type) !== 8 || info.is_delete == null
    || Number(info.is_delete) !== 0 || doc.price == null || doc.price === "" || info.res_price == null || info.res_price === ""
    || !Number.isFinite(Number(doc.price)) || Number(doc.price) < 0
    || !Number.isFinite(Number(info.res_price)) || Number(info.res_price) !== Number(doc.price)) {
    throw cadVerificationError("cad_api_model_mismatch");
  }
  if (JSON.stringify(await page.evaluate(read3D66CadDocument)) !== JSON.stringify(doc)) throw cadVerificationError("cad_document_changed", 409);
  return {
    url: seal3D66CadVerification({ url: sourceUrl, accountId, assetId, marker, cookieValue, configurationKey }),
    productId: doc.productId, canonicalModelPage: new URL(sourceUrl).origin + new URL(sourceUrl).pathname,
    document: doc, popData: pop.data,
  };
}
