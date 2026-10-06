import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    sender:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // Encrypted text (AES-GCM ciphertext, base64). Never stored as plaintext.
    text:               { type: String, default: null },
    iv:                 { type: String, default: null },
    encryptedKey:       { type: String, default: null }, // key container for receiver
    senderEncryptedKey: { type: String, default: null }, // key container for sender
    cryptoVersion:      { type: Number, default: null }, // null = legacy v1 payload

    // Media: encrypted blob in object storage, referenced by mediaId.
    mediaId:           { type: String, default: null },
    mediaIv:           { type: String, default: null },
    mediaEncKey:       { type: String, default: null },
    senderMediaEncKey: { type: String, default: null },
    mediaSize:         { type: Number, default: null },

    // Legacy v1 media stored inline as base64 (read-only, kept for old messages).
    mediaData:     { type: String, default: null },
    mediaName:     { type: String, default: null },
    mediaMimeType: { type: String, default: null },

    type: { type: String, enum: ["text", "media", "image", "file", "video", "audio"], default: "text" },

    // Delivery lifecycle: sent (createdAt) → delivered → seen
    deliveredAt: { type: Date, default: null },
    seenAt:      { type: Date, default: null },
    seen:        { type: Boolean, default: false }, // kept in sync with seenAt for old clients

    editedAt:  { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, seenAt: 1 });
messageSchema.index({ receiver: 1, deliveredAt: 1 });

export default mongoose.models.Message || mongoose.model("Message", messageSchema);
