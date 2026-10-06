import User from "../../../models/Users.js";
import { apiRoute, HttpError } from "../../../lib/api.js";
import { applyRateLimit } from "../../../lib/rateLimit.js";
import { verifyPassword } from "../../../lib/passwords.js";
import { consumeChallenge, validatePublicKey } from "../../../lib/kemChallenge.js";
import { broadcast } from "../../../lib/realtime.js";

// PUT /api/keys { publicKey, challengeId, proof, currentPassword }
//
// The ONLY way to replace a pinned public key. Requires all of:
//   1. a valid session (access token)
//   2. the current password (a stolen access token alone is not enough)
//   3. proof of possession of the new private key (single-use KEM challenge)
// Peers are notified via `key:changed` and their clients show a safety-number warning.
export default apiRoute(
  {
    PUT: async (req, res) => {
      if (!(await applyRateLimit(req, res, { name: "keys-rotate-user", key: req.user.id, limit: 5, windowMs: 60 * 60 * 1000 }))) return;

      const { publicKey, challengeId, proof, currentPassword } = req.body || {};
      const kem = validatePublicKey(publicKey);
      if (!kem) throw new HttpError(400, "Invalid public key");

      const user = await User.findById(req.user.id);
      if (!user || !(await verifyPassword(currentPassword, user.password))) {
        throw new HttpError(401, "Current password is incorrect");
      }
      const provenKey = await consumeChallenge({ challengeId, proof, purpose: "key-rotation", userId: user._id });
      if (!provenKey || provenKey !== publicKey) throw new HttpError(401, "Key possession proof failed");
      if (user.publicKey === publicKey) return res.status(200).json({ keyVersion: user.keyVersion, changed: false });

      user.publicKey = publicKey;
      user.kem = kem;
      user.keyVersion = (user.keyVersion || 1) + 1;
      user.keyUpdatedAt = new Date();
      await user.save();

      broadcast("key:changed", { username: user.username, keyVersion: user.keyVersion });
      return res.status(200).json({ keyVersion: user.keyVersion, changed: true });
    },
  },
  { rateLimit: { name: "keys-rotate-ip", limit: 10, windowMs: 60 * 1000 } }
);
