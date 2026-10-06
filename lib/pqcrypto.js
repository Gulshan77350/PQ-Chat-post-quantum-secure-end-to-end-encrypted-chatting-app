import { MlKem512, MlKem768, MlKem1024, sha3_256 } from "crystals-kyber-js";

// ── Encoding helpers ─────────────────────────────────────────────
export const toB64 = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── KEM parameter sets (FIPS 203) ────────────────────────────────
// Sizes are derived from the module rank k instead of hardcoded offsets so every
// helper keeps working when ACTIVE_KEM changes.
//   ek (public key)  = 384k + 32
//   dk (private key) = dk_PKE (384k) || ek || H(ek) (32) || z (32)
export const KEM_PARAMS = {
  "ML-KEM-512": { Impl: MlKem512, k: 2 },
  "ML-KEM-768": { Impl: MlKem768, k: 3 },
  "ML-KEM-1024": { Impl: MlKem1024, k: 4 },
};
for (const p of Object.values(KEM_PARAMS)) {
  p.publicKeyBytes = 384 * p.k + 32;
  p.privateKeyBytes = 768 * p.k + 96;
}

// Changing this one constant switches new keys AND new messages to another parameter set.
// Old messages keep decrypting because every key container records its own `kem`.
export const ACTIVE_KEM = "ML-KEM-512";

// Current message format. v2 = HKDF key derivation + AAD bound to sender/receiver, no
// legacy fallbacks. Anything without cryptoVersion >= 2 is treated as legacy (v1).
export const CRYPTO_VERSION = 2;

function kemParams(name = ACTIVE_KEM) {
  const p = KEM_PARAMS[name];
  if (!p) throw new Error(`Unsupported KEM parameter set: ${name}`);
  return p;
}

function newKem(name = ACTIVE_KEM) {
  return new (kemParams(name).Impl)();
}

export function kemForPrivateKeyLength(len) {
  return Object.keys(KEM_PARAMS).find((n) => KEM_PARAMS[n].privateKeyBytes === len) || null;
}

export function kemForPublicKeyLength(len) {
  return Object.keys(KEM_PARAMS).find((n) => KEM_PARAMS[n].publicKeyBytes === len) || null;
}

const bytesEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Extracts the encapsulation (public) key embedded in an ML-KEM decapsulation key.
 * Validates the length against a known parameter set AND checks the embedded H(ek)
 * hash, so a truncated/corrupted/foreign key returns null instead of garbage.
 */
export function derivePublicKeyFromPrivateKey(privateKey) {
  if (!privateKey) return null;
  const bytes = typeof privateKey === "string" ? fromB64(privateKey) : new Uint8Array(privateKey);
  const kem = kemForPrivateKeyLength(bytes.length);
  if (!kem) return null;
  const { k, publicKeyBytes } = KEM_PARAMS[kem];
  const ekStart = 384 * k;
  const ek = bytes.slice(ekStart, ekStart + publicKeyBytes);
  const embeddedHash = bytes.slice(ekStart + publicKeyBytes, ekStart + publicKeyBytes + 32);
  if (!bytesEqual(sha3_256(ek), embeddedHash)) return null;
  return ek;
}

// ── In-Memory Key Isolation Store ────────────────────────────────
// Decrypted private keys live in JS module memory; sessionStorage keeps a copy only so
// a reload of the same tab does not force re-uploading the .pqkey file.
const inMemoryPrivateKeyStore = new Map();
const hasWindow = () => typeof window !== "undefined";

export function saveSessionPrivateKey(username, privateKey) {
  if (!username) return;
  const cleanUser = username.trim();
  const bytes = typeof privateKey === "string" ? fromB64(privateKey) : new Uint8Array(privateKey);
  inMemoryPrivateKeyStore.set(cleanUser, bytes);

  if (hasWindow()) {
    try {
      sessionStorage.setItem(`pqc_privateKey_${cleanUser}`, toB64(bytes));
      localStorage.removeItem(`pqc_privateKey_${cleanUser}`); // purge legacy copies
      const pub = derivePublicKeyFromPrivateKey(bytes);
      if (pub) sessionStorage.setItem(`pqc_publicKey_${cleanUser}`, toB64(pub));
    } catch (e) {}
  }
}

export function loadPrivateKey(username) {
  if (!username) return null;
  const cleanUser = username.trim();
  if (inMemoryPrivateKeyStore.has(cleanUser)) return inMemoryPrivateKeyStore.get(cleanUser);

  if (hasWindow()) {
    try {
      const k = sessionStorage.getItem(`pqc_privateKey_${cleanUser}`);
      if (k) {
        const bytes = fromB64(k);
        inMemoryPrivateKeyStore.set(cleanUser, bytes);
        return bytes;
      }
    } catch (e) {}
  }
  return null;
}

export function loadPublicKey(username) {
  if (!username) return null;
  const cleanUser = username.trim();
  if (hasWindow()) {
    try {
      const stored = sessionStorage.getItem(`pqc_publicKey_${cleanUser}`);
      if (stored) return stored;
    } catch (e) {}
  }
  const derived = derivePublicKeyFromPrivateKey(loadPrivateKey(cleanUser));
  return derived ? toB64(derived) : null;
}

export function clearSessionKeys(username) {
  if (!username) return;
  const cleanUser = username.trim();
  inMemoryPrivateKeyStore.delete(cleanUser);
  if (hasWindow()) {
    try {
      sessionStorage.removeItem(`pqc_privateKey_${cleanUser}`);
      sessionStorage.removeItem(`pqc_publicKey_${cleanUser}`);
      localStorage.removeItem(`pqc_privateKey_${cleanUser}`);
    } catch (e) {}
  }
}

export async function generateKeyPair(kem = ACTIVE_KEM) {
  const [publicKey, privateKey] = await newKem(kem).generateKeyPair();
  return { publicKey, privateKey, kem };
}

// ── Passphrase-derived Key Wrapping (PBKDF2 + AES-GCM) ───────────
// 600k iterations = OWASP 2023 guidance for PBKDF2-HMAC-SHA256. Older v1 files used 100k
// and carry no iteration count, so the default on read stays 100k.
export const PBKDF2_ITERATIONS = 600000;
const LEGACY_PBKDF2_ITERATIONS = 100000;

async function deriveWrappingKey(password, salt, iterations) {
  const passwordKey = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function exportEncryptedKeyFile(username, password, privateKeyBytes, { iterations = PBKDF2_ITERATIONS } = {}) {
  const bytes = new Uint8Array(privateKeyBytes);
  const kem = kemForPrivateKeyLength(bytes.length);
  if (!kem) throw new Error("Unrecognised private key length");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveWrappingKey(password, salt, iterations);
  // Bind the ciphertext to the username so a key file cannot be silently relabelled.
  const encryptedPrivKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(`pqkey:v2:${username}`) },
    key,
    bytes
  );

  return {
    version: "2.0-pqc",
    kem,
    kdf: { name: "PBKDF2-SHA256", iterations },
    username,
    publicKey: toB64(derivePublicKeyFromPrivateKey(bytes)),
    salt: toB64(salt),
    iv: toB64(iv),
    encryptedPrivateKey: toB64(encryptedPrivKey),
    createdAt: new Date().toISOString(),
  };
}

export async function decryptKeyFile(password, keyFileObj) {
  if (!keyFileObj || !keyFileObj.salt || !keyFileObj.iv || !keyFileObj.encryptedPrivateKey) {
    throw new Error("Invalid .pqkey file format");
  }
  const isV2 = String(keyFileObj.version || "").startsWith("2");
  const iterations = keyFileObj.kdf?.iterations || LEGACY_PBKDF2_ITERATIONS;
  const key = await deriveWrappingKey(password, fromB64(keyFileObj.salt), iterations);
  const params = { name: "AES-GCM", iv: fromB64(keyFileObj.iv) };
  if (isV2) params.additionalData = enc.encode(`pqkey:v2:${keyFileObj.username}`);
  const decrypted = new Uint8Array(await crypto.subtle.decrypt(params, key, fromB64(keyFileObj.encryptedPrivateKey)));
  if (!derivePublicKeyFromPrivateKey(decrypted)) throw new Error("Key file does not contain a valid ML-KEM private key");
  return decrypted;
}

// ── Proof of private-key possession (login / key enrolment) ─────
// The server encapsulates a secret to the registered public key; only the holder of the
// private key can decapsulate it. We return HMAC(sharedSecret, context) instead of the
// raw secret so the proof is bound to this specific challenge.
export async function computeKemProof(sharedSecret, challengeId) {
  const hmacKey = await crypto.subtle.importKey("raw", sharedSecret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", hmacKey, enc.encode(`pqchat-kem-proof-v1:${challengeId}`));
  return toB64(sig);
}

export async function proveKeyPossession({ challengeId, ciphertext, kem }, privateKey) {
  const sharedSecret = await newKem(kem).decap(fromB64(ciphertext), privateKey);
  return computeKemProof(sharedSecret, challengeId);
}

// ── Hybrid KEM/DEM encryption ────────────────────────────────────
// A random 256-bit master key is wrapped (via Kyber encapsulation + AES-GCM) once for the
// receiver and once for the sender, so both can decrypt later without the server ever
// holding plaintext or a shared conversation key.
async function encapsulateMasterKey(masterKeyBytes, publicKeyB64) {
  if (!publicKeyB64) return null;
  const publicKey = fromB64(publicKeyB64);
  const kem = kemForPublicKeyLength(publicKey.length);
  if (!kem) throw new Error("Unrecognised public key length");
  const [kemCiphertext, sharedSecret] = await newKem(kem).encap(publicKey);
  const keyIv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey("raw", sharedSecret, { name: "AES-GCM" }, false, ["encrypt"]);
  const encMasterKey = await crypto.subtle.encrypt({ name: "AES-GCM", iv: keyIv }, aesKey, masterKeyBytes);
  return JSON.stringify({
    v: CRYPTO_VERSION,
    kem,
    kyber: toB64(kemCiphertext),
    encKey: toB64(encMasterKey),
    keyIv: toB64(keyIv),
  });
}

async function decapsulateMasterKey(containerStr, privateKey, allowLegacy) {
  const trimmed = (containerStr || "").trim();
  if (!trimmed) throw new Error("Empty key container");
  if (trimmed.startsWith("{")) {
    const c = JSON.parse(trimmed);
    if (!allowLegacy && (c.v || 1) < CRYPTO_VERSION) throw new Error("Key container version downgrade");
    const sharedSecret = await newKem(c.kem || "ML-KEM-512").decap(fromB64(c.kyber), privateKey);
    const aesKey = await crypto.subtle.importKey("raw", sharedSecret, { name: "AES-GCM" }, false, ["decrypt"]);
    const master = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(c.keyIv) }, aesKey, fromB64(c.encKey));
    return new Uint8Array(master);
  }
  // Pre-container format: the raw Kyber shared secret was used directly as the key.
  if (!allowLegacy) throw new Error("Raw legacy key container rejected for v2 message");
  return newKem("ML-KEM-512").decap(fromB64(trimmed), privateKey);
}

// v2 content key: HKDF-SHA256(master, info = purpose). Domain-separates text and media.
async function deriveContentKey(masterKeyBytes, purpose) {
  const ikm = await crypto.subtle.importKey("raw", masterKeyBytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(`pqchat/v2/${purpose}`) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// AAD binds a ciphertext to its conversation direction, so a stored ciphertext cannot be
// replayed into a different conversation or re-attributed to a different sender.
export function messageAad(sender, receiver, purpose) {
  return enc.encode(`pqchat:v2:${purpose}:${sender}:${receiver}`);
}

async function encryptPayload(plaintextBytes, { receiverPublicKey, senderPublicKey, sender, receiver }, purpose) {
  if (!sender || !receiver) throw new Error("sender and receiver are required for AAD binding");
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const contentKey = await deriveContentKey(masterKey, purpose);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: messageAad(sender, receiver, purpose) },
    contentKey,
    plaintextBytes
  );
  const [encryptedKey, senderEncryptedKey] = await Promise.all([
    encapsulateMasterKey(masterKey, receiverPublicKey),
    senderPublicKey ? encapsulateMasterKey(masterKey, senderPublicKey) : null,
  ]);
  masterKey.fill(0);
  return { ciphertext: new Uint8Array(ciphertext), iv: toB64(iv), encryptedKey, senderEncryptedKey, cryptoVersion: CRYPTO_VERSION };
}

/**
 * Decrypts a payload. v2 payloads take exactly one code path; any failure is a hard
 * failure. Only payloads WITHOUT a cryptoVersion (stored before v2 existed) may use the
 * legacy derivations, and when they do the result is flagged `legacy: true` so the UI can
 * surface it instead of silently accepting the weaker format.
 */
async function decryptPayload(ciphertextBytes, meta, username, isMe, purpose) {
  const privateKey = loadPrivateKey(username);
  if (!privateKey) return null;

  const isLegacy = !meta.cryptoVersion || meta.cryptoVersion < CRYPTO_VERSION;
  const containers = isMe
    ? [meta.senderEncryptedKey, meta.encryptedKey]
    : [meta.encryptedKey, meta.senderEncryptedKey];
  const iv = fromB64(meta.iv);

  for (const container of containers.filter(Boolean)) {
    let master;
    try {
      master = await decapsulateMasterKey(container, privateKey, isLegacy);
    } catch (e) {
      continue; // container not addressed to us (or wrong format) — try the other one
    }

    if (!isLegacy) {
      const contentKey = await deriveContentKey(master, purpose);
      try {
        const pt = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv, additionalData: messageAad(meta.sender, meta.receiver, purpose) },
          contentKey,
          ciphertextBytes
        );
        return { bytes: new Uint8Array(pt), legacy: false };
      } catch (e) {
        continue;
      }
    }

    // Legacy v1: SHA-256(master || "pqc-message-ratchet-step-0") key, or the raw master key.
    for (const legacyKey of [await deriveLegacyStepKey(master), await importRawAesKey(master)]) {
      try {
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, legacyKey, ciphertextBytes);
        console.warn("[pqcrypto] Decrypted a legacy (pre-v2) payload — no AAD binding.");
        return { bytes: new Uint8Array(pt), legacy: true };
      } catch (e) {}
    }
  }
  return null;
}

async function deriveLegacyStepKey(master) {
  const info = enc.encode("pqc-message-ratchet-step-0");
  const combined = new Uint8Array(master.length + info.length);
  combined.set(master, 0);
  combined.set(info, master.length);
  return importRawAesKey(new Uint8Array(await crypto.subtle.digest("SHA-256", combined)));
}

function importRawAesKey(bytes) {
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["decrypt"]);
}

// ── Text messages ────────────────────────────────────────────────
export async function encryptMessage(plaintext, keys) {
  const { ciphertext, ...rest } = await encryptPayload(enc.encode(plaintext), keys, "text");
  return { ciphertext: toB64(ciphertext), ...rest };
}

/** @returns {Promise<{text: string, legacy: boolean} | null>} */
export async function decryptMessage(msg, username, isMe) {
  if (!msg?.text || !msg.iv) return null;
  const out = await decryptPayload(fromB64(msg.text), msg, username, isMe, "text");
  return out ? { text: dec.decode(out.bytes), legacy: out.legacy } : null;
}

// ── Media ────────────────────────────────────────────────────────
// File name and MIME type are packed INSIDE the encrypted blob, so the server only ever
// learns the ciphertext size:  [u32 header length][header JSON][file bytes]
export function packMedia(fileBytes, { name, mimeType }) {
  const header = enc.encode(JSON.stringify({ name, mimeType }));
  const out = new Uint8Array(4 + header.length + fileBytes.byteLength);
  new DataView(out.buffer).setUint32(0, header.length);
  out.set(header, 4);
  out.set(new Uint8Array(fileBytes), 4 + header.length);
  return out;
}

export function unpackMedia(bytes) {
  const headerLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (headerLen > bytes.length - 4) throw new Error("Corrupt media header");
  const header = JSON.parse(dec.decode(bytes.subarray(4, 4 + headerLen)));
  return { ...header, data: bytes.subarray(4 + headerLen) };
}

export async function encryptMedia(fileBytes, fileMeta, keys) {
  return encryptPayload(packMedia(fileBytes, fileMeta), keys, "media");
}

/** @returns {Promise<{data: Uint8Array, name?: string, mimeType?: string, legacy: boolean} | null>} */
export async function decryptMedia(ciphertextBytes, meta, username, isMe) {
  const out = await decryptPayload(ciphertextBytes, meta, username, isMe, "media");
  if (!out) return null;
  if (out.legacy) return { data: out.bytes, legacy: true }; // v1 media had no packed header
  return { ...unpackMedia(out.bytes), legacy: false };
}

// ── Safety numbers ───────────────────────────────────────────────
export async function fingerprintPublicKey(publicKeyB64) {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(publicKeyB64.trim()));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function computeSafetyNumber(userA, pubKeyA, userB, pubKeyB) {
  if (!userA || !pubKeyA || !userB || !pubKeyB) return null;

  // Sort deterministically so (A, B) and (B, A) yield identical safety numbers.
  const tuples = [
    { name: userA.trim(), key: pubKeyA.trim() },
    { name: userB.trim(), key: pubKeyB.trim() },
  ].sort((a, b) => a.name.localeCompare(b.name));

  const combinedStr = `SAFETY_VERIFY_V1:${tuples[0].name}:${tuples[0].key}:${tuples[1].name}:${tuples[1].key}`;
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc.encode(combinedStr));
  const hex = Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();

  const blocks = [];
  for (let i = 0; i < 30; i += 5) blocks.push(hex.slice(i, i + 5));
  return blocks.join(" - ");
}
