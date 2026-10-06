import mongoose from "mongoose";
import Message from "../../../models/Message.js";
import Media from "../../../models/Media.js";
import User from "../../../models/Users.js";
import { apiRoute, requireString, requireUsername, HttpError } from "../../../lib/api.js";
import { serializeMessage, readTextEnvelope, MAX_CONTAINER } from "../../../lib/messages.js";
import { emitToUsers } from "../../../lib/realtime.js";
import { statObject, deleteObject, isS3, MAX_MEDIA_BYTES } from "../../../lib/storage.js";
import { CRYPTO_VERSION } from "../../../lib/pqcrypto.js";

export const config = { api: { bodyParser: { sizeLimit: "256kb" } } };

async function findPeer(username) {
  const peer = await User.findOne({ username }).select("_id username").lean();
  if (!peer) throw new HttpError(404, "User not found");
  return peer;
}

/** Claims an uploaded media object for a message. Only the uploader can attach it, once. */
async function claimMedia(mediaReq, ownerId) {
  const id = requireString(mediaReq.id, "media.id", { max: 64 });
  const fields = {
    mediaId: id,
    mediaIv: requireString(mediaReq.iv, "media.iv", { max: 64 }),
    mediaEncKey: requireString(mediaReq.encryptedKey, "media.encryptedKey", { max: MAX_CONTAINER }),
    senderMediaEncKey: requireString(mediaReq.senderEncryptedKey, "media.senderEncryptedKey", { max: MAX_CONTAINER }),
  };
  // Atomic claim so two concurrent sends cannot attach the same blob. Local uploads are
  // confirmed by our PUT handler ("uploaded"); presigned S3 uploads stay "pending".
  const media = await Media.findOneAndUpdate(
    { _id: id, owner: ownerId, status: isS3() ? "pending" : "uploaded" },
    { status: "attached" }
  );
  if (!media) throw new HttpError(400, "Unknown or already used media");

  // Presigned S3 uploads never pass through us, so verify what actually landed.
  const size = await statObject(id);
  if (size === null || size > MAX_MEDIA_BYTES || size !== media.size) {
    await deleteObject(id);
    await Media.deleteOne({ _id: id });
    throw new HttpError(400, "Media upload missing or size mismatch");
  }
  return { doc: media, fields: { ...fields, mediaSize: size } };
}

// Compound (createdAt, _id) cursor: stable even when two messages share a timestamp.
function parseCursor(before) {
  if (!before) return null;
  const [ts, id] = String(before).split("_");
  const date = new Date(ts);
  if (Number.isNaN(date.getTime()) || !mongoose.isValidObjectId(id)) throw new HttpError(400, "Invalid cursor");
  return { date, id: new mongoose.Types.ObjectId(id) };
}

export default apiRoute(
  {
    // ── SEND ─────────────────────────────────────────────────────
    POST: async (req, res) => {
      const body = req.body || {};
      const to = requireUsername(body.to, "to");
      if (to === req.user.username) throw new HttpError(400, "Cannot message yourself");
      if (body.cryptoVersion !== CRYPTO_VERSION) {
        throw new HttpError(400, `cryptoVersion ${CRYPTO_VERSION} required`); // no legacy writes
      }
      const clientId = requireString(body.clientId, "clientId", { max: 64, optional: true });

      const receiver = await findPeer(to);
      const textEnv = readTextEnvelope(body);
      const media = body.media ? await claimMedia(body.media, req.user.id) : null;
      if (!textEnv && !media) throw new HttpError(400, "Message must have text or media");

      const msg = await Message.create({
        sender: req.user.id,
        receiver: receiver._id,
        ...(textEnv || {}),
        ...(media?.fields || {}),
        cryptoVersion: CRYPTO_VERSION,
        type: media ? "media" : "text",
      });
      if (media) await Media.updateOne({ _id: media.doc._id }, { status: "attached", messageId: msg._id });

      const payload = serializeMessage(
        { ...msg.toObject(), sender: { username: req.user.username }, receiver: { username: receiver.username } },
        { clientId }
      );
      emitToUsers([receiver.username, req.user.username], "message:new", payload);
      return res.status(201).json(payload);
    },

    // ── HISTORY (cursor pagination, newest page first) ───────────
    GET: async (req, res) => {
      const peer = await findPeer(requireUsername(req.query.with, "with"));
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
      const cursor = parseCursor(req.query.before);

      const conversation = {
        $or: [
          { sender: req.user.id, receiver: peer._id },
          { sender: peer._id, receiver: req.user.id },
        ],
      };
      const filter = cursor
        ? {
            $and: [
              conversation,
              { $or: [{ createdAt: { $lt: cursor.date } }, { createdAt: cursor.date, _id: { $lt: cursor.id } }] },
            ],
          }
        : conversation;

      const rows = await Message.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .populate("sender", "username")
        .populate("receiver", "username")
        .lean();

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const oldest = page[page.length - 1];
      return res.status(200).json({
        messages: page.reverse().map((m) => serializeMessage(m)),
        hasMore,
        nextCursor: hasMore && oldest ? `${oldest.createdAt.toISOString()}_${oldest._id}` : null,
      });
    },
  },
  { rateLimit: { name: "messages", limit: 120, windowMs: 60 * 1000 } }
);
