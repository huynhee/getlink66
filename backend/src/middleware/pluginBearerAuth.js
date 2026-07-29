import PluginDeviceSession from "../models/PluginDeviceSession.js";
import User from "../models/User.js";
import { pluginError, verifyPluginAccessToken } from "../services/pluginAuthService.js";

export async function pluginBearerAuth(req, _res, next) {
  try {
    const authorization = String(req.get("authorization") || "");
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw pluginError(401, "BEARER_TOKEN_REQUIRED", "Plugin Bearer token is required.");
    }
    const payload = verifyPluginAccessToken(match[1]);
    const session = await PluginDeviceSession.findById(payload.sid);
    const now = new Date();
    if (
      !session
      || session.revokedAt
      || String(session.userId) !== String(payload.sub)
      || new Date(session.absoluteExpiresAt) <= now
    ) {
      throw pluginError(401, "SESSION_REVOKED", "Plugin session expired or was revoked.");
    }
    const user = await User.findById(payload.sub);
    if (!user) {
      throw pluginError(401, "USER_NOT_FOUND", "Plugin account no longer exists.");
    }
    if (user.isBanned) {
      throw pluginError(403, "ACCOUNT_BANNED", "This account is not allowed to download.");
    }

    req.user = user;
    req.pluginSession = session;
    req.pluginJwtPayload = payload;
    req.isAuthenticated = () => true;
    await PluginDeviceSession.findByIdAndUpdate(session._id, {
      $set: { lastUsedAt: now },
    });
    return next();
  } catch (error) {
    return next(error);
  }
}
