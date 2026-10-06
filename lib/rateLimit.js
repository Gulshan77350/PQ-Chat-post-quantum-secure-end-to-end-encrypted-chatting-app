// lib/rateLimit.js — sliding-window rate limiter with a Redis or in-memory backend.
import crypto from "crypto";
import { getRedis } from "./redis.js";

/**
 * Resolves the client IP without trusting spoofable headers by default.
 *
 * TRUST_PROXY = number of reverse proxies in front of the app (e.g. 1 behind nginx).
 * Each proxy APPENDS the address it saw to X-Forwarded-For, so the real client is the
 * entry `hops` positions from the right. Anything further left is client-controlled.
 * With TRUST_PROXY unset/0 the header is ignored and the socket address is used.
 */
export function getClientIp(req, trustProxy = process.env.TRUST_PROXY) {
  const remote = req.socket?.remoteAddress || "unknown";
  const hops = parseInt(trustProxy, 10);
  if (!hops || hops < 1) return remote;

  const header = req.headers?.["x-forwarded-for"];
  if (!header) return remote;
  const chain = String(header).split(",").map((s) => s.trim()).filter(Boolean);
  // The socket peer is the last proxy, so the client is chain[length - hops].
  return chain[chain.length - hops] || chain[0] || remote;
}

// ── In-memory backend (single instance only) ─────────────────────
const memory = globalThis._rateLimitMemory || (globalThis._rateLimitMemory = new Map());
let lastSweep = 0;

function hitMemory(key, windowMs, now) {
  // Periodically drop idle keys so the map cannot grow without bound.
  if (now - lastSweep > 60000) {
    lastSweep = now;
    for (const [k, v] of memory) if (!v.length || now - v[v.length - 1] > v.windowMs) memory.delete(k);
  }
  const prev = memory.get(key) || [];
  const timestamps = prev.filter((ts) => now - ts < windowMs);
  timestamps.push(now);
  timestamps.windowMs = windowMs;
  memory.set(key, timestamps);
  return timestamps.length;
}

// ── Redis backend: sorted-set sliding log, atomic via MULTI ─────
export async function hitRedis(redis, key, windowMs, now) {
  const member = `${now}-${crypto.randomBytes(4).toString("hex")}`;
  const results = await redis
    .multi()
    .zremrangebyscore(key, 0, now - windowMs)
    .zadd(key, now, member)
    .zcard(key)
    .pexpire(key, windowMs)
    .exec();
  return results[2][1];
}

export async function hit(key, windowMs, now = Date.now()) {
  const redis = getRedis();
  if (redis) {
    try {
      return await hitRedis(redis, `rl:${key}`, windowMs, now);
    } catch (err) {
      console.error("Rate limiter Redis failure, falling back to memory:", err.message);
    }
  }
  return hitMemory(key, windowMs, now);
}

/**
 * @param {object} options
 * @param {number} options.limit     max requests per window
 * @param {number} options.windowMs  window length
 * @param {string} options.name      bucket name (defaults to the route path)
 * @param {string} [options.key]     custom identity (e.g. a username); defaults to client IP
 * @returns {Promise<boolean>} false when limited (a 429 has already been sent)
 */
export async function applyRateLimit(req, res, { limit = 60, windowMs = 60000, name, key } = {}) {
  const bucket = name || (req.url || "api").split("?")[0];
  const identity = key || getClientIp(req);
  const count = await hit(`${bucket}:${identity}`, windowMs);

  res.setHeader("X-RateLimit-Limit", limit);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, limit - count));
  if (count > limit) {
    res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
    res.status(429).json({ message: "Too many requests. Please slow down and try again." });
    return false;
  }
  return true;
}
