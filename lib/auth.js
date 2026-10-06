// lib/auth.js — access tokens, refresh-token sessions and request authentication.
import crypto from "crypto";
import jwt from "jsonwebtoken";
import Session from "../models/Session.js";
import { getClientIp } from "./rateLimit.js";
import { disconnectSessionSockets } from "./realtime.js";

export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Two tabs can race to refresh with the same cookie. A just-rotated token presented
// inside this window is treated as a benign race, not as theft.
export const ROTATION_GRACE_MS = 15 * 1000;
export const REFRESH_COOKIE = "pqchat_rt";

const JWT_OPTS = { issuer: "pqchat", audience: "pqchat-api" };

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not configured");
  return s;
}

export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ── Access tokens ────────────────────────────────────────────────
export function signAccessToken({ userId, username, sid }) {
  return jwt.sign({ username, sid }, secret(), {
    ...JWT_OPTS,
    subject: String(userId),
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    algorithm: "HS256",
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, secret(), { ...JWT_OPTS, algorithms: ["HS256"] });
}

/**
 * Verifies a JWT AND that its session is still live, so logout / "log out other devices"
 * / password change take effect immediately instead of after the token's 15-min expiry.
 * @returns {Promise<{id: string, username: string, sid: string, exp: number} | null>}
 */
export async function authenticateToken(token) {
  if (!token || typeof token !== "string") return null;
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return null;
  }
  const live = await Session.exists({ _id: payload.sid, revokedAt: null, expiresAt: { $gt: new Date() } });
  if (!live) return null;
  return { id: payload.sub, username: payload.username, sid: payload.sid, exp: payload.exp };
}

export function bearerToken(req) {
  const header = req.headers?.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

// ── Refresh-token cookie ─────────────────────────────────────────
function setRefreshCookie(res, token, maxAgeMs) {
  const parts = [
    `${REFRESH_COOKIE}=${token}`,
    "Path=/api/auth",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearRefreshCookie(res) {
  setRefreshCookie(res, "", 0);
}

const newRefreshToken = () => crypto.randomBytes(32).toString("base64url");

// ── Sessions ─────────────────────────────────────────────────────
export async function createSession(user, req, res) {
  const refreshToken = newRefreshToken();
  const session = await Session.create({
    userId: user._id,
    username: user.username,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    userAgent: String(req.headers?.["user-agent"] || "").slice(0, 200),
    ip: getClientIp(req),
  });
  setRefreshCookie(res, refreshToken, REFRESH_TOKEN_TTL_MS);
  return {
    sid: String(session._id),
    accessToken: signAccessToken({ userId: user._id, username: user.username, sid: session._id }),
  };
}

/**
 * Rotates the refresh token presented in the cookie.
 *   current token          → issue a new pair, remember the old hash
 *   just-rotated token     → 409 (benign multi-tab race; client retries with the new cookie)
 *   older rotated token    → token reuse ⇒ assume theft, revoke the session
 *   unknown/expired token  → 401
 */
export async function rotateSession(req, res) {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (!presented) throw new HttpError(401, "No refresh token");
  const hash = sha256(presented);
  const now = new Date();

  const session = await Session.findOne({ tokenHash: hash });
  if (!session) {
    const rotatedFrom = await Session.findOne({ prevTokenHash: hash });
    if (rotatedFrom && !rotatedFrom.revokedAt) {
      if (now - rotatedFrom.rotatedAt < ROTATION_GRACE_MS) {
        throw new HttpError(409, "Refresh token was just rotated; retry");
      }
      await revokeSessions({ _id: rotatedFrom._id }, "refresh-token-reuse");
      console.warn(`⚠️ Refresh token reuse detected for ${rotatedFrom.username}; session revoked.`);
    }
    clearRefreshCookie(res);
    throw new HttpError(401, "Invalid refresh token");
  }
  if (session.revokedAt || session.expiresAt <= now) {
    clearRefreshCookie(res);
    throw new HttpError(401, "Session expired");
  }

  const next = newRefreshToken();
  // Conditional update: if two requests rotate concurrently only one wins.
  const updated = await Session.findOneAndUpdate(
    { _id: session._id, tokenHash: hash },
    { $set: { tokenHash: sha256(next), prevTokenHash: hash, rotatedAt: now, lastUsedAt: now } },
    { new: true }
  );
  if (!updated) throw new HttpError(409, "Refresh token was just rotated; retry");

  setRefreshCookie(res, next, session.expiresAt - now);
  return {
    accessToken: signAccessToken({ userId: session.userId, username: session.username, sid: session._id }),
    username: session.username,
  };
}

export async function revokeSessions(filter, reason) {
  const sessions = await Session.find({ ...filter, revokedAt: null }).select("_id").lean();
  if (!sessions.length) return 0;
  await Session.updateMany(
    { _id: { $in: sessions.map((s) => s._id) } },
    { $set: { revokedAt: new Date(), revokeReason: reason } }
  );
  // Kick live sockets bound to those sessions (works cluster-wide via the Redis adapter).
  for (const s of sessions) disconnectSessionSockets(String(s._id));
  return sessions.length;
}

export async function revokeSessionByCookie(req) {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (!presented) return 0;
  return revokeSessions({ tokenHash: sha256(presented) }, "logout");
}
