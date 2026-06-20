import { Server } from "socket.io";
import User from "../models/Users.js";

let io;

// In-memory presence tracking
const usernameToSocketId = new Map();
const socketIdToUsername = new Map();

// ✅ Initialize Socket.IO once (singleton)
export function initIO(httpServer) {
  if (io) {
    console.log("⚡ Socket.IO already running.");
    return io;
  }

  io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  console.log("🚀 Initializing Socket.IO server...");

  io.on("connection", async (socket) => {
    const username = socket.handshake?.auth?.username;

    if (!username) {
      console.warn("⚠️ Connection rejected (no username).");
      socket.disconnect(true);
      return;
    }

    // Register connection
    usernameToSocketId.set(username, socket.id);
    socketIdToUsername.set(socket.id, username);
    console.log(`✅ ${username} connected (${socket.id})`);

    try {
      await User.findOneAndUpdate(
        { username },
        { online: true, socketId: socket.id },
        { new: true }
      );
    } catch (err) {
      console.error("❌ Error setting user online:", err);
    }

    // ✅ Send full list of currently online users to the new user
    socket.emit("presence:snapshot", Array.from(usernameToSocketId.keys()));

    // ✅ Notify *everyone* (including the newly connected user)
    io.emit("presence:online", {
      username,
      socketId: socket.id,
    });

    // --- ✍️ TYPING EVENTS ---
    socket.on("typing:start", ({ to }) => {
      const toSid = getSocketIdByUsername(to);
      if (toSid) io.to(toSid).emit("typing:start", { from: username });
    });

    socket.on("typing:stop", ({ to }) => {
      const toSid = getSocketIdByUsername(to);
      if (toSid) io.to(toSid).emit("typing:stop", { from: username });
    });

    // --- 💬 MESSAGE RELAY ---
    socket.on("message:client", ({ sender, receiver, text }) => {
      const receiverSid = getSocketIdByUsername(receiver);
      if (receiverSid) {
        io.to(receiverSid).emit("message:new", {
          sender,
          receiver,
          text,
          createdAt: new Date(),
        });
      }
    });

    // --- 👀 SEEN MESSAGE EVENT ---
    socket.on("messages:seen", ({ from, by }) => {
      const fromSid = getSocketIdByUsername(from);
      if (fromSid) io.to(fromSid).emit("messages:seen", { from, by });
    });

    // --- ❌ DISCONNECT HANDLER ---
    socket.on("disconnect", async () => {
      const uname = socketIdToUsername.get(socket.id);
      if (!uname) return;

      usernameToSocketId.delete(uname);
      socketIdToUsername.delete(socket.id);
      console.log(`❌ ${uname} disconnected`);

      try {
        await User.findOneAndUpdate(
          { username: uname },
          { online: false, socketId: null, lastSeen: new Date() }
        );
      } catch (err) {
        console.error("❌ Error updating offline status:", err);
      }

      // Notify everyone that user went offline
      io.emit("presence:offline", { username: uname });
    });
  });

  console.log("✅ Socket.IO server ready!");
  return io;
}

// --- Utility Functions ---
export function getIO() {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}

export function getSocketIdByUsername(username) {
  return usernameToSocketId.get(username) || null;
}

export function getPresenceSnapshot() {
  const snapshot = {};
  for (const [username, sid] of usernameToSocketId.entries()) {
    snapshot[username] = sid;
  }
  return snapshot;
}
