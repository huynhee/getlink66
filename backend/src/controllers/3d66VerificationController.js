import { threed66VerificationService } from "../utils/3d66VerificationService.js";

export function verificationController(action) {
  return async (req, res, next) => {
    res.set("Cache-Control", "no-store, private");
    res.set("Pragma", "no-cache");
    try {
      const result = await threed66VerificationService[action](req.params.id, String(req.user._id), req.body?.token, req.body);
      res.json(result);
    } catch (error) {
      // Do not serialize Playwright failures, URLs, screenshots or browser session internals.
      if (!["THREED66_VERIFICATION_SESSION", "THREED66_REWRITTEN_FOOTPRINT_FAILED", "THREED66_CLEAN_LINK_REQUIRED"].includes(error.code)) {
        return next(Object.assign(new Error("Verification could not complete. Keep the session open and retry."), {
          status: 503, code: "THREED66_VERIFICATION_SESSION",
        }));
      }
      next(error);
    }
  };
}
