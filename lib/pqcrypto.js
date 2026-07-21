import { MlKem512 } from "crystals-kyber-js";

export const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

// ── Per-user key storage (Non-Custodial Keying in Session & Local Storage) ──
export function derivePublicKeyFromPrivateKey(privateKey) {
  if (!privateKey) return null;
  const bytes = typeof privateKey === "string" ? fromB64(privateKey) : privateKey;
  if (bytes.length >= 1568) {
    return bytes.slice(768, 1568);
  }
  return null;
}

export function saveSessionPrivateKey(username, privateKey) {
  if (!username) return;
  const cleanUser = username.trim();
  const b64 = typeof privateKey === "string" ? privateKey : toB64(privateKey);
  sessionStorage.setItem(`pqc_privateKey_${cleanUser}`, b64);
  try { localStorage.setItem(`pqc_privateKey_${cleanUser}`, b64); } catch (e) {}

  const pubBytes = derivePublicKeyFromPrivateKey(privateKey);
  if (pubBytes) {
    const pubB64 = toB64(pubBytes);
    sessionStorage.setItem(`pqc_publicKey_${cleanUser}`, pubB64);
    try { localStorage.setItem(`pqc_publicKey_${cleanUser}`, pubB64); } catch (e) {}
  }
}

export function saveKeyPair(username, publicKey, privateKey) {
  if (!username) return;
  const cleanUser = username.trim();
  const pubB64 = typeof publicKey === "string" ? publicKey : toB64(publicKey);
  sessionStorage.setItem(`pqc_publicKey_${cleanUser}`, pubB64);
  try { localStorage.setItem(`pqc_publicKey_${cleanUser}`, pubB64); } catch (e) {}
  saveSessionPrivateKey(cleanUser, privateKey);
}

export function loadPrivateKey(username) {
  if (!username) return null;
  const cleanUser = username.trim();
  const k = sessionStorage.getItem(`pqc_privateKey_${cleanUser}`) || localStorage.getItem(`pqc_privateKey_${cleanUser}`);
  return k ? fromB64(k) : null;
}

export function loadPublicKey(username) {
  if (!username) return null;
  const cleanUser = username.trim();
  const storedPk = sessionStorage.getItem(`pqc_publicKey_${cleanUser}`) || localStorage.getItem(`pqc_publicKey_${cleanUser}`);
  if (storedPk) return storedPk;
  const privKey = loadPrivateKey(cleanUser);
  if (privKey) {
    const derived = derivePublicKeyFromPrivateKey(privKey);
    if (derived) {
      const b64 = toB64(derived);
      sessionStorage.setItem(`pqc_publicKey_${cleanUser}`, b64);
      try { localStorage.setItem(`pqc_publicKey_${cleanUser}`, b64); } catch (e) {}
      return b64;
    }
  }
  return null;
}

export async function generateKeyPair() {
  const kyber = new MlKem512();
  const [publicKey, privateKey] = await kyber.generateKeyPair();
  return { publicKey, privateKey };
}

// ── Passphrase-derived Key Wrapping (PBKDF2 + AES-GCM) ───────
async function deriveEncryptionKey(password, salt) {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function exportEncryptedKeyFile(username, password, privateKeyBytes) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveEncryptionKey(password, salt);
  const encryptedPrivKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    privateKeyBytes
  );

  return {
    version: "1.0-pqc",
    algorithm: "Kyber-512 + AES-GCM (PBKDF2-SHA256)",
    username,
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
  const salt = fromB64(keyFileObj.salt);
  const iv   = fromB64(keyFileObj.iv);
  const encryptedKeyBytes = fromB64(keyFileObj.encryptedPrivateKey);
  const key  = await deriveEncryptionKey(password, salt);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encryptedKeyBytes
  );
  return new Uint8Array(decryptedBuffer);
}

// Helper: Encapsulate payload key for a target public key
async function encapsulatePayloadKey(kyber, payloadKeyBytes, publicKeyB64) {
  if (!publicKeyB64) return null;
  const [kyberCiphertext, sharedSecret] = await kyber.encap(fromB64(publicKeyB64));
  const keyIv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey(
    "raw", sharedSecret, { name: "AES-GCM" }, false, ["encrypt"]
  );
  const encPayloadKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: keyIv }, aesKey, payloadKeyBytes
  );
  return JSON.stringify({
    kyber: toB64(kyberCiphertext),
    encKey: toB64(encPayloadKey),
    keyIv: toB64(keyIv),
  });
}

// Helper: Decapsulate payload key using local private key
async function decapsulatePayloadKey(kyber, targetKeyStr, privateKey) {
  if (!targetKeyStr) throw new Error("No target key container");
  const trimmed = targetKeyStr.trim();
  if (trimmed.startsWith("{")) {
    const keyObj = JSON.parse(trimmed);
    const sharedSecret = await kyber.decap(fromB64(keyObj.kyber), privateKey);
    const aesKey = await crypto.subtle.importKey(
      "raw", sharedSecret, { name: "AES-GCM" }, false, ["decrypt"]
    );
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(keyObj.keyIv) },
      aesKey,
      fromB64(keyObj.encKey)
    );
    return new Uint8Array(decryptedBuffer);
  }
  // Legacy single-recipient key (direct Kyber shared secret)
  return await kyber.decap(fromB64(targetKeyStr), privateKey);
}

// ── Encrypt (uses receiver's AND sender's public keys) ─────────
export async function encryptMessage(plaintext, receiverPublicKeyB64, senderPublicKeyB64) {
  const kyber = new MlKem512();
  const payloadKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const payloadAesKey = await crypto.subtle.importKey(
    "raw", payloadKeyBytes, { name: "AES-GCM" }, false, ["encrypt"]
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, payloadAesKey, new TextEncoder().encode(plaintext)
  );

  const encryptedKey = await encapsulatePayloadKey(kyber, payloadKeyBytes, receiverPublicKeyB64);
  const senderEncryptedKey = senderPublicKeyB64
    ? await encapsulatePayloadKey(kyber, payloadKeyBytes, senderPublicKeyB64)
    : null;

  return {
    ciphertext: toB64(ciphertext),
    iv: toB64(iv),
    encryptedKey,
    senderEncryptedKey,
  };
}

export async function encryptMedia(arrayBuffer, receiverPublicKeyB64, senderPublicKeyB64) {
  const kyber = new MlKem512();
  const payloadKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const payloadAesKey = await crypto.subtle.importKey(
    "raw", payloadKeyBytes, { name: "AES-GCM" }, false, ["encrypt"]
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, payloadAesKey, arrayBuffer
  );

  const encryptedKey = await encapsulatePayloadKey(kyber, payloadKeyBytes, receiverPublicKeyB64);
  const senderEncryptedKey = senderPublicKeyB64
    ? await encapsulatePayloadKey(kyber, payloadKeyBytes, senderPublicKeyB64)
    : null;

  return {
    encryptedBase64: toB64(ciphertext),
    iv: toB64(iv),
    encryptedKey,
    senderEncryptedKey,
  };
}

// ── Decrypt (uses own private key by username) ────────────────
export async function decryptMessage(ciphertextB64, ivB64, encryptedKeyB64, username, senderEncryptedKeyB64 = null, isMe = false) {
  const privateKey = loadPrivateKey(username);
  if (!privateKey) return null;

  const kyber = new MlKem512();
  const keysToTry = [];

  if (isMe) {
    if (senderEncryptedKeyB64) keysToTry.push(senderEncryptedKeyB64);
    if (encryptedKeyB64) keysToTry.push(encryptedKeyB64);
  } else {
    if (encryptedKeyB64) keysToTry.push(encryptedKeyB64);
    if (senderEncryptedKeyB64) keysToTry.push(senderEncryptedKeyB64);
  }

  for (const targetKeyStr of keysToTry) {
    try {
      const payloadKeyBytes = await decapsulatePayloadKey(kyber, targetKeyStr, privateKey);
      const finalKey = await crypto.subtle.importKey(
        "raw", payloadKeyBytes, { name: "AES-GCM" }, false, ["decrypt"]
      );
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromB64(ivB64) }, finalKey, fromB64(ciphertextB64)
      );
      return new TextDecoder().decode(decrypted);
    } catch (err) {
      // try next key container
    }
  }
  return null;
}

export async function decryptMediaData(encB64, ivB64, encryptedKeyB64, mimeType, username, senderEncryptedKeyB64 = null, isMe = false) {
  const privateKey = loadPrivateKey(username);
  if (!privateKey) return null;

  const kyber = new MlKem512();
  const keysToTry = [];

  if (isMe) {
    if (senderEncryptedKeyB64) keysToTry.push(senderEncryptedKeyB64);
    if (encryptedKeyB64) keysToTry.push(encryptedKeyB64);
  } else {
    if (encryptedKeyB64) keysToTry.push(encryptedKeyB64);
    if (senderEncryptedKeyB64) keysToTry.push(senderEncryptedKeyB64);
  }

  for (const targetKeyStr of keysToTry) {
    try {
      const payloadKeyBytes = await decapsulatePayloadKey(kyber, targetKeyStr, privateKey);
      const finalKey = await crypto.subtle.importKey(
        "raw", payloadKeyBytes, { name: "AES-GCM" }, false, ["decrypt"]
      );
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromB64(ivB64) }, finalKey, fromB64(encB64)
      );
      return URL.createObjectURL(new Blob([decrypted], { type: mimeType }));
    } catch (err) {
      // try next key container
    }
  }
  return null;
}
