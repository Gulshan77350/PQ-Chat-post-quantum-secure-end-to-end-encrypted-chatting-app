// lib/realtime.js — lightweight emit helpers for API routes.
// Kept separate from lib/socket.js so API route bundles don't pull in the server setup.
// The Socket.IO instance is shared through globalThis because Next bundles API routes
// separately from server.js. With the Redis adapter, room emits reach every instance.

export function getIO() {
  return globalThis._io || null;
}

/** Room naming: every socket joins `user:<username>` and `session:<sid>`. */
export const userRoom = (username) => `user:${username}`;
export const sessionRoom = (sid) => `session:${sid}`;

export function emitToUsers(usernames, event, payload) {
  const io = getIO();
  if (!io) return;
  const rooms = [...new Set(usernames.filter(Boolean))].map(userRoom);
  if (rooms.length) io.to(rooms).emit(event, payload);
}

export function broadcast(event, payload) {
  getIO()?.emit(event, payload);
}

export function disconnectSessionSockets(sid) {
  getIO()?.in(sessionRoom(sid)).disconnectSockets(true);
}
