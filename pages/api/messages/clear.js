import Message from "../../../models/Message.js";
import Media from "../../../models/Media.js";
import User from "../../../models/Users.js";
import { apiRoute, requireUsername, HttpError } from "../../../lib/api.js";
import { emitToUsers } from "../../../lib/realtime.js";
import { deleteObject } from "../../../lib/storage.js";

// POST /api/messages/clear { with } — permanently deletes the caller's conversation with
// `with` (for both participants), including encrypted media blobs.
export default apiRoute(
  {
    POST: async (req, res) => {
      const partner = await User.findOne({ username: requireUsername(req.body?.with, "with") }).select("_id username").lean();
      if (!partner) throw new HttpError(404, "User not found");

      const filter = {
        $or: [
          { sender: req.user.id, receiver: partner._id },
          { sender: partner._id, receiver: req.user.id },
        ],
      };
      const mediaIds = (await Message.find({ ...filter, mediaId: { $ne: null } }).select("mediaId").lean()).map((m) => m.mediaId);
      const result = await Message.deleteMany(filter);
      await Promise.all(mediaIds.map(deleteObject));
      if (mediaIds.length) await Media.deleteMany({ _id: { $in: mediaIds } });

      emitToUsers([req.user.username], "messages:cleared", { by: req.user.username, partner: partner.username });
      emitToUsers([partner.username], "messages:cleared", { by: req.user.username, partner: req.user.username });
      return res.status(200).json({ deletedCount: result.deletedCount });
    },
  },
  { rateLimit: { name: "messages-clear", limit: 20, windowMs: 60 * 1000 } }
);
