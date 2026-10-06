import { apiRoute } from "../../../lib/api.js";
import { rotateSession } from "../../../lib/auth.js";

// POST /api/auth/refresh — rotates the httpOnly refresh cookie, returns a new access token.
export default apiRoute(
  {
    POST: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(await rotateSession(req, res));
    },
  },
  { auth: false, rateLimit: { name: "auth-refresh", limit: 60, windowMs: 60 * 1000 } }
);
