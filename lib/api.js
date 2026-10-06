// lib/api.js — the shared middleware layer every API route goes through:
// method dispatch → rate limit → DB connect → authentication → handler → error mapping.
import db from "./db.js";
import { applyRateLimit } from "./rateLimit.js";
import { authenticateToken, bearerToken, HttpError } from "./auth.js";

export { HttpError };

/**
 * Verifies the bearer token and attaches `req.user = { id, username, sid }`.
 * @returns {Promise<boolean>} false when a 401 has been sent
 */
export async function requireAuth(req, res) {
  const user = await authenticateToken(bearerToken(req));
  if (!user) {
    res.status(401).json({ message: "Authentication required" });
    return false;
  }
  req.user = user;
  return true;
}

/**
 * @param {Record<string, Function | {handler: Function, auth?: boolean, rateLimit?: object}>} methods
 * @param {{auth?: boolean, rateLimit?: object}} defaults  auth defaults to TRUE (secure by default)
 */
export function apiRoute(methods, defaults = {}) {
  return async function handler(req, res) {
    const entry = methods[req.method];
    if (!entry) {
      res.setHeader("Allow", Object.keys(methods));
      return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }
    const { handler: fn, ...overrides } = typeof entry === "function" ? { handler: entry } : entry;
    const opts = { auth: true, ...defaults, ...overrides };

    try {
      if (opts.rateLimit && !(await applyRateLimit(req, res, opts.rateLimit))) return;
      await db();
      if (opts.auth && !(await requireAuth(req, res))) return;
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ message: err.message });
      }
      if (err?.name === "CastError" || err?.name === "ValidationError") {
        return res.status(400).json({ message: "Invalid request" });
      }
      console.error(`${req.method} ${req.url} failed:`, err);
      if (!res.headersSent) res.status(500).json({ message: "Server error" });
    }
  };
}

// ── Input validation helpers ─────────────────────────────────────
export const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export function requireString(value, name, { max = 100000, optional = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (optional) return null;
    throw new HttpError(400, `${name} is required`);
  }
  if (typeof value !== "string" || value.length > max) throw new HttpError(400, `${name} is invalid`);
  return value;
}

export function requireUsername(value, name = "username") {
  const v = requireString(value, name, { max: 32 }).trim();
  if (!USERNAME_RE.test(v)) throw new HttpError(400, `${name} is invalid`);
  return v;
}

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
