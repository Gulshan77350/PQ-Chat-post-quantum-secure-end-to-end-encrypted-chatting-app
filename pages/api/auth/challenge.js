import User from "../../../models/Users.js";
import { apiRoute, requireUsername } from "../../../lib/api.js";
import { issueChallenge, decoyChallenge } from "../../../lib/kemChallenge.js";

// POST /api/auth/challenge { username }
// Step 1 of login: returns an ML-KEM ciphertext encapsulated to the user's pinned public
// key. Unknown users get an indistinguishable decoy to prevent username enumeration.
export default apiRoute(
  {
    POST: async (req, res) => {
      const username = requireUsername(req.body?.username);
      const user = await User.findOne({ username }).select("_id publicKey kem").lean();
      if (!user?.publicKey) return res.status(200).json(decoyChallenge());
      return res.status(200).json(await issueChallenge(user, "login"));
    },
  },
  { auth: false, rateLimit: { name: "auth-challenge", limit: 30, windowMs: 60 * 1000 } }
);
