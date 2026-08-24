import crypto from "node:crypto";

function providedToken(req) {
  const explicit = String(req.get("x-marketplace-upload-token") || "").trim();
  if (explicit) return explicit;
  const authorization = String(req.get("authorization") || "").trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || "").trim();
}

function equalToken(left, right) {
  const first = Buffer.from(String(left || ""), "utf8");
  const second = Buffer.from(String(right || ""), "utf8");
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

export function marketplaceUploadTokenAuth(req, res, next) {
  const supplied = providedToken(req);
  if (!supplied) return next("route");

  const expected = String(process.env.MARKETPLACE_UPLOAD_API_TOKEN || "").trim();
  if (!expected) {
    return res.status(503).json({
      message: "Marketplace upload API token is not configured",
      code: "MARKETPLACE_UPLOAD_TOKEN_NOT_CONFIGURED",
    });
  }
  if (!equalToken(supplied, expected)) {
    return res.status(401).json({
      message: "Marketplace upload API token is invalid",
      code: "MARKETPLACE_UPLOAD_TOKEN_INVALID",
    });
  }

  req.marketplaceUploadTool = true;
  req.user = { _id: "marketplace-upload-tool", email: "upload-tool@local", role: "service" };
  return next();
}
