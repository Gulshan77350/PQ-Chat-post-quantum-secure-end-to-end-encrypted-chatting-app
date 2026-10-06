import mongoose from "mongoose";
import Message from "../../../models/Message.js";
import { apiRoute } from "../../../lib/api.js";
import { getPresence } from "../../../lib/presence.js";

// GET /api/messages/recent — conversation list with last activity and unread counts,
// computed in ONE aggregation instead of loading every message into Node.
export default apiRoute(
  {
    GET: async (req, res) => {
      const me = new mongoose.Types.ObjectId(req.user.id);
      const rows = await Message.aggregate([
        { $match: { $or: [{ sender: me }, { receiver: me }] } },
        {
          $group: {
            _id: { $cond: [{ $eq: ["$sender", me] }, "$receiver", "$sender"] },
            lastAt: { $max: "$createdAt" },
            unseen: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ["$receiver", me] }, { $ne: ["$seen", true] }, { $not: ["$deletedAt"] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { lastAt: -1 } },
        { $limit: 100 },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "peer", pipeline: [{ $project: { username: 1 } }] } },
        { $unwind: "$peer" },
        { $project: { _id: 0, username: "$peer.username", lastAt: 1, unseen: 1 } },
      ]);

      const online = new Set(await getPresence().onlineUsers());
      return res.status(200).json(rows.map((r) => ({ ...r, online: online.has(r.username) })));
    },
  },
  { rateLimit: { name: "messages-recent", limit: 60, windowMs: 60 * 1000 } }
);
