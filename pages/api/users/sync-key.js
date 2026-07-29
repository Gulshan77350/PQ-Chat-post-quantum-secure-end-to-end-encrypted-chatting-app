import db from "../../../lib/db";
import User from "../../../models/Users";
import { applyRateLimit } from "../../../lib/rateLimit";

export default async function handler(req, res) {
  if (!applyRateLimit(req, res, { limit: 30, windowMs: 60000 })) return;

  await db();

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  try {
    const { username, publicKey } = req.body;

    if (!username || !publicKey) {
      return res.status(400).json({ success: false, message: "Username and publicKey are required" });
    }

    const updatedUser = await User.findOneAndUpdate(
      { username },
      { $set: { publicKey } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Public key synced successfully",
    });
  } catch (err) {
    console.error("❌ /api/users/sync-key error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}
