import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    sender:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // Encrypted ciphertext (AES-GCM). Never stored as plaintext.
    text: { type: String, default: null },

    // AES-GCM fields for text decryption
    iv:                 { type: String, default: null }, // base64 IV
    encryptedKey:       { type: String, default: null }, // base64 key container for receiver
    senderEncryptedKey: { type: String, default: null }, // base64 key container for sender

    // Media fields
    mediaData:         { type: String, default: null }, // encrypted base64
    mediaIv:           { type: String, default: null },
    mediaEncKey:       { type: String, default: null }, // base64 key container for receiver
    senderMediaEncKey: { type: String, default: null }, // base64 key container for sender
    mediaName:         { type: String, default: null },
    mediaMimeType:     { type: String, default: null },
    mediaSize:         { type: Number, default: null },

    seen: { type: Boolean, default: false, index: true },
    type: { type: String, enum: ["text", "image", "file", "video", "audio"], default: "text" },
  },
  { timestamps: true }
);

messageSchema.index({ sender: 1, receiver: 1, createdAt: 1 });
messageSchema.index({ receiver: 1, seen: 1 });

export default mongoose.models.Message || mongoose.model("Message", messageSchema);
