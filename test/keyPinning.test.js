import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPeerKey, acceptPeerKey, setPeerVerified, getPin } from "../lib/keyPinning.js";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

test("first key is pinned, same key matches, a different key is flagged", () => {
  const storage = memoryStorage();
  assert.equal(checkPeerKey("alice", "bob", "KEY1", { storage }).status, "new");
  assert.equal(checkPeerKey("alice", "bob", "KEY1", { storage }).status, "match");
  const changed = checkPeerKey("alice", "bob", "KEY2", { storage });
  assert.equal(changed.status, "changed");
  // A changed key must NOT overwrite the pin by itself.
  assert.equal(getPin("alice", "bob", { storage }).publicKey, "KEY1");
});

test("accepting a changed key re-pins it and resets verification", () => {
  const storage = memoryStorage();
  checkPeerKey("alice", "bob", "KEY1", { storage });
  setPeerVerified("alice", "bob", true, { storage });
  assert.equal(getPin("alice", "bob", { storage }).verified, true);

  acceptPeerKey("alice", "bob", "KEY2", { storage });
  assert.equal(checkPeerKey("alice", "bob", "KEY2", { storage }).status, "match");
  assert.equal(getPin("alice", "bob", { storage }).verified, false);
});

test("pins are scoped per local user", () => {
  const storage = memoryStorage();
  checkPeerKey("alice", "bob", "KEY1", { storage });
  assert.equal(checkPeerKey("carol", "bob", "KEY2", { storage }).status, "new");
});
