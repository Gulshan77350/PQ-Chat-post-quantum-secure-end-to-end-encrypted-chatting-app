// End-to-end smoke test against a RUNNING server: two users register, log in with
// key-possession proofs, connect authenticated sockets, exchange an encrypted message
// and media, and observe delivered/seen receipts, edits, deletes and presence.
//
//   BASE_URL=http://localhost:3000 node scripts/smoke.mjs
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import {
  generateKeyPair, proveKeyPossession, saveSessionPrivateKey, encryptMessage, decryptMessage,
  encryptMedia, decryptMedia, toB64,
} from "../lib/pqcrypto.js";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const suffix = Math.random().toString(36).slice(2, 7);

async function http(path, { method = "GET", body, token, cookie, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(raw ? { "Content-Type": "application/octet-stream" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const setCookie = res.headers.get("set-cookie");
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, data, cookie: setCookie?.split(";")[0] };
}

async function makeUser(name) {
  const username = `${name}_${suffix}`;
  const password = "smoke-test-password";
  const keys = await generateKeyPair();
  const reg = await http("/api/auth/register", { method: "POST", body: { username, password, publicKey: toB64(keys.publicKey), kem: keys.kem } });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const ch = await http("/api/auth/challenge", { method: "POST", body: { username } });
  const proof = await proveKeyPossession(ch.data, keys.privateKey);
  const login = await http("/api/auth/login", { method: "POST", body: { username, password, challengeId: ch.data.challengeId, proof } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  saveSessionPrivateKey(username, keys.privateKey);
  return { username, keys, pub: toB64(keys.publicKey), token: login.data.accessToken, cookie: login.cookie };
}

function connect(user) {
  const events = [];
  const socket = io(BASE, { transports: ["websocket"], auth: { token: user.token }, reconnection: false });
  socket.onAny((ev, payload) => events.push([ev, payload]));
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve({ socket, events }));
    socket.on("connect_error", reject);
  });
}

const waitFor = async (events, ev, pred = () => true, ms = 5000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const hit = events.find(([e, p]) => e === ev && pred(p));
    if (hit) return hit[1];
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${ev}`);
};

const step = (name) => console.log(`✔ ${name}`);

// 1. unauthenticated access is refused
assert.equal((await http("/api/users")).status, 401);
await assert.rejects(new Promise((resolve, reject) => {
  const s = io(BASE, { transports: ["websocket"], auth: { username: "spoof" }, reconnection: false });
  s.on("connect", () => { s.close(); resolve(); });
  s.on("connect_error", (e) => { s.close(); reject(e); });
}));
step("REST and Socket.IO reject unauthenticated clients");

const alice = await makeUser("alice");
const bob = await makeUser("bob");
step("register + login with ML-KEM proof of possession");

const A = await connect(alice);
const B = await connect(bob);
await waitFor(A.events, "presence:online", (p) => p.username === bob.username);
step("authenticated sockets + presence");

// 2. encrypted text: send → delivered (socket ack) → seen
const env = await encryptMessage("hello from the post-quantum future", { receiverPublicKey: bob.pub, senderPublicKey: alice.pub, sender: alice.username, receiver: bob.username });
const sent = await http("/api/messages", {
  method: "POST", token: alice.token,
  body: { to: bob.username, clientId: "smoke-1", cryptoVersion: env.cryptoVersion, text: env.ciphertext, iv: env.iv, encryptedKey: env.encryptedKey, senderEncryptedKey: env.senderEncryptedKey },
});
assert.equal(sent.status, 201);
const incoming = await waitFor(B.events, "message:new", (p) => p.id === sent.data.id);
const plain = await decryptMessage(incoming, bob.username, false);
assert.equal(plain.text, "hello from the post-quantum future");
step("message delivered over socket and decrypted by receiver");

B.socket.emit("messages:delivered", { ids: [incoming.id] });
await waitFor(A.events, "messages:delivered", (p) => p.ids.includes(sent.data.id));
await http("/api/messages/mark-seen", { method: "POST", token: bob.token, body: { with: alice.username } });
await waitFor(A.events, "messages:seen", (p) => p.ids.includes(sent.data.id));
step("sent → delivered → seen receipts reach the sender");

// 3. typing indicator relayed only with the server-verified identity
B.socket.emit("typing:start", { to: alice.username, from: "someone-else" });
const typing = await waitFor(A.events, "typing:start");
assert.equal(typing.from, bob.username);
step("typing events carry the authenticated sender, not the claimed one");

// 4. edit + delete
const env2 = await encryptMessage("edited text", { receiverPublicKey: bob.pub, senderPublicKey: alice.pub, sender: alice.username, receiver: bob.username });
const edit = await http(`/api/messages/${sent.data.id}`, { method: "PATCH", token: alice.token, body: { cryptoVersion: 2, text: env2.ciphertext, iv: env2.iv, encryptedKey: env2.encryptedKey, senderEncryptedKey: env2.senderEncryptedKey } });
assert.equal(edit.status, 200);
const updated = await waitFor(B.events, "message:updated", (p) => p.id === sent.data.id && p.editedAt);
assert.equal((await decryptMessage(updated, bob.username, false)).text, "edited text");
await http(`/api/messages/${sent.data.id}`, { method: "DELETE", token: alice.token });
await waitFor(B.events, "message:updated", (p) => p.id === sent.data.id && p.deletedAt);
step("edit and delete-for-everyone propagate in real time");

// 5. media through object storage
const file = new TextEncoder().encode("%PDF-1.7 pretend this is a document");
const menv = await encryptMedia(file, { name: "report.pdf", mimeType: "application/pdf" }, { receiverPublicKey: bob.pub, senderPublicKey: alice.pub, sender: alice.username, receiver: bob.username });
const slot = await http("/api/media", { method: "POST", token: alice.token, body: { size: menv.ciphertext.byteLength } });
assert.equal(slot.status, 201);
const up = await http(slot.data.upload.url, { method: "PUT", token: alice.token, raw: menv.ciphertext });
assert.equal(up.status, 204);
const msent = await http("/api/messages", { method: "POST", token: alice.token, body: { to: bob.username, cryptoVersion: 2, media: { id: slot.data.mediaId, iv: menv.iv, encryptedKey: menv.encryptedKey, senderEncryptedKey: menv.senderEncryptedKey } } });
assert.equal(msent.status, 201);
const blob = await http(`/api/media/${slot.data.mediaId}`, { token: bob.token });
assert.equal(blob.status, 200);
const out = await decryptMedia(blob.data, { ...msent.data.media, cryptoVersion: 2, sender: alice.username, receiver: bob.username }, bob.username, false);
assert.equal(out.name, "report.pdf");
assert.equal(new TextDecoder().decode(out.data), "%PDF-1.7 pretend this is a document");
step("encrypted media upload → object storage → authorized download → decrypt");

// 6. logout revokes the session and kicks the live socket
const disconnected = new Promise((r) => B.socket.on("disconnect", r));
await http("/api/auth/logout", { method: "POST", cookie: bob.cookie });
await disconnected;
assert.equal((await http("/api/auth/me", { token: bob.token })).status, 401);
await waitFor(A.events, "presence:offline", (p) => p.username === bob.username);
step("logout revokes the JWT, disconnects the socket, and updates presence");

A.socket.close();
console.log("\nAll smoke checks passed.");
process.exit(0);
