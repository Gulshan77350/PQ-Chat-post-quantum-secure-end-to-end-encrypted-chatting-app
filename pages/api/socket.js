// pages/api/socket.js
import { initIO } from "../../lib/socket";

// Disable Next.js body parsing (Socket.IO handles upgrades)
export const config = {
  api: { bodyParser: false },
};

export default function handler(req, res) {
  try {
    // ✅ Use a global instance so socket survives hot reloads or multiple invocations
    if (!global._io && !res.socket.server.io) {
      console.log("🚀 Initializing Socket.IO server...");
      const io = initIO(res.socket.server);
      res.socket.server.io = io;
      global._io = io;
      console.log("✅ Socket.IO server ready!");
    } else {
      console.log("⚡ Socket.IO server already running.");
    }
  } catch (err) {
    console.error("❌ Socket.IO init error:", err);
  }

  res.end();
}
