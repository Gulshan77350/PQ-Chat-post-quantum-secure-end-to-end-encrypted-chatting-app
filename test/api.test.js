import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import crypto from "crypto";
import { startDb, stopDb, resetDb, call, routes, registerAndLogin, login } from "./helpers.js";
import { generateKeyPair, proveKeyPossession, saveSessionPrivateKey, encryptMessage, toB64 } from "../lib/pqcrypto.js";
import Session from "../models/Session.js";

let r;

before(async () => {
  process.env.UPLOAD_DIR = path.join(os.tmpdir(), `pqchat-test-${process.pid}`);
  await startDb();
  r = await routes();
});
after(stopDb);
beforeEach(resetDb);

async function encryptFor(from, to, text) {
  saveSessionPrivateKey(from.username, from.privateKey);
  const env = await encryptMessage(text, {
    receiverPublicKey: to.publicKeyB64,
    senderPublicKey: from.publicKeyB64,
    sender: from.username,
    receiver: to.username,
  });
  return { text: env.ciphertext, iv: env.iv, encryptedKey: env.encryptedKey, senderEncryptedKey: env.senderEncryptedKey, cryptoVersion: env.cryptoVersion };
}

// ── Authentication is enforced everywhere ────────────────────────
test("every protected route rejects unauthenticated and forged requests", async () => {
  const forged = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0."; // alg=none
  const cases = [
    [r.users, "GET"], [r.user, "GET", { username: "alice" }], [r.me, "GET"], [r.sessions, "GET"],
    [r.sessions, "DELETE"], [r.changePassword, "POST"], [r.keysChallenge, "POST"], [r.keys, "PUT"],
    [r.messages, "GET"], [r.messages, "POST"], [r.message, "PATCH", { id: "x" }], [r.message, "DELETE", { id: "x" }],
    [r.recent, "GET"], [r.markSeen, "POST"], [r.clear, "POST"], [r.media, "POST"], [r.mediaItem, "GET", { id: "x" }],
  ];
  for (const [handler, method, query] of cases) {
    for (const token of [undefined, forged, "garbage"]) {
      const res = await call(handler, { method, query, token, body: {} });
      assert.equal(res.status, 401, `${method} ${handler.name} with token=${token}`);
    }
  }
});

test("a valid JWT stops working once its session is revoked (logout)", async () => {
  const alice = await registerAndLogin(r, "alice");
  assert.equal((await call(r.me, { token: alice.token })).status, 200);
  await call(r.logout, { method: "POST", cookies: { pqchat_rt: alice.refreshCookie } });
  assert.equal((await call(r.me, { token: alice.token })).status, 401);
});

// ── Login needs password AND private-key possession ──────────────
test("login fails with a wrong password, a missing proof, or the wrong private key", async () => {
  const alice = await registerAndLogin(r, "alice", "alice-password");
  const attacker = await generateKeyPair();

  const ch1 = await call(r.challenge, { method: "POST", body: { username: "alice" } });
  const proof1 = await proveKeyPossession(ch1.body, alice.privateKey);
  const wrongPw = await call(r.login, { method: "POST", body: { username: "alice", password: "nope-nope", challengeId: ch1.body.challengeId, proof: proof1 } });
  assert.equal(wrongPw.status, 401);

  const noProof = await call(r.login, { method: "POST", body: { username: "alice", password: "alice-password" } });
  assert.equal(noProof.status, 401);

  const ch2 = await call(r.challenge, { method: "POST", body: { username: "alice" } });
  const badProof = await proveKeyPossession(ch2.body, attacker.privateKey);
  const wrongKey = await call(r.login, { method: "POST", body: { username: "alice", password: "alice-password", challengeId: ch2.body.challengeId, proof: badProof } });
  assert.equal(wrongKey.status, 401);
  assert.equal(wrongKey.body.message, "Invalid credentials");
});

test("a login challenge is single-use", async () => {
  const alice = await registerAndLogin(r, "alice", "alice-password");
  const ch = await call(r.challenge, { method: "POST", body: { username: "alice" } });
  const proof = await proveKeyPossession(ch.body, alice.privateKey);
  const body = { username: "alice", password: "alice-password", challengeId: ch.body.challengeId, proof };
  assert.equal((await call(r.login, { method: "POST", body })).status, 200);
  assert.equal((await call(r.login, { method: "POST", body })).status, 401);
});

test("unknown usernames get a decoy challenge indistinguishable from a real one", async () => {
  await registerAndLogin(r, "alice");
  const real = await call(r.challenge, { method: "POST", body: { username: "alice" } });
  const fake = await call(r.challenge, { method: "POST", body: { username: "ghost" } });
  assert.equal(fake.status, real.status);
  assert.deepEqual(Object.keys(fake.body).sort(), Object.keys(real.body).sort());
  assert.equal(fake.body.ciphertext.length, real.body.ciphertext.length);
});

test("per-username login limit blocks distributed guessing from many IPs", async () => {
  await registerAndLogin(r, "alice");
  let last;
  for (let i = 0; i < 11; i++) {
    last = await call(r.login, { method: "POST", ip: `198.51.100.${i}`, body: { username: "alice", password: "wrong-pass" } });
  }
  assert.equal(last.status, 429);
});

// ── Refresh-token rotation & revocation ──────────────────────────
test("refresh rotates the token; replaying an old token revokes the session", async () => {
  const alice = await registerAndLogin(r, "alice");
  const first = await call(r.refresh, { method: "POST", cookies: { pqchat_rt: alice.refreshCookie } });
  assert.equal(first.status, 200);
  const rotated = first.cookies.pqchat_rt;
  assert.ok(rotated && rotated !== alice.refreshCookie);

  // Within the grace window a replay is treated as a multi-tab race (409, no revocation).
  const race = await call(r.refresh, { method: "POST", cookies: { pqchat_rt: alice.refreshCookie } });
  assert.equal(race.status, 409);

  // After the grace window, replaying the old token = theft → whole session revoked.
  await Session.updateOne({ username: "alice" }, { $set: { rotatedAt: new Date(Date.now() - 60000) } });
  const replay = await call(r.refresh, { method: "POST", cookies: { pqchat_rt: alice.refreshCookie } });
  assert.equal(replay.status, 401);
  const afterTheft = await call(r.refresh, { method: "POST", cookies: { pqchat_rt: rotated } });
  assert.equal(afterTheft.status, 401, "the legitimate (rotated) token is revoked too");
  assert.equal((await call(r.me, { token: first.body.accessToken })).status, 401);
});

test("log out other devices keeps the current session only", async () => {
  const alice = await registerAndLogin(r, "alice");
  const laptop = await login(r, "alice", alice.password, alice.privateKey);
  const res = await call(r.sessions, { method: "DELETE", token: alice.token });
  assert.equal(res.body.revoked, 1);
  assert.equal((await call(r.me, { token: alice.token })).status, 200);
  assert.equal((await call(r.me, { token: laptop.token })).status, 401);
});

test("change password requires the current password and revokes other sessions", async () => {
  const alice = await registerAndLogin(r, "alice", "old-password");
  const other = await login(r, "alice", "old-password", alice.privateKey);
  const bad = await call(r.changePassword, { method: "POST", token: alice.token, body: { currentPassword: "wrong-one", newPassword: "new-password" } });
  assert.equal(bad.status, 401);
  const ok = await call(r.changePassword, { method: "POST", token: alice.token, body: { currentPassword: "old-password", newPassword: "new-password" } });
  assert.equal(ok.status, 200);
  assert.equal((await call(r.me, { token: other.token })).status, 401);
  await login(r, "alice", "new-password", alice.privateKey);
});

// ── Key pinning / rotation ───────────────────────────────────────
test("public keys cannot be replaced without password + proof of possession", async () => {
  const alice = await registerAndLogin(r, "alice", "alice-password");
  const bob = await registerAndLogin(r, "bob");
  const newKeys = await generateKeyPair();
  const publicKey = toB64(newKeys.publicKey);

  // Bob (authenticated, but not Alice) has no endpoint to touch Alice's key at all —
  // rotation always applies to the caller. Alice without proof:
  const ch = await call(r.keysChallenge, { method: "POST", token: alice.token, body: { publicKey } });
  const noProof = await call(r.keys, { method: "PUT", token: alice.token, body: { publicKey, challengeId: ch.body.challengeId, proof: "AAAA", currentPassword: "alice-password" } });
  assert.equal(noProof.status, 401);

  // Proof made with a DIFFERENT key than the one being pinned:
  const ch2 = await call(r.keysChallenge, { method: "POST", token: alice.token, body: { publicKey } });
  const wrong = await proveKeyPossession(ch2.body, bob.privateKey);
  assert.equal((await call(r.keys, { method: "PUT", token: alice.token, body: { publicKey, challengeId: ch2.body.challengeId, proof: wrong, currentPassword: "alice-password" } })).status, 401);

  // Correct proof but wrong password:
  const ch3 = await call(r.keysChallenge, { method: "POST", token: alice.token, body: { publicKey } });
  const proof3 = await proveKeyPossession(ch3.body, newKeys.privateKey);
  assert.equal((await call(r.keys, { method: "PUT", token: alice.token, body: { publicKey, challengeId: ch3.body.challengeId, proof: proof3, currentPassword: "nope-nope" } })).status, 401);

  // Everything correct:
  const ch4 = await call(r.keysChallenge, { method: "POST", token: alice.token, body: { publicKey } });
  const proof4 = await proveKeyPossession(ch4.body, newKeys.privateKey);
  const ok = await call(r.keys, { method: "PUT", token: alice.token, body: { publicKey, challengeId: ch4.body.challengeId, proof: proof4, currentPassword: "alice-password" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.keyVersion, 2);

  const seenByBob = await call(r.user, { token: bob.token, query: { username: "alice" } });
  assert.equal(seenByBob.body.publicKey, publicKey);
  assert.equal(seenByBob.body.keyVersion, 2);
});

// ── Messaging ────────────────────────────────────────────────────
test("send → history → delivered/seen status → recent list", async () => {
  const alice = await registerAndLogin(r, "alice");
  const bob = await registerAndLogin(r, "bob");

  const sent = await call(r.messages, { method: "POST", token: alice.token, body: { to: "bob", clientId: "c1", ...(await encryptFor(alice, bob, "hi bob")) } });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.sender, "alice");
  assert.equal(sent.body.status, "sent");
  assert.equal(sent.body.clientId, "c1");

  const recent = await call(r.recent, { token: bob.token });
  assert.deepEqual(recent.body.map((x) => [x.username, x.unseen]), [["alice", 1]]);

  await call(r.markSeen, { method: "POST", token: bob.token, body: { with: "alice" } });
  const hist = await call(r.messages, { token: alice.token, query: { with: "bob" } });
  assert.equal(hist.body.messages[0].status, "seen");
  assert.ok(hist.body.messages[0].deliveredAt, "seen implies delivered");
  assert.equal((await call(r.recent, { token: bob.token })).body[0].unseen, 0);
});

test("the sender identity comes from the token, never the request body", async () => {
  const alice = await registerAndLogin(r, "alice");
  const bob = await registerAndLogin(r, "bob");
  await registerAndLogin(r, "carol");
  const res = await call(r.messages, {
    method: "POST",
    token: alice.token,
    body: { to: "bob", senderUsername: "carol", sender: "carol", ...(await encryptFor(alice, bob, "x")) },
  });
  assert.equal(res.body.sender, "alice");
});

test("legacy (v1) or missing cryptoVersion writes are rejected", async () => {
  const alice = await registerAndLogin(r, "alice");
  const bob = await registerAndLogin(r, "bob");
  const env = await encryptFor(alice, bob, "x");
  const res = await call(r.messages, { method: "POST", token: alice.token, body: { to: "bob", ...env, cryptoVersion: 1 } });
  assert.equal(res.status, 400);
});

test("cursor pagination returns every message exactly once", async () => {
  const alice = await registerAndLogin(r, "alice");
  const bob = await registerAndLogin(r, "bob");
  const env = await encryptFor(alice, bob, "x");
  for (let i = 0; i < 7; i++) await call(r.messages, { method: "POST", token: alice.token, body: { to: "bob", ...env } });

  const seen = new Set();
  let before = null;
  do {
    const page = await call(r.messages, { token: bob.token, query: { with: "alice", limit: "3", ...(before ? { before } : {}) } });
    page.body.messages.forEach((m) => seen.add(m.id));
    before = page.body.nextCursor;
  } while (before);
  assert.equal(seen.size, 7);
});

test("only the sender can edit/delete; delete wipes ciphertext and leaves a tombstone", async () => {
  const alice = await registerAndLogin(r, "alice");
  const bob = await registerAndLogin(r, "bob");
  const sent = await call(r.messages, { method: "POST", token: alice.token, body: { to: "bob", ...(await encryptFor(alice, bob, "v1")) } });
  const id = sent.body.id;

  const edit = { ...(await encryptFor(alice, bob, "v2")) };
  assert.equal((await call(r.message, { method: "PATCH", token: bob.token, query: { id }, body: edit })).status, 404);
  const edited = await call(r.message, { method: "PATCH", token: alice.token, query: { id }, body: edit });
  assert.equal(edited.status, 200);
  assert.ok(edited.body.editedAt);
  assert.equal(edited.body.text, edit.text);

  assert.equal((await call(r.message, { method: "DELETE", token: bob.token, query: { id } })).status, 404);
  const del = await call(r.message, { method: "DELETE", token: alice.token, query: { id } });
  assert.equal(del.status, 200);
  const hist = await call(r.messages, { token: bob.token, query: { with: "alice" } });
  assert.equal(hist.body.messages[0].text, null);
  assert.ok(hist.body.messages[0].deletedAt);
});

test("clear chat only affects the caller's own conversation", async () => {
  const alice = await registerAndLogin(r, "alice");
  const bob = await registerAndLogin(r, "bob");
  const carol = await registerAndLogin(r, "carol");
  await call(r.messages, { method: "POST", token: alice.token, body: { to: "bob", ...(await encryptFor(alice, bob, "x")) } });
  await call(r.messages, { method: "POST", token: bob.token, body: { to: "carol", ...(await encryptFor(bob, carol, "y")) } });

  const res = await call(r.clear, { method: "POST", token: alice.token, body: { with: "bob" } });
  assert.equal(res.body.deletedCount, 1);
  const bobCarol = await call(r.messages, { token: carol.token, query: { with: "bob" } });
  assert.equal(bobCarol.body.messages.length, 1);
});

test("user search escapes regex input", async () => {
  const alice = await registerAndLogin(r, "alice");
  const res = await call(r.users, { token: alice.token, query: { q: "(a+)+$" } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
  const hit = await call(r.users, { token: alice.token, query: { q: "ali" } });
  assert.deepEqual(hit.body.map((u) => u.username), ["alice"]);
});

// ── Media via object storage (local backend) ─────────────────────
test("media: upload, attach, and only participants can download", async () => {
  const alice = await registerAndLogin(r, "alice");
  const bob = await registerAndLogin(r, "bob");
  const carol = await registerAndLogin(r, "carol");
  const blob = crypto.randomBytes(2048);

  const slot = await call(r.media, { method: "POST", token: alice.token, body: { size: blob.length } });
  assert.equal(slot.status, 201);
  const mediaId = slot.body.mediaId;

  // Bob can't upload into Alice's slot; Alice can't exceed the declared size.
  assert.equal((await call(r.mediaItem, { method: "PUT", token: bob.token, query: { id: mediaId }, raw: blob })).status, 404);
  assert.equal((await call(r.mediaItem, { method: "PUT", token: alice.token, query: { id: mediaId }, raw: Buffer.concat([blob, blob]) })).status, 400);
  assert.equal((await call(r.mediaItem, { method: "PUT", token: alice.token, query: { id: mediaId }, raw: blob })).status, 204);

  const media = { id: mediaId, iv: "aXY=", encryptedKey: "{}", senderEncryptedKey: "{}" };
  const sent = await call(r.messages, { method: "POST", token: alice.token, body: { to: "bob", cryptoVersion: 2, media } });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.media.size, blob.length);

  // The same blob cannot be attached twice.
  assert.equal((await call(r.messages, { method: "POST", token: alice.token, body: { to: "carol", cryptoVersion: 2, media } })).status, 400);

  assert.equal((await call(r.mediaItem, { token: carol.token, query: { id: mediaId } })).status, 404);
});
