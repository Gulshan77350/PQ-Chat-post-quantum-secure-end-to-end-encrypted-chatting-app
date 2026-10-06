import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  KEM_PARAMS,
  generateKeyPair,
  derivePublicKeyFromPrivateKey,
  saveSessionPrivateKey,
  encryptMessage,
  decryptMessage,
  encryptMedia,
  decryptMedia,
  exportEncryptedKeyFile,
  decryptKeyFile,
  proveKeyPossession,
  computeSafetyNumber,
  toB64,
  fromB64,
} from "../lib/pqcrypto.js";
import { expectedProof } from "../lib/kemChallenge.js";

async function setupPair() {
  const alice = await generateKeyPair();
  const bob = await generateKeyPair();
  saveSessionPrivateKey("alice", alice.privateKey);
  saveSessionPrivateKey("bob", bob.privateKey);
  return {
    keys: { receiverPublicKey: toB64(bob.publicKey), senderPublicKey: toB64(alice.publicKey), sender: "alice", receiver: "bob" },
  };
}

test("derivePublicKeyFromPrivateKey works for every ML-KEM parameter set", async () => {
  for (const kem of Object.keys(KEM_PARAMS)) {
    const { publicKey, privateKey } = await generateKeyPair(kem);
    assert.deepEqual(derivePublicKeyFromPrivateKey(privateKey), publicKey, kem);
  }
});

test("derivePublicKeyFromPrivateKey rejects corrupted or unknown-length keys", async () => {
  const { privateKey } = await generateKeyPair();
  const tampered = new Uint8Array(privateKey);
  tampered[800] ^= 0xff; // flip a byte inside the embedded public key
  assert.equal(derivePublicKeyFromPrivateKey(tampered), null);
  assert.equal(derivePublicKeyFromPrivateKey(privateKey.slice(0, 1568)), null);
});

test("text round-trips for both receiver and sender", async () => {
  const { keys } = await setupPair();
  const env = await encryptMessage("hello quantum world", keys);
  const msg = { ...env, text: env.ciphertext, sender: "alice", receiver: "bob" };
  assert.deepEqual(await decryptMessage(msg, "bob", false), { text: "hello quantum world", legacy: false });
  assert.deepEqual(await decryptMessage(msg, "alice", true), { text: "hello quantum world", legacy: false });
});

test("AAD binding: a ciphertext re-labelled to another conversation fails", async () => {
  const { keys } = await setupPair();
  const env = await encryptMessage("secret", keys);
  const relabelled = { ...env, text: env.ciphertext, sender: "mallory", receiver: "bob" };
  assert.equal(await decryptMessage(relabelled, "bob", false), null);
});

test("no downgrade: stripping cryptoVersion from a v2 message does not decrypt", async () => {
  const { keys } = await setupPair();
  const env = await encryptMessage("secret", keys);
  const stripped = { ...env, cryptoVersion: null, text: env.ciphertext, sender: "alice", receiver: "bob" };
  assert.equal(await decryptMessage(stripped, "bob", false), null);
});

test("legacy v1 messages still decrypt but are flagged", async () => {
  const bob = await generateKeyPair();
  saveSessionPrivateKey("bob", bob.privateKey);
  // Reproduce the v1 format: SHA-256(master || "pqc-message-ratchet-step-0") AES key, no AAD.
  const master = crypto.randomBytes(32);
  const stepKey = crypto.createHash("sha256").update(Buffer.concat([master, Buffer.from("pqc-message-ratchet-step-0")])).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", stepKey, iv);
  const ct = Buffer.concat([c.update("old message"), c.final(), c.getAuthTag()]);
  const kem = new KEM_PARAMS["ML-KEM-512"].Impl();
  const [kyberCt, ss] = await kem.encap(bob.publicKey);
  const keyIv = crypto.randomBytes(12);
  const kc = crypto.createCipheriv("aes-256-gcm", Buffer.from(ss), keyIv);
  const encKey = Buffer.concat([kc.update(master), kc.final(), kc.getAuthTag()]);
  const container = JSON.stringify({ kyber: toB64(kyberCt), encKey: toB64(encKey), keyIv: toB64(keyIv) });

  const out = await decryptMessage({ text: toB64(ct), iv: toB64(iv), encryptedKey: container, cryptoVersion: null }, "bob", false);
  assert.deepEqual(out, { text: "old message", legacy: true });
});

test("media round-trips with name/MIME hidden inside the ciphertext", async () => {
  const { keys } = await setupPair();
  const file = crypto.randomBytes(5000);
  const env = await encryptMedia(file, { name: "cat.png", mimeType: "image/png" }, keys);
  assert.ok(!Buffer.from(env.ciphertext).includes(Buffer.from("cat.png")));
  const out = await decryptMedia(env.ciphertext, { ...env, sender: "alice", receiver: "bob" }, "bob", false);
  assert.equal(out.name, "cat.png");
  assert.equal(out.mimeType, "image/png");
  assert.deepEqual(Buffer.from(out.data), file);
});

test(".pqkey v2 file round-trips and rejects a wrong password", async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const file = await exportEncryptedKeyFile("alice", "pw-123456", privateKey, { iterations: 1000 });
  assert.equal(file.publicKey, toB64(publicKey));
  assert.deepEqual(await decryptKeyFile("pw-123456", file), privateKey);
  await assert.rejects(decryptKeyFile("wrong-password", file));
  await assert.rejects(decryptKeyFile("pw-123456", { ...file, username: "mallory" }), "username is bound via AAD");
});

test("client KEM proof matches what the server expects; wrong key does not", async () => {
  const { publicKey, privateKey } = await generateKeyPair();
  const other = await generateKeyPair();
  const kem = new KEM_PARAMS["ML-KEM-512"].Impl();
  const [ct, ss] = await kem.encap(publicKey);
  const challenge = { challengeId: "abc123", ciphertext: toB64(ct), kem: "ML-KEM-512" };
  assert.equal(await proveKeyPossession(challenge, privateKey), expectedProof(ss, "abc123"));
  assert.notEqual(await proveKeyPossession(challenge, other.privateKey), expectedProof(ss, "abc123"));
});

test("safety number is symmetric and changes when a key changes", async () => {
  const a = toB64((await generateKeyPair()).publicKey);
  const b = toB64((await generateKeyPair()).publicKey);
  const c = toB64((await generateKeyPair()).publicKey);
  assert.equal(await computeSafetyNumber("alice", a, "bob", b), await computeSafetyNumber("bob", b, "alice", a));
  assert.notEqual(await computeSafetyNumber("alice", a, "bob", b), await computeSafetyNumber("alice", a, "bob", c));
  assert.equal(fromB64(a).length, 800);
});
