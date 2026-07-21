import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

export default function useSocket(username) {
  const socketRef = useRef(null);

  // Event callback refs
  const onUsersChangedRef = useRef(null);
  const onMessageNewRef = useRef(null);
  const onPresenceChangeRef = useRef(null);
  const onTypingStartRef = useRef(null);
  const onTypingStopRef = useRef(null);
  const onMessagesSeenRef = useRef(null);
  const onMessagesClearedRef = useRef(null);
  const onConnectedRef = useRef(null);

  useEffect(() => {
    if (!username) return;

    // Initialize socket once per user session
    if (!socketRef.current) {
      const socket = io({
        auth: { username },
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        timeout: 15000,
      });

      socketRef.current = socket;

      // ✅ Connection established
      socket.on("connect", () => {
        console.log(`✅ Connected as ${username} (${socket.id})`);
        // Ensure server knows this user is online
        socket.emit("presence:online", { username });
        onConnectedRef.current?.();
      });

      // ⚠️ Handle disconnect
      socket.on("disconnect", (reason) => {
        console.warn(`⚠️ Disconnected: ${reason}`);
      });

      // 🔁 When user list changes
      socket.on("users:changed", () => {
        onUsersChangedRef.current?.();
      });

      // 💬 New message event
      socket.on("message:new", (payload) => {
        onMessageNewRef.current?.(payload);
      });

      // 👥 Presence updates (real-time)
      socket.on("presence:online", (p) => {
        onPresenceChangeRef.current?.({ ...p, status: "online" });
      });
      socket.on("presence:offline", (p) => {
        onPresenceChangeRef.current?.({ ...p, status: "offline" });
      });

      // 🧠 Initial presence snapshot (fix: load all users already online)
      socket.on("presence:snapshot", (onlineUsers) => {
        if (Array.isArray(onlineUsers)) {
          onlineUsers.forEach((u) => {
            onPresenceChangeRef.current?.({
              username: u,
              status: "online",
            });
          });
        }
      });

      // ✍️ Typing indicators
      socket.on("typing:start", (data) => {
        onTypingStartRef.current?.(data);
      });
      socket.on("typing:stop", (data) => {
        onTypingStopRef.current?.(data);
      });

      // 👀 Seen message updates
      socket.on("messages:seen", (data) => {
        onMessagesSeenRef.current?.(data);
      });

      // 🗑️ Clear message updates
      socket.on("messages:cleared", (data) => {
        onMessagesClearedRef.current?.(data);
      });
    }

    // Initialize Socket.IO API route (for Next.js)
    fetch("/api/socket").catch(() => {});

    // 🧹 Cleanup on unmount or username change
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [username]);

  // Subscription registration
  const onUsersChanged = (cb) => { onUsersChangedRef.current = cb; };
  const onMessageNew = (cb) => { onMessageNewRef.current = cb; };
  const onPresenceChange = (cb) => { onPresenceChangeRef.current = cb; };
  const onTypingStart = (cb) => { onTypingStartRef.current = cb; };
  const onTypingStop = (cb) => { onTypingStopRef.current = cb; };
  const onMessagesSeen = (cb) => { onMessagesSeenRef.current = cb; };
  const onMessagesCleared = (cb) => { onMessagesClearedRef.current = cb; };
  const onConnected = (cb) => { onConnectedRef.current = cb; };

  return {
    socket: socketRef.current,
    onUsersChanged,
    onMessageNew,
    onPresenceChange,
    onTypingStart,
    onTypingStop,
    onMessagesSeen,
    onMessagesCleared,
    onConnected,
  };
}
