import mongoose from "mongoose";

// Single-use proof-of-possession challenge. Stored in Mongo (not process memory) so a
// challenge issued by one instance can be redeemed on another.
const kemChallengeSchema = new mongoose.Schema({
  _id:       { type: String },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  purpose:   { type: String, enum: ["login", "key-rotation"], required: true },
  publicKey: { type: String, required: true },
  proofHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

kemChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.KemChallenge || mongoose.model("KemChallenge", kemChallengeSchema);
