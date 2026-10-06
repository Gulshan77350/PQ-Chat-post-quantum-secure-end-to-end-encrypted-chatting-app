import User from "../../../models/Users.js";
import { apiRoute, HttpError } from "../../../lib/api.js";

// GET /api/auth/me — the caller's own profile, including the public key the SERVER has
// pinned for them. The client compares it to the key derived from its local private
// key; a mismatch means the server-side key was tampered with.
export default apiRoute({
  GET: async (req, res) => {
    const user = await User.findById(req.user.id).select("username publicKey kem keyVersion keyUpdatedAt").lean();
    if (!user) throw new HttpError(404, "User not found");
    return res.status(200).json({
      username: user.username,
      publicKey: user.publicKey,
      kem: user.kem,
      keyVersion: user.keyVersion,
      keyUpdatedAt: user.keyUpdatedAt,
    });
  },
});
