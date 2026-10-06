// lib/messages.js — message serialisation and delivery-state transitions.
import mongoose from "mongoose";
import Message from "../models/Message.js";
import { emitToUsers } from "./realtime.js";
import { requireString } from "./api.js";

export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_CIPHERTEXT = 64 * 1024; // base64 text ciphertext
export const MAX_CONTAINER = 8 * 1024;   // one KEM key container (JSON)

/** Validates an encrypted text envelope (all fields or none). */
export function readTextEnvelope(body) {
  if (!body?.text) return null;
  return {
    text: requireString(body.text, "text", { max: MAX_CIPHERTEXT }),
    iv: requireString(body.iv, "iv", { max: 64 }),
    encryptedKey: requireString(body.encryptedKey, "encryptedKey", { max: MAX_CONTAINER }),
    senderEncryptedKey: requireString(body.senderEncryptedKey, "senderEncryptedKey", { max: MAX_CONTAINER }),
  };
}

export function messageStatus(m) {
  if (m.seenAt || m.seen) return "seen";
  if (m.deliveredAt) return "delivered";
  return "sent";
}

/** Wire format. Expects sender/receiver populated with { username }. */
export function serializeMessage(m, extra = {}) {
  const deleted = !!m.deletedAt;
  return {
    id: String(m._id),
    sender: m.sender?.username ?? null,
    receiver: m.receiver?.username ?? null,
    type: m.type,
    cryptoVersion: m.cryptoVersion ?? null,
    text: deleted ? null : m.text,
    iv: deleted ? null : m.iv,
    encryptedKey: deleted ? null : m.encryptedKey,
    senderEncryptedKey: deleted ? null : m.senderEncryptedKey,
    media: deleted || !(m.mediaId || m.mediaData)
      ? null
      : {
          id: m.mediaId || null,
          iv: m.mediaIv,
          encryptedKey: m.mediaEncKey,
          senderEncryptedKey: m.senderMediaEncKey,
          size: m.mediaSize,
          // legacy inline fields (pre object storage)
          data: m.mediaData || null,
          name: m.mediaName || null,
          mimeType: m.mediaMimeType || null,
        },
    status: messageStatus(m),
    createdAt: m.createdAt,
    deliveredAt: m.deliveredAt || null,
    seenAt: m.seenAt || null,
    editedAt: m.editedAt || null,
    deletedAt: m.deletedAt || null,
    ...extra,
  };
}

const toObjectIds = (ids) =>
  ids.filter((id) => typeof id === "string" && mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));

/** Groups message docs by sender username and notifies each sender. */
async function notifySenders(docs, event, at) {
  const bySender = new Map();
  for (const d of docs) {
    const list = bySender.get(d.sender.username) || [];
    list.push(String(d._id));
    bySender.set(d.sender.username, list);
  }
  for (const [sender, ids] of bySender) emitToUsers([sender], event, { ids, at });
}

/**
 * Marks messages addressed to `receiver` as delivered. With `ids` only those messages,
 * otherwise every undelivered message (used when the receiver connects).
 */
export async function markDelivered(receiver, ids = null) {
  const filter = { receiver: receiver.id, deliveredAt: null, deletedAt: null };
  if (ids) filter._id = { $in: toObjectIds(ids).slice(0, 500) };
  const docs = await Message.find(filter).select("_id sender").populate("sender", "username").lean();
  if (!docs.length) return 0;
  const at = new Date();
  await Message.updateMany({ _id: { $in: docs.map((d) => d._id) }, deliveredAt: null }, { $set: { deliveredAt: at } });
  await notifySenders(docs, "messages:delivered", at);
  return docs.length;
}

/** Marks everything `partner` sent to `viewer` as seen (and delivered). */
export async function markSeen(viewer, partner) {
  const filter = { sender: partner._id, receiver: viewer.id, seenAt: null, deletedAt: null };
  const docs = await Message.find(filter).select("_id").lean();
  if (!docs.length) return 0;
  const at = new Date();
  const ids = docs.map((d) => d._id);
  await Message.updateMany({ _id: { $in: ids } }, { $set: { seenAt: at, seen: true } });
  await Message.updateMany({ _id: { $in: ids }, deliveredAt: null }, { $set: { deliveredAt: at } });
  emitToUsers([partner.username], "messages:seen", { by: viewer.username, ids: ids.map(String), at });
  return ids.length;
}
