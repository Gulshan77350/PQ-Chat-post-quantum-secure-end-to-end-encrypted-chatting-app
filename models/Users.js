import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username:  { type: String, required: true, unique: true, trim: true },
    password:  { type: String, required: true },

    // Pinned ML-KEM public key. Set at registration; only replaced through the
    // authenticated, proof-of-possession key rotation flow (pages/api/keys).
    publicKey:     { type: String, default: null },
    kem:           { type: String, default: "ML-KEM-512" },
    keyVersion:    { type: Number, default: 1 },
    keyUpdatedAt:  { type: Date, default: null },

    lastSeen:  { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model("User", userSchema);
