import User from "../../../models/Users.js";
import { apiRoute, escapeRegex } from "../../../lib/api.js";
import { getPresence } from "../../../lib/presence.js";

// GET /api/users?q=<search> — directory search (authenticated).
// The query is regex-escaped (no ReDoS / operator injection) and results are capped.
export default apiRoute(
  {
    GET: async (req, res) => {
      const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 32) : "";
      const filter = q ? { username: { $regex: escapeRegex(q), $options: "i" } } : {};
      const users = await User.find(filter).select("username lastSeen").sort({ username: 1 }).limit(50).lean();

      const online = new Set(await getPresence().onlineUsers());
      const list = users.map((u) => ({ username: u.username, online: online.has(u.username), lastSeen: u.lastSeen }));
      list.sort((a, b) => b.online - a.online);
      return res.status(200).json(list);
    },
  },
  { rateLimit: { name: "users-search", limit: 120, windowMs: 60 * 1000 } }
);
