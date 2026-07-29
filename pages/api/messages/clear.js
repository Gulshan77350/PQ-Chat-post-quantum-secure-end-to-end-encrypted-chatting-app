import db from "../../../lib/db";
import Message from "../../../models/Message";
import User from "../../../models/Users";
import { getIO } from "../../../lib/socket";
import { applyRateLimit } from "../../../lib/rateLimit";

export default async function handler(req, res) {
  if (!applyRateLimit(req, res, { limit: 20, windowMs: 60000 })) return;

  await db();

  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", ["POST", "DELETE"]);
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  try {
    const { user1, user2 } = req.body;

    if (!user1 || !user2) {
      return res.status(400).json({ success: false, message: "Both usernames are required" });
    }

    const [u1, u2] = await Promise.all([
      User.findOne({ username: user1 }),
      User.findOne({ username: user2 }),
    ]);

    if (!u1 || !u2) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Delete all messages between user1 and user2
    const result = await Message.deleteMany({
      $or: [
        { sender: u1._id, receiver: u2._id },
        { sender: u2._id, receiver: u1._id },
      ],
    });

    // Notify online clients in real-time
    try {
      const io = getIO();
      if (io) {
        io.to(user1).emit("messages:cleared", { by: user1, partner: user2 });
        io.to(user2).emit("messages:cleared", { by: user1, partner: user1 });
      }
    } catch (err) {
      console.warn("⚠️ Socket emit skipped:", err.message);
    }

    return res.status(200).json({
      success: true,
      message: "Chat history cleared from database",
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("❌ /api/messages/clear error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}
