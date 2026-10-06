// lib/socket.js — Socket.IO server setup (imported only by server.js).
import crypto from "crypto";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import User from "../models/Users.js";
import { authenticateToken } from "./auth.js";
import { getRedis } from "./redis.js";
import { getPresence, HEARTBEAT_MS } from "./presence.js";
import { markDelivered } from "./messages.js";
import { userRoom, sessionRoom } from "./realtime.js";
import { USERNAME_RE } from "./api.js";

const TYPING_MIN_INTERVAL_MS = 300;

export async function initIO(httpServer) {
  if (globalThis._io) return globalThis._io;

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
    : ["http://localhost:3000", "http://127.0.0.1:3000"];

  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
    maxHttpBufferSize: 64 * 1024, // sockets carry only small control events
  });

  // Horizontal scaling: the Redis adapter fans room emits out to every instance.
  const redis = getRedis();
  if (redis) {
    const pub = redis.duplicate();
    const sub = redis.duplicate();
    io.adapter(createAdapter(pub, sub));
    console.log("🔁 Socket.IO Redis adapter enabled");
  } else {
    console.log("ℹ️  REDIS_URL not set — Socket.IO running in single-instance mode");
  }

  const presence = getPresence();
  const instanceId = crypto.randomBytes(4).toString("hex");

  // ── Handshake authentication ───────────────────────────────────
  // Identity comes ONLY from a verified access token; nothing client-asserted is trusted.
  io.use(async (socket, next) => {
    try {
      const user = await authenticateToken(socket.handshake?.auth?.token);
      if (!user) return next(new Error("unauthorized"));
      socket.data.user = user;
      next();
    } catch (err) {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user;
    const { username } = user;

    socket.join(userRoom(username));
    socket.join(sessionRoom(user.sid));

    // Force a re-handshake (with a fresh token) when the access token expires.
    const msLeft = user.exp * 1000 - Date.now();
    const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(msLeft, 0));

    try {
      const cameOnline = await presence.add(username, socket.id);
      socket.emit("presence:snapshot", await presence.onlineUsers());
      if (cameOnline) socket.broadcast.emit("presence:online", { username });
      // Anything sent while this user was offline is now delivered.
      await markDelivered(user);
    } catch (err) {
      console.error("Socket connect bookkeeping failed:", err);
    }

    // ── Typing indicators (rate limited, recipient validated) ──────
    let lastTyping = 0;
    const relayTyping = (event) => (data) => {
      const to = data?.to;
      if (typeof to !== "string" || !USERNAME_RE.test(to) || to === username) return;
      const now = Date.now();
      if (event === "typing:start" && now - lastTyping < TYPING_MIN_INTERVAL_MS) return;
      lastTyping = now;
      socket.to(userRoom(to)).emit(event, { from: username });
    };
    socket.on("typing:start", relayTyping("typing:start"));
    socket.on("typing:stop", relayTyping("typing:stop"));

    // ── Delivery receipts: the receiving client acks message ids ───
    socket.on("messages:delivered", async (data) => {
      if (!Array.isArray(data?.ids) || !data.ids.length) return;
      try {
        await markDelivered(user, data.ids);
      } catch (err) {
        console.error("messages:delivered failed:", err.message);
      }
    });

    socket.on("disconnect", async () => {
      clearTimeout(expiryTimer);
      try {
        const wentOffline = await presence.remove(username, socket.id);
        if (wentOffline) {
          await User.updateOne({ username }, { lastSeen: new Date() });
          io.emit("presence:offline", { username });
        }
      } catch (err) {
        console.error("Socket disconnect bookkeeping failed:", err);
      }
    });
  });

  // Keep this instance's presence entries alive (they expire if the process dies).
  setInterval(() => {
    const entries = [];
    for (const [id, s] of io.of("/").sockets) entries.push([s.data.user.username, id]);
    presence.refresh(entries).catch((err) => console.error("Presence heartbeat failed:", err.message));
  }, HEARTBEAT_MS).unref();

  globalThis._io = io;
  console.log(`✅ Socket.IO ready (instance ${instanceId}, origins: ${allowedOrigins.join(", ")})`);
  return io;
}
