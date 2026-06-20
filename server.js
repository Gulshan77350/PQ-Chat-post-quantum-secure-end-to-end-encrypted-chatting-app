// server.js — Unified entry point for production & Socket.IO backend
import { createServer } from "http";
import next from "next";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { initIO } from "./lib/socket.js"; // ✅ uses your existing socket.js (no need for extra handlers)

dotenv.config();

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
const port = process.env.PORT || 3000;

app.prepare().then(async () => {
  try {
    // ✅ MongoDB Connection
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error("❌ Missing MONGO_URI in .env file");
    }
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    // ✅ Create HTTP + Next.js server
    const server = createServer((req, res) => {
      handle(req, res);
    });

    // ✅ Initialize Socket.IO (uses your existing lib/socket.js)
    initIO(server);

    // ✅ Start listening
    server.listen(port, () => {
      console.log(`🚀 Server running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("❌ Server startup error:", error);
    process.exit(1);
  }
});
