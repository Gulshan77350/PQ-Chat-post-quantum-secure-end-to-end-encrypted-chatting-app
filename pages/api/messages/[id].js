import mongoose from "mongoose";
import Message from "../../../models/Message.js";
import Media from "../../../models/Media.js";
import { apiRoute, HttpError } from "../../../lib/api.js";
import { serializeMessage, readTextEnvelope, EDIT_WINDOW_MS } from "../../../lib/messages.js";
import { emitToUsers } from "../../../lib/realtime.js";
import { deleteObject } from "../../../lib/storage.js";
import { CRYPTO_VERSION } from "../../../lib/pqcrypto.js";

/** Loads a message the caller SENT (only senders may edit or delete). */
async function loadOwnMessage(req) {
  if (!mongoose.isValidObjectId(req.query.id)) throw new HttpError(400, "Invalid message id");
  const msg = await Message.findById(req.query.id).populate("sender", "username").populate("receiver", "username");
  // 404 rather than 403 for other people's messages: don't confirm they exist.
  if (!msg || String(msg.sender._id) !== req.user.id) throw new HttpError(404, "Message not found");
  if (msg.deletedAt) throw new HttpError(410, "Message was deleted");
  return msg;
}

function broadcastUpdate(msg) {
  const payload = serializeMessage(msg.toObject());
  emitToUsers([msg.sender.username, msg.receiver.username], "message:updated", payload);
  return payload;
}

export default apiRoute(
  {
    // PATCH /api/messages/:id — edit text (client re-encrypts the new text).
    PATCH: async (req, res) => {
      const msg = await loadOwnMessage(req);
      if (!msg.text) throw new HttpError(400, "Only text can be edited");
      if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_MS) throw new HttpError(403, "Edit window has expired");
      if (req.body?.cryptoVersion !== CRYPTO_VERSION) throw new HttpError(400, `cryptoVersion ${CRYPTO_VERSION} required`);
      const env = readTextEnvelope(req.body);
      if (!env) throw new HttpError(400, "text is required");

      Object.assign(msg, env, { cryptoVersion: CRYPTO_VERSION, editedAt: new Date() });
      await msg.save();
      return res.status(200).json(broadcastUpdate(msg));
    },

    // DELETE /api/messages/:id — delete for everyone. Ciphertext and key material are
    // wiped; a tombstone remains so both clients render "message deleted".
    DELETE: async (req, res) => {
      const msg = await loadOwnMessage(req);
      const mediaId = msg.mediaId;
      for (const f of ["text", "iv", "encryptedKey", "senderEncryptedKey", "mediaId", "mediaIv", "mediaEncKey",
        "senderMediaEncKey", "mediaSize", "mediaData", "mediaName", "mediaMimeType"]) {
        msg[f] = null;
      }
      msg.deletedAt = new Date();
      await msg.save();
      if (mediaId) {
        await deleteObject(mediaId);
        await Media.deleteOne({ _id: mediaId });
      }
      return res.status(200).json(broadcastUpdate(msg));
    },
  },
  { rateLimit: { name: "messages-mutate", limit: 60, windowMs: 60 * 1000 } }
);
