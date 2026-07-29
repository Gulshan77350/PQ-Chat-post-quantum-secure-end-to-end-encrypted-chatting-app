// lib/rateLimit.js - Lightweight Sliding Window Rate Limiter

const tracker = new Map();

/**
 * Apply rate limiting to Next.js API requests.
 * @param {import('next').NextApiRequest} req 
 * @param {import('next').NextApiResponse} res 
 * @param {object} options 
 * @param {number} options.limit - Max requests in window
 * @param {number} options.windowMs - Time window in milliseconds (default 1 min)
 * @returns {boolean} - Returns true if allowed, false if rate limited (429 response sent)
 */
export function applyRateLimit(req, res, { limit = 60, windowMs = 60000 } = {}) {
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "127.0.0.1";
  const route = req.url || "api";
  const key = `${ip}:${route}`;
  const now = Date.now();

  if (!tracker.has(key)) {
    tracker.set(key, []);
  }

  const timestamps = tracker.get(key).filter((ts) => now - ts < windowMs);
  timestamps.push(now);
  tracker.set(key, timestamps);

  res.setHeader("X-RateLimit-Limit", limit);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, limit - timestamps.length));

  if (timestamps.length > limit) {
    res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
    res.status(429).json({
      message: "Too many requests. Please slow down and try again.",
    });
    return false;
  }

  return true;
}
