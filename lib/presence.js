// lib/presence.js — who is online, tracked per socket so multiple tabs/devices work.
//
// Redis layout (shared by every app instance):
//   presence:user:<username>  ZSET  member = socketId, score = expiry (ms)
//   presence:users            ZSET  member = username, score = latest expiry (ms)
// Each instance refreshes the expiry of its own sockets every HEARTBEAT_MS, so sockets of
// a crashed instance age out after ENTRY_TTL_MS instead of staying "online" forever.
import { getRedis } from "./redis.js";

export const HEARTBEAT_MS = 20 * 1000;
export const ENTRY_TTL_MS = 60 * 1000;

// ── In-memory implementation (single instance) ───────────────────
export function memoryStore() {
  const sockets = new Map(); // username -> Set<socketId>
  return {
    async add(username, socketId) {
      const set = sockets.get(username) || new Set();
      const wasOffline = set.size === 0;
      set.add(socketId);
      sockets.set(username, set);
      return wasOffline;
    },
    async remove(username, socketId) {
      const set = sockets.get(username);
      if (!set) return false;
      set.delete(socketId);
      if (set.size === 0) {
        sockets.delete(username);
        return true;
      }
      return false;
    },
    async refresh() {},
    async isOnline(username) {
      return sockets.has(username);
    },
    async onlineUsers() {
      return [...sockets.keys()];
    },
  };
}

// ── Redis implementation (multi instance) ────────────────────────
export function redisStore(redis) {
  const userKey = (u) => `presence:user:${u}`;
  return {
    async add(username, socketId) {
      const now = Date.now();
      const exp = now + ENTRY_TTL_MS;
      const res = await redis
        .multi()
        .zremrangebyscore(userKey(username), 0, now)
        .zcard(userKey(username))
        .zadd(userKey(username), exp, socketId)
        .pexpire(userKey(username), ENTRY_TTL_MS)
        .zadd("presence:users", exp, username)
        .exec();
      return res[1][1] === 0;
    },
    async remove(username, socketId) {
      const now = Date.now();
      const res = await redis
        .multi()
        .zrem(userKey(username), socketId)
        .zremrangebyscore(userKey(username), 0, now)
        .zcard(userKey(username))
        .exec();
      if (res[2][1] === 0) {
        await redis.zrem("presence:users", username);
        return true;
      }
      return false;
    },
    /** @param {Array<[string, string]>} entries [username, socketId] owned by this instance */
    async refresh(entries) {
      if (!entries.length) return;
      const exp = Date.now() + ENTRY_TTL_MS;
      const pipe = redis.pipeline();
      for (const [username, socketId] of entries) {
        pipe.zadd(userKey(username), exp, socketId);
        pipe.pexpire(userKey(username), ENTRY_TTL_MS);
        pipe.zadd("presence:users", exp, username);
      }
      pipe.zremrangebyscore("presence:users", 0, Date.now());
      await pipe.exec();
    },
    async isOnline(username) {
      const score = await redis.zscore("presence:users", username);
      return !!score && Number(score) > Date.now();
    },
    async onlineUsers() {
      return redis.zrangebyscore("presence:users", Date.now(), "+inf");
    },
  };
}

export function getPresence() {
  if (!globalThis._presenceStore) {
    const redis = getRedis();
    globalThis._presenceStore = redis ? redisStore(redis) : memoryStore();
  }
  return globalThis._presenceStore;
}
