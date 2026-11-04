import { getlinkErrorLanguage, publicGetlinkError } from "../utils/getlinkPublicError.js";

export function getlinkPublicErrors(req, res, next) {
  const path = String(req.originalUrl || req.url || "").split("?", 1)[0];
  if (!/^\/api\/(?:plugin\/)?getlink(?:\/|$)/i.test(path)) return next();
  const json = res.json;
  res.json = function (payload) {
    if (this.statusCode >= 400 && !this.locals?.getlinkDiagnostics && payload && typeof payload === "object") {
      const safe = publicGetlinkError({ ...payload, status: this.statusCode }, getlinkErrorLanguage(req));
      if (safe) {
        return json.call(this, {
          ...safe,
          ...(typeof payload.correlationId === "string" ? { correlationId: payload.correlationId } : {}),
          ...(typeof payload.retryable === "boolean" ? { retryable: payload.retryable } : {}),
        });
      }
    }
    return json.call(this, payload);
  };
  next();
}
