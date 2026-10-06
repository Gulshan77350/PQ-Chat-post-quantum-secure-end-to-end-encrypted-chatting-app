// lib/keyPinning.js — Trust-On-First-Use pinning of peers' public keys (client side).
//
// The first key seen for a peer is pinned locally. If the server later returns a
// DIFFERENT key — a legitimate rotation, or a server/MITM swapping keys — the chat shows
// a "safety number changed" warning and blocks sending until the user re-accepts the key.
// Because pins live on the client, a malicious server cannot silently undo them.

const storageKey = (me) => `pqc_pins_v1_${me}`;

function defaultStorage() {
  return typeof window !== "undefined" ? window.localStorage : null;
}

function readPins(me, storage) {
  try {
    return JSON.parse(storage?.getItem(storageKey(me)) || "{}");
  } catch {
    return {};
  }
}

function writePins(me, pins, storage) {
  try {
    storage?.setItem(storageKey(me), JSON.stringify(pins));
  } catch {}
}

/**
 * @returns {{ status: "new" | "match" | "changed", pin: object, previous?: object }}
 * "new" pins the key immediately (trust on first use).
 */
export function checkPeerKey(me, peer, publicKey, { keyVersion = null, storage = defaultStorage() } = {}) {
  const pins = readPins(me, storage);
  const existing = pins[peer];
  if (!existing) {
    const pin = { publicKey, keyVersion, firstSeen: new Date().toISOString(), verified: false };
    pins[peer] = pin;
    writePins(me, pins, storage);
    return { status: "new", pin };
  }
  if (existing.publicKey === publicKey) return { status: "match", pin: existing };
  return { status: "changed", pin: existing, previous: existing };
}

/** User explicitly accepts a changed key. Verification is reset: it must be re-checked. */
export function acceptPeerKey(me, peer, publicKey, { keyVersion = null, storage = defaultStorage() } = {}) {
  const pins = readPins(me, storage);
  pins[peer] = {
    publicKey,
    keyVersion,
    firstSeen: new Date().toISOString(),
    verified: false,
    replacedAt: pins[peer] ? new Date().toISOString() : undefined,
  };
  writePins(me, pins, storage);
  return pins[peer];
}

export function setPeerVerified(me, peer, verified, { storage = defaultStorage() } = {}) {
  const pins = readPins(me, storage);
  if (!pins[peer]) return null;
  pins[peer].verified = !!verified;
  writePins(me, pins, storage);
  return pins[peer];
}

export function getPin(me, peer, { storage = defaultStorage() } = {}) {
  return readPins(me, storage)[peer] || null;
}
