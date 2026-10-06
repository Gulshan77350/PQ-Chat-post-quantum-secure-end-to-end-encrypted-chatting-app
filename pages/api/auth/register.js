import User from "../../../models/Users.js";
import { apiRoute, requireUsername, HttpError } from "../../../lib/api.js";
import { validatePassword, hashPassword } from "../../../lib/passwords.js";
import { validatePublicKey } from "../../../lib/kemChallenge.js";
import { broadcast } from "../../../lib/realtime.js";

// POST /api/auth/register { username, password, publicKey, kem }
export default apiRoute(
  {
    POST: async (req, res) => {
      const username = requireUsername(req.body?.username);
      const password = validatePassword(req.body?.password);
      const kem = validatePublicKey(req.body?.publicKey, req.body?.kem);
      if (!kem) throw new HttpError(400, "A valid ML-KEM public key is required");

      if (await User.exists({ username })) throw new HttpError(409, "Username already exists");

      try {
        await User.create({
          username,
          password: await hashPassword(password),
          publicKey: req.body.publicKey,
          kem,
          keyVersion: 1,
          keyUpdatedAt: new Date(),
        });
      } catch (err) {
        if (err?.code === 11000) throw new HttpError(409, "Username already exists");
        throw err;
      }

      broadcast("users:changed");
      return res.status(201).json({ message: "User registered successfully" });
    },
  },
  { auth: false, rateLimit: { name: "register", limit: 10, windowMs: 60 * 60 * 1000 } }
);
