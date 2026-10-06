import User from "../../../models/Users.js";
import { apiRoute, requireUsername, HttpError } from "../../../lib/api.js";
import { getPresence } from "../../../lib/presence.js";

// GET /api/users/:username — a peer's pinned public key + key version.
// Clients compare this against their locally pinned (TOFU) key before encrypting.
export default apiRoute(
  {
    GET: async (req, res) => {
      const username = requireUsername(req.query.username);
      const user = await User.findOne({ username }).select("username publicKey kem keyVersion keyUpdatedAt lastSeen").lean();
      if (!user) throw new HttpError(404, "User not found");
      return res.status(200).json({
        username: user.username,
        publicKey: user.publicKey,
        kem: user.kem,
        keyVersion: user.keyVersion,
        keyUpdatedAt: user.keyUpdatedAt,
        lastSeen: user.lastSeen,
        online: await getPresence().isOnline(user.username),
      });
    },
  },
  { rateLimit: { name: "users-get", limit: 240, windowMs: 60 * 1000 } }
);
