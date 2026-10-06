// lib/kemChallenge.js — server side of proof-of-private-key-possession.
//
// The server encapsulates a fresh secret to a public key and stores only
// SHA-256(HMAC(secret, challengeId)). The client must decapsulate with the matching
// private key and return the HMAC. This turns login into two factors (password AND the
// .pqkey file) and makes key replacement require control of the new key.
import crypto from "crypto";
import KemChallenge from "../models/KemChallenge.js";
import { KEM_PARAMS, kemForPublicKeyLength, fromB64, toB64 } from "./pqcrypto.js";
import { sha256 } from "./auth.js";

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
// ML-KEM ciphertext sizes per parameter set (used to build indistinguishable decoys).
const CIPHERTEXT_BYTES = { "ML-KEM-512": 768, "ML-KEM-768": 1088, "ML-KEM-1024": 1568 };

export function expectedProof(sharedSecret, challengeId) {
  return crypto
    .createHmac("sha256", Buffer.from(sharedSecret))
    .update(`pqchat-kem-proof-v1:${challengeId}`)
    .digest("base64");
}

export function validatePublicKey(publicKeyB64, kem) {
  if (typeof publicKeyB64 !== "string" || publicKeyB64.length > 4096) return null;
  let bytes;
  try {
    bytes = fromB64(publicKeyB64);
  } catch {
    return null;
  }
  const detected = kemForPublicKeyLength(bytes.length);
  if (!detected || (kem && kem !== detected)) return null;
  return detected;
}

export async function issueChallenge(user, purpose, publicKeyB64 = user.publicKey) {
  const kem = validatePublicKey(publicKeyB64);
  if (!kem) throw new Error("Cannot issue challenge: invalid public key");
  const challengeId = crypto.randomBytes(16).toString("hex");
  const [ciphertext, sharedSecret] = await new KEM_PARAMS[kem].Impl().encap(fromB64(publicKeyB64));
  await KemChallenge.create({
    _id: challengeId,
    userId: user._id,
    purpose,
    publicKey: publicKeyB64,
    proofHash: sha256(expectedProof(sharedSecret, challengeId)),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  return { challengeId, ciphertext: toB64(ciphertext), kem };
}

/** A decoy for unknown usernames so the endpoint doesn't reveal which accounts exist. */
export function decoyChallenge(kem = "ML-KEM-512") {
  return {
    challengeId: crypto.randomBytes(16).toString("hex"),
    ciphertext: crypto.randomBytes(CIPHERTEXT_BYTES[kem]).toString("base64"),
    kem,
  };
}

/**
 * Atomically consumes the challenge (single use) and checks the proof in constant time.
 * @returns {Promise<string|null>} the public key the challenge was issued for, or null
 */
export async function consumeChallenge({ challengeId, proof, purpose, userId }) {
  if (typeof challengeId !== "string" || typeof proof !== "string") return null;
  const challenge = await KemChallenge.findOneAndDelete({
    _id: challengeId,
    purpose,
    userId,
    expiresAt: { $gt: new Date() },
  });
  if (!challenge) return null;
  const a = Buffer.from(challenge.proofHash, "hex");
  const b = Buffer.from(sha256(proof), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? challenge.publicKey : null;
}
