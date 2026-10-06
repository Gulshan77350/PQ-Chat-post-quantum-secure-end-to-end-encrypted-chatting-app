import mongoose from "mongoose";

// Encrypted attachment blobs live in object storage (S3/R2/MinIO or local disk);
// MongoDB only keeps this pointer plus ownership/attachment state.
const mediaSchema = new mongoose.Schema(
  {
    _id:       { type: String },
    owner:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    size:      { type: Number, required: true },
    status:    { type: String, enum: ["pending", "uploading", "uploaded", "attached"], default: "pending" },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  },
  { timestamps: true }
);

export default mongoose.models.Media || mongoose.model("Media", mediaSchema);
