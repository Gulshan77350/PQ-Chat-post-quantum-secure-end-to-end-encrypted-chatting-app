import User from "../../../models/Users.js";
import { apiRoute, HttpError } from "../../../lib/api.js";
import { applyRateLimit } from "../../../lib/rateLimit.js";
import { validatePassword, verifyPassword, hashPassword } from "../../../lib/passwords.js";
import { revokeSessions } from "../../../lib/auth.js";

// POST /api/auth/change-password { currentPassword, newPassword }
// Requires an authenticated session AND the current password. Every other session is
// revoked afterwards. The client re-wraps its .pqkey file under the new password.
export default apiRoute(
  {
    POST: async (req, res) => {
      if (!(await applyRateLimit(req, res, { name: "change-password-user", key: req.user.id, limit: 5, windowMs: 15 * 60 * 1000 }))) return;

      const newPassword = validatePassword(req.body?.newPassword, "newPassword");
      const user = await User.findById(req.user.id);
      if (!user || !(await verifyPassword(req.body?.currentPassword, user.password))) {
        throw new HttpError(401, "Current password is incorrect");
      }

      user.password = await hashPassword(newPassword);
      await user.save();
      const revoked = await revokeSessions({ userId: user._id, _id: { $ne: req.user.sid } }, "password-change");
      return res.status(200).json({ message: "Password updated", revokedSessions: revoked });
    },
  },
  { rateLimit: { name: "change-password-ip", limit: 10, windowMs: 60 * 1000 } }
);
