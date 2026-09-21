import PluginDeviceSession from "../models/PluginDeviceSession.js";
import User from "../models/User.js";
import { accountEvents } from "./accountEventController.js";

export function pluginAccountEvents(req, res) {
  const userId = String(req.user._id);
  const sessionId = req.pluginSession._id;
  const expiresAt = Math.min(
    Number(req.pluginJwtPayload.exp) * 1000,
    new Date(req.pluginSession.absoluteExpiresAt).getTime(),
  );
  return accountEvents(req, res, {
    expiresAt,
    authorize: async () => {
      if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return false;
      const [session, user] = await Promise.all([
        PluginDeviceSession.findById(sessionId).lean(),
        User.findById(userId).select("isBanned").lean(),
      ]);
      return Boolean(user && !user.isBanned && session && !session.revokedAt
        && String(session.userId) === userId
        && new Date(session.absoluteExpiresAt).getTime() > Date.now());
    },
  });
}
