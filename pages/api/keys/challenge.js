import { apiRoute, HttpError } from "../../../lib/api.js";
import { issueChallenge, validatePublicKey } from "../../../lib/kemChallenge.js";

// POST /api/keys/challenge { publicKey } — step 1 of key rotation: prove you hold the
// private key for the NEW public key before the server will pin it.
export default apiRoute(
  {
    POST: async (req, res) => {
      if (!validatePublicKey(req.body?.publicKey)) throw new HttpError(400, "Invalid public key");
      const challenge = await issueChallenge({ _id: req.user.id }, "key-rotation", req.body.publicKey);
      return res.status(200).json(challenge);
    },
  },
  { rateLimit: { name: "keys-challenge", limit: 10, windowMs: 60 * 1000 } }
);
