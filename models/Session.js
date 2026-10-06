import mongoose from "mongoose";

// One document per logged-in device. The refresh token rotates on every use; only its
// SHA-256 hash is stored. `prevTokenHash` lets us detect reuse of a rotated-out token
// (a strong signal the token was stolen) and revoke the whole session.
const sessionSchema = new mongoose.Schema(
  {
    userId:        { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    username:      { type: String, required: true },
    tokenHash:     { type: String, required: true, unique: true },
    prevTokenHash: { type: String, default: null, index: true },
    rotatedAt:     { type: Date, default: null },
    expiresAt:     { type: Date, required: true },
    revokedAt:     { type: Date, default: null },
    revokeReason:  { type: String, default: null },
    userAgent:     { type: String, default: null },
    ip:            { type: String, default: null },
    lastUsedAt:    { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// MongoDB TTL monitor deletes sessions once they expire.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.Session || mongoose.model("Session", sessionSchema);
