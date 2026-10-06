import Session from "../../../models/Session.js";
import { apiRoute } from "../../../lib/api.js";
import { revokeSessions } from "../../../lib/auth.js";

// GET    /api/auth/sessions — list this account's active devices
// DELETE /api/auth/sessions — log out every OTHER device
export default apiRoute(
  {
    GET: async (req, res) => {
      const sessions = await Session.find({ userId: req.user.id, revokedAt: null, expiresAt: { $gt: new Date() } })
        .select("userAgent ip createdAt lastUsedAt")
        .sort({ lastUsedAt: -1 })
        .lean();
      return res.status(200).json(
        sessions.map((s) => ({
          id: String(s._id),
          current: String(s._id) === req.user.sid,
          userAgent: s.userAgent,
          ip: s.ip,
          createdAt: s.createdAt,
          lastUsedAt: s.lastUsedAt,
        }))
      );
    },
    DELETE: async (req, res) => {
      const revoked = await revokeSessions({ userId: req.user.id, _id: { $ne: req.user.sid } }, "logout-others");
      return res.status(200).json({ revoked });
    },
  },
  { rateLimit: { name: "auth-sessions", limit: 30, windowMs: 60 * 1000 } }
);
