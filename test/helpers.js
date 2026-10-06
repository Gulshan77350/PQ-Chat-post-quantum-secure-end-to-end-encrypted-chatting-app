// Test harness: invoke Next.js API route handlers directly with mock req/res objects
// against an in-memory MongoDB (mongodb-memory-server).
import { Readable } from "stream";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { generateKeyPair, proveKeyPossession, toB64 } from "../lib/pqcrypto.js";

let mongod;

export async function startDb() {
  process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-hs256-usage";
  process.env.BCRYPT_ROUNDS = "4";
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  await mongoose.connect(process.env.MONGO_URI);
}

export async function stopDb() {
  await mongoose.disconnect();
  await mongod?.stop();
}

export async function resetDb() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  globalThis._rateLimitMemory?.clear();
}

let ipCounter = 0;

/** Calls a route handler; returns { status, body, headers, cookies }. */
export async function call(handler, { method = "GET", body, query = {}, token, cookies = {}, ip, headers = {}, raw } = {}) {
  const req = raw ? Readable.from([raw]) : {};
  Object.assign(req, {
    method,
    url: "/test",
    body,
    query,
    cookies,
    headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    socket: { remoteAddress: ip || `10.0.0.${++ipCounter % 250}` },
  });

  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      headersSent: false,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.headersSent = true; finish(payload); return this; },
      end(payload) { this.headersSent = true; finish(payload); return this; },
    };
    const finish = (payload) => {
      const cookieHeader = res.headers["set-cookie"];
      const setCookies = {};
      if (cookieHeader) {
        const [pair] = String(cookieHeader).split(";");
        const [k, v] = pair.split("=");
        setCookies[k] = v;
      }
      resolve({ status: res.statusCode, body: payload, headers: res.headers, cookies: setCookies });
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

// Lazily import route handlers (after env vars are set).
export const routes = async () => ({
  register: (await import("../pages/api/auth/register.js")).default,
  challenge: (await import("../pages/api/auth/challenge.js")).default,
  login: (await import("../pages/api/auth/login.js")).default,
  refresh: (await import("../pages/api/auth/refresh.js")).default,
  logout: (await import("../pages/api/auth/logout.js")).default,
  sessions: (await import("../pages/api/auth/sessions.js")).default,
  me: (await import("../pages/api/auth/me.js")).default,
  changePassword: (await import("../pages/api/auth/change-password.js")).default,
  users: (await import("../pages/api/users/index.js")).default,
  user: (await import("../pages/api/users/[username].js")).default,
  keysChallenge: (await import("../pages/api/keys/challenge.js")).default,
  keys: (await import("../pages/api/keys/index.js")).default,
  messages: (await import("../pages/api/messages/index.js")).default,
  message: (await import("../pages/api/messages/[id].js")).default,
  recent: (await import("../pages/api/messages/recent.js")).default,
  markSeen: (await import("../pages/api/messages/mark-seen.js")).default,
  clear: (await import("../pages/api/messages/clear.js")).default,
  media: (await import("../pages/api/media/index.js")).default,
  mediaItem: (await import("../pages/api/media/[id].js")).default,
});

/** Registers a user with a fresh ML-KEM keypair and logs in. */
export async function registerAndLogin(r, username, password = "correct horse battery") {
  const keys = await generateKeyPair();
  const reg = await call(r.register, {
    method: "POST",
    body: { username, password, publicKey: toB64(keys.publicKey), kem: keys.kem },
  });
  if (reg.status !== 201) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
  const session = await login(r, username, password, keys.privateKey);
  return { username, password, ...keys, publicKeyB64: toB64(keys.publicKey), ...session };
}

export async function login(r, username, password, privateKey) {
  const ch = await call(r.challenge, { method: "POST", body: { username } });
  const proof = await proveKeyPossession(ch.body, privateKey);
  const res = await call(r.login, { method: "POST", body: { username, password, challengeId: ch.body.challengeId, proof } });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, refreshCookie: res.cookies.pqchat_rt };
}
