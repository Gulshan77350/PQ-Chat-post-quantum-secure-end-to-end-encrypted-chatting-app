// server.js — Unified entry point for production & Socket.IO backend
import { createServer } from "http";
import next from "next";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { initIO } from "./lib/socket.js";

dotenv.config();

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
const port = process.env.PORT || 3000;

app.prepare().then(async () => {
  try {
    // ✅ Check MONGO_URI
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error("❌ Missing MONGO_URI in environment variables");
    }

    // ✅ Check JWT_SECRET (Fail-Closed Startup Enforcement)
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error(
        "❌ Missing JWT_SECRET in environment variables. Refusing startup in fail-closed security mode."
      );
    }

    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    // ✅ Create HTTP + Next.js server
    const server = createServer((req, res) => {
      handle(req, res);
    });

    // ✅ Initialize Socket.IO (uses restricted CORS)
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
