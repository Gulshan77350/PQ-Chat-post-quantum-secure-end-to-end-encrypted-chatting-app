import { apiRoute } from "../../../lib/api.js";
import { revokeSessionByCookie, clearRefreshCookie } from "../../../lib/auth.js";

// POST /api/auth/logout — revokes this device's session. Works even with an expired
// access token, because the refresh cookie identifies the session.
export default apiRoute(
  {
    POST: async (req, res) => {
      await revokeSessionByCookie(req);
      clearRefreshCookie(res);
      return res.status(200).json({ message: "Logged out" });
    },
  },
  { auth: false, rateLimit: { name: "auth-logout", limit: 30, windowMs: 60 * 1000 } }
);
