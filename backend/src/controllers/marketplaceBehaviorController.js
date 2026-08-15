import { normalizeAssetType } from "../data/marketplaceCatalogs.js";
import {
  marketplaceActorKeyFromRequest,
  recordMarketplaceBehavior,
} from "../utils/marketplaceBehaviorService.js";

export async function createMarketplaceBehavior(req, res, next) {
  try {
    const actorKey = marketplaceActorKeyFromRequest(req);
    if (!actorKey) {
      return res.status(400).json({ message: "Marketplace session is required", code: "MARKETPLACE_SESSION_REQUIRED" });
    }
    const eventType = String(req.body?.eventType || "").trim();
    if (!["impression", "click", "detail_view"].includes(eventType)) {
      return res.status(400).json({ message: "Invalid behavior event", code: "MARKETPLACE_BEHAVIOR_INVALID" });
    }
    const result = await recordMarketplaceBehavior({
      actorKey,
      userId: req.user?._id || null,
      modelId: req.body?.assetId || req.body?.modelId,
      assetType: normalizeAssetType(req.body?.assetType),
      eventType,
      queryId: req.body?.queryId,
      position: req.body?.position,
      source: req.body?.source,
      eventId: String(req.body?.eventId || "").slice(0, 120),
    });
    if (result.reason === "not_found") return res.status(404).json({ message: "Marketplace asset not found" });
    return res.status(result.duplicate ? 200 : 202).json(result);
  } catch (error) {
    return next(error);
  }
}
