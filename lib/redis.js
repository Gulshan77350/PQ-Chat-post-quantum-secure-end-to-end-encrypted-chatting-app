import Redis from "ioredis";

// Redis is optional: without REDIS_URL the app runs as a single instance with in-memory
// rate limiting and presence. With it, rate limits, presence and Socket.IO fan-out are
// shared across every Node process.
export function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!globalThis._redisClient) {
    globalThis._redisClient = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
    globalThis._redisClient.on("error", (err) => console.error("Redis error:", err.message));
  }
  return globalThis._redisClient;
}
