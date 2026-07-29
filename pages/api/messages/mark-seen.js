import db from "../../../lib/db";
import Message from "../../../models/Message";
import User from "../../../models/Users";
import { getIO, getSocketIdByUsername } from "../../../lib/socket";
import { applyRateLimit } from "../../../lib/rateLimit";

export default async function handler(req, res) {
  if (!applyRateLimit(req, res, { limit: 120, windowMs: 60000 })) return;

  await db();

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  try {
    const { user1, user2 } = req.body;

    if (!user1 || !user2) {
      return res.status(400).json({ success: false, message: "Both usernames are required" });
    }

    const [viewer, partner] = await Promise.all([
      User.findOne({ username: user1 }),
      User.findOne({ username: user2 }),
    ]);

    if (!viewer || !partner) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const result = await Message.updateMany(
      { sender: partner._id, receiver: viewer._id, seen: false },
      { $set: { seen: true } }
    );

    try {
      const io = getIO?.();
      const partnerSid = getSocketIdByUsername(partner.username);

      if (io && partnerSid) {
        io.to(partnerSid).emit("messages:seen", {
          from: viewer.username,
          by: user1,
        });
      }
    } catch (err) {
      console.warn("⚠️ Socket emit skipped:", err.message);
    }

    return res.status(200).json({
      success: true,
      message: "Messages marked as seen",
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error("❌ /api/messages/mark-seen error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}
