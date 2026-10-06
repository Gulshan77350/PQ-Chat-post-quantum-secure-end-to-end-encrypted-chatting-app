import User from "../../../models/Users.js";
import { apiRoute, requireUsername, HttpError } from "../../../lib/api.js";
import { applyRateLimit } from "../../../lib/rateLimit.js";
import { verifyPassword } from "../../../lib/passwords.js";
import { consumeChallenge } from "../../../lib/kemChallenge.js";
import { createSession } from "../../../lib/auth.js";

// POST /api/auth/login { username, password, challengeId, proof }
// Two factors: the password (something you know) AND a proof that the client holds the
// private key matching the pinned public key (something you have: the .pqkey file).
export default apiRoute(
  {
    POST: async (req, res) => {
      const username = requireUsername(req.body?.username);
      // Per-account limit on top of the per-IP one: stops distributed password guessing.
      if (!(await applyRateLimit(req, res, { name: "login-user", key: username.toLowerCase(), limit: 10, windowMs: 15 * 60 * 1000 }))) return;

      const user = await User.findOne({ username });
      const passwordOk = await verifyPassword(req.body?.password, user?.password);
      const keyOk =
        passwordOk &&
        (await consumeChallenge({
          challengeId: req.body?.challengeId,
          proof: req.body?.proof,
          purpose: "login",
          userId: user._id,
        }));

      // One generic message for every failure: no username / password / key oracle.
      if (!user || !passwordOk || !keyOk) throw new HttpError(401, "Invalid credentials");

      const { accessToken } = await createSession(user, req, res);
      await User.updateOne({ _id: user._id }, { lastSeen: new Date() });
      return res.status(200).json({ accessToken, username: user.username });
    },
  },
  { auth: false, rateLimit: { name: "login-ip", limit: 20, windowMs: 60 * 1000 } }
);
