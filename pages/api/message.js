import db from "../../lib/db";
import Message from "../../models/Message";
import User from "../../models/Users";
import { getIO, getSocketIdByUsername, getPresenceSnapshot } from "../../lib/socket";
import { applyRateLimit } from "../../lib/rateLimit";

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

export default async function handler(req, res) {
  // Apply rate limiting (100 requests per minute for sending/fetching messages)
  if (!applyRateLimit(req, res, { limit: 100, windowMs: 60000 })) return;

  await db();

  switch (req.method) {

    // ── SEND MESSAGE ────────────────────────────────────────────────────────
    case "POST": {
      try {
        const {
          senderUsername, receiverUsername,
          text, iv, encryptedKey, senderEncryptedKey,           // encrypted text fields
          mediaData, mediaName, mediaMimeType, mediaSize, mediaIv, mediaEncKey, senderMediaEncKey,
          type = "text",
        } = req.body;

        if (!senderUsername || !receiverUsername) {
          return res.status(400).json({ message: "Missing sender/receiver" });
        }
        if (!text && !mediaData) {
          return res.status(400).json({ message: "Message must have text or media" });
        }

        const [sender, receiver] = await Promise.all([
          User.findOne({ username: senderUsername }),
          User.findOne({ username: receiverUsername }),
        ]);
        if (!sender || !receiver) {
          return res.status(404).json({ message: "User not found" });
        }

        const newMessage = await Message.create({
          sender:             sender._id,
          receiver:           receiver._id,
          text:               text               || null,
          iv:                 iv                 || null,
          encryptedKey:       encryptedKey       || null,
          senderEncryptedKey: senderEncryptedKey || null,
          mediaData,          mediaName,          mediaMimeType,          mediaSize,
          mediaIv:            mediaIv            || null,
          mediaEncKey:        mediaEncKey        || null,
          senderMediaEncKey:  senderMediaEncKey  || null,
          seen: false,
          type,
        });

        const populated = await Message.findById(newMessage._id)
          .populate("sender",   "username")
          .populate("receiver", "username")
          .lean();

        const payload = buildPayload(populated);

        // Real-time delivery via Socket.IO rooms
        try {
          const io = getIO();
          io.to(receiverUsername).emit("message:new", payload);
          io.to(senderUsername).emit("message:new", payload);
        } catch (e) { console.warn("Socket emit skipped:", e.message); }

        return res.status(201).json({ message: "Sent", data: populated });
      } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server error" });
      }
    }

    // ── FETCH HISTORY / RECENT CHATS (WITH CURSOR PAGINATION) ────────────────
    case "GET": {
      try {
        const { user1, user2, recent, limit, before } = req.query;

        // Recent chat partners list
        if (recent && user1) {
          const user = await User.findOne({ username: user1 });
          if (!user) return res.status(404).json({ message: "User not found" });

          const recentMsgs = await Message.find({
            $or: [{ sender: user._id }, { receiver: user._id }],
          })
            .populate("sender",   "username")
            .populate("receiver", "username")
            .sort({ updatedAt: -1 })
            .lean();

          const partners = new Map();
          for (const msg of recentMsgs) {
            const partner = msg.sender.username === user1 ? msg.receiver : msg.sender;
            if (!partners.has(partner.username)) partners.set(partner.username, partner);
          }

          const unseenCounts = await Message.aggregate([
            { $match: { receiver: user._id, seen: false } },
            { $group: { _id: "$sender", count: { $sum: 1 } } },
          ]);
          const countMap  = new Map(unseenCounts.map(c => [String(c._id), c.count]));
          const presence  = getPresenceSnapshot();

          const list = await Promise.all(
            Array.from(partners.entries()).map(async ([uname]) => {
              const u = await User.findOne({ username: uname }).lean();
              return {
                username: uname,
                unseen:   countMap.get(String(u?._id)) || 0,
                online:   !!presence[uname],
              };
            })
          );
          return res.status(200).json(list);
        }

        // Full chat history between two users with cursor-based pagination
        if (!user1 || !user2) {
          return res.status(400).json({ message: "Missing user params" });
        }

        const [userA, userB] = await Promise.all([
          User.findOne({ username: user1 }),
          User.findOne({ username: user2 }),
        ]);
        if (!userA || !userB) return res.status(404).json({ message: "User not found" });

        const queryLimit = Math.min(parseInt(limit, 10) || 50, 100);
        const queryFilter = {
          $or: [
            { sender: userA._id, receiver: userB._id },
            { sender: userB._id, receiver: userA._id },
          ],
        };

        if (before) {
          queryFilter.createdAt = { $lt: new Date(before) };
        }

        // Fetch newest messages up to limit + 1 to determine if hasMore pages exist
        const rawMessages = await Message.find(queryFilter)
          .populate("sender",   "username")
          .populate("receiver", "username")
          .sort({ createdAt: -1 })
          .limit(queryLimit + 1)
          .lean();

        const hasMore = rawMessages.length > queryLimit;
        const messages = hasMore ? rawMessages.slice(0, queryLimit) : rawMessages;

        // Reverse to chronological order (oldest -> newest) for display
        messages.reverse();

        const nextCursor = hasMore && messages.length > 0 ? messages[0].createdAt : null;

        // Mark as seen
        const updated = await Message.updateMany(
          { sender: userB._id, receiver: userA._id, seen: false },
          { $set: { seen: true } }
        );
        if (updated.modifiedCount > 0) {
          try {
            const io  = getIO();
            const sid = getSocketIdByUsername(user2);
            if (sid) io.to(sid).emit("messages:seen", { from: user1, by: user1 });
          } catch (e) { console.warn("Socket emit skipped:", e.message); }
        }

        return res.status(200).json({
          messages,
          hasMore,
          nextCursor,
        });
      } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server error" });
      }
    }

    default:
      res.setHeader("Allow", ["POST", "GET"]);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

function buildPayload(msg) {
  return {
    id:                 msg._id.toString(),
    sender:             msg.sender.username,
    receiver:           msg.receiver.username,
    text:               msg.text,
    iv:                 msg.iv,
    encryptedKey:       msg.encryptedKey,
    senderEncryptedKey: msg.senderEncryptedKey,
    mediaData:          msg.mediaData,
    mediaName:          msg.mediaName,
    mediaMimeType:      msg.mediaMimeType,
    mediaSize:          msg.mediaSize,
    mediaIv:            msg.mediaIv,
    mediaEncKey:        msg.mediaEncKey,
    senderMediaEncKey:  msg.senderMediaEncKey,
    type:               msg.type,
    createdAt:          msg.createdAt,
    seen:               msg.seen,
  };
}
