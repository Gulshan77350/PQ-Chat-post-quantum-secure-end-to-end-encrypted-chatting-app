import db from "../../../lib/db";
import Message from "../../../models/Message";
import User from "../../../models/Users";
import { getIO, getSocketIdByUsername } from "../../../lib/socket";

export default async function handler(req, res) {
  await db(); // ensure DB connection

  // Only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  try {
    const { user1, user2 } = req.body; // user1 = viewer, user2 = chat partner

    if (!user1 || !user2) {
      return res.status(400).json({ success: false, message: "Both usernames are required" });
    }

    // Find both users in parallel
    const [viewer, partner] = await Promise.all([
      User.findOne({ username: user1 }),
      User.findOne({ username: user2 }),
    ]);

    if (!viewer || !partner) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // ✅ Mark all unseen messages (partner → viewer) as seen
    const result = await Message.updateMany(
      { sender: partner._id, receiver: viewer._id, seen: false },
      { $set: { seen: true } }
    );

    // 🔥 Emit real-time seen event to partner (if they’re online)
    try {
      const io = getIO?.();
      const partnerSid = getSocketIdByUsername(partner.username);

      if (io && partnerSid) {
        io.to(partnerSid).emit("messages:seen", {
          from: viewer.username, // who saw the messages
          by: user1,              // same viewer
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
