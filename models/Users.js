import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username:  { type: String, required: true, unique: true, trim: true },
    password:  { type: String, required: true },
    publicKey: { type: String, default: null }, // Kyber-512 public key (base64)
    online:    { type: Boolean, default: false },
    socketId:  { type: String, default: null },
    lastSeen:  { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model("User", userSchema);
