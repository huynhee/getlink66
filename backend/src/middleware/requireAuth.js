import { SESSION_EXPIRED_MESSAGE } from "../utils/authMessages.js";

export function requireAuth(req, res, next) {
  if (req.isAuthenticated?.() && req.user) {
    return next();
  }

  res.status(401).json({ message: SESSION_EXPIRED_MESSAGE });
}
