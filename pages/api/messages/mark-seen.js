import User from "../../../models/Users.js";
import { apiRoute, requireUsername, HttpError } from "../../../lib/api.js";
import { markSeen } from "../../../lib/messages.js";

// POST /api/messages/mark-seen { with } — the caller has read everything `with` sent them.
export default apiRoute(
  {
    POST: async (req, res) => {
      const partner = await User.findOne({ username: requireUsername(req.body?.with, "with") }).select("_id username").lean();
      if (!partner) throw new HttpError(404, "User not found");
      const modifiedCount = await markSeen(req.user, partner);
      return res.status(200).json({ modifiedCount });
    },
  },
  { rateLimit: { name: "messages-seen", limit: 240, windowMs: 60 * 1000 } }
);
