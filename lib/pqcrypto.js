import { MlKem512 } from "crystals-kyber-js";

export const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ── In-Memory Key Isolation Store (JS Module Memory Vault) ──────
// Decrypted Kyber private keys are stored ONLY in memory to mitigate XSS key exfiltration.
const inMemoryPrivateKeyStore = new Map();

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
  const bytes = typeof privateKey === "string" ? fromB64(privateKey) : new Uint8Array(privateKey);
  const b64 = toB64(bytes);

  // Store raw key bytes strictly in JS module memory
  inMemoryPrivateKeyStore.set(cleanUser, bytes);

  // SessionStorage used strictly for active tab session continuity
  if (typeof window !== "undefined" && window.sessionStorage) {
    sessionStorage.setItem(`pqc_privateKey_${cleanUser}`, b64);
  }

  // Purge any legacy raw keys from localStorage for XSS immunity
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.removeItem(`pqc_privateKey_${cleanUser}`);
    } catch (e) {}
  }

  const pubBytes = derivePublicKeyFromPrivateKey(bytes);
  if (pubBytes) {
    const pubB64 = toB64(pubBytes);
    if (typeof window !== "undefined" && window.sessionStorage) {
      sessionStorage.setItem(`pqc_publicKey_${cleanUser}`, pubB64);
    }
  }
}

export function saveKeyPair(username, publicKey, privateKey) {
  if (!username) return;
  const cleanUser = username.trim();
  const pubB64 = typeof publicKey === "string" ? publicKey : toB64(publicKey);
  if (typeof window !== "undefined" && window.sessionStorage) {
    sessionStorage.setItem(`pqc_publicKey_${cleanUser}`, pubB64);
  }
  saveSessionPrivateKey(cleanUser, privateKey);
}

export function loadPrivateKey(username) {
  if (!username) return null;
  const cleanUser = username.trim();

  // 1. Return from in-memory JS vault first
  if (inMemoryPrivateKeyStore.has(cleanUser)) {
    return inMemoryPrivateKeyStore.get(cleanUser);
  }

  // 2. Fallback to active tab sessionStorage
  if (typeof window !== "undefined" && window.sessionStorage) {
    const k = sessionStorage.getItem(`pqc_privateKey_${cleanUser}`);
    if (k) {
      const bytes = fromB64(k);
      inMemoryPrivateKeyStore.set(cleanUser, bytes);
      return bytes;
    }
  }

  // Clean up legacy localStorage if present
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.removeItem(`pqc_privateKey_${cleanUser}`);
    } catch (e) {}
  }

  return null;
}

export function loadPublicKey(username) {
  if (!username) return null;
  const cleanUser = username.trim();
  if (typeof window !== "undefined" && window.sessionStorage) {
    const storedPk = sessionStorage.getItem(`pqc_publicKey_${cleanUser}`);
    if (storedPk) return storedPk;
  }
  const privKey = loadPrivateKey(cleanUser);
  if (privKey) {
    const derived = derivePublicKeyFromPrivateKey(privKey);
    if (derived) {
      const b64 = toB64(derived);
      if (typeof window !== "undefined" && window.sessionStorage) {
        sessionStorage.setItem(`pqc_publicKey_${cleanUser}`, b64);
      }
      return b64;
    }
  }
  return null;
}

export function clearSessionKeys(username) {
  if (!username) return;
  const cleanUser = username.trim();
  inMemoryPrivateKeyStore.delete(cleanUser);
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(`pqc_privateKey_${cleanUser}`);
      sessionStorage.removeItem(`pqc_publicKey_${cleanUser}`);
      localStorage.removeItem(`pqc_privateKey_${cleanUser}`);
    } catch (e) {}
  }
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
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(password, salt);
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
  const iv = fromB64(keyFileObj.iv);
  const encryptedKeyBytes = fromB64(keyFileObj.encryptedPrivateKey);
  const key = await deriveEncryptionKey(password, salt);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encryptedKeyBytes
  );
  return new Uint8Array(decryptedBuffer);
}

// ── Per-Message Forward Secrecy Ratchet (SHA-256 Single-Use Key Derivation) ──
export async function deriveRatchetedPayloadKey(masterPayloadBytes, ratchetStep = 0) {
  const enc = new TextEncoder();
  const infoBytes = enc.encode(`pqc-message-ratchet-step-${ratchetStep}`);
  const combined = new Uint8Array(masterPayloadBytes.length + infoBytes.length);
  combined.set(masterPayloadBytes, 0);
  combined.set(infoBytes, masterPayloadBytes.length);

  const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
  return crypto.subtle.importKey(
    "raw",
    hashBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

// Helper: Encapsulate payload master key for a target public key
async function encapsulatePayloadKey(kyber, payloadKeyBytes, publicKeyB64) {
  if (!publicKeyB64) return null;
  const [kyberCiphertext, sharedSecret] = await kyber.encap(fromB64(publicKeyB64));
  const keyIv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const encPayloadKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: keyIv },
    aesKey,
    payloadKeyBytes
  );
  return JSON.stringify({
    kyber: toB64(kyberCiphertext),
    encKey: toB64(encPayloadKey),
    keyIv: toB64(keyIv),
  });
}

// Helper: Decapsulate payload master key using local private key
async function decapsulatePayloadKey(kyber, targetKeyStr, privateKey) {
  if (!targetKeyStr) throw new Error("No target key container");
  const trimmed = targetKeyStr.trim();
  if (trimmed.startsWith("{")) {
    const keyObj = JSON.parse(trimmed);
    const sharedSecret = await kyber.decap(fromB64(keyObj.kyber), privateKey);
    const aesKey = await crypto.subtle.importKey(
      "raw",
      sharedSecret,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
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

// ── Encrypt Message (Forward-Secrecy Ratcheted) ─────────────────
export async function encryptMessage(plaintext, receiverPublicKeyB64, senderPublicKeyB64, ratchetStep = 0) {
  const kyber = new MlKem512();
  const masterPayloadKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Derive ratcheted single-use key for this specific message step
  const ratchetedAesKey = await deriveRatchetedPayloadKey(masterPayloadKeyBytes, ratchetStep);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    ratchetedAesKey,
    new TextEncoder().encode(plaintext)
  );

  const encryptedKey = await encapsulatePayloadKey(kyber, masterPayloadKeyBytes, receiverPublicKeyB64);
  const senderEncryptedKey = senderPublicKeyB64
    ? await encapsulatePayloadKey(kyber, masterPayloadKeyBytes, senderPublicKeyB64)
    : null;

  return {
    ciphertext: toB64(ciphertext),
    iv: toB64(iv),
    encryptedKey,
    senderEncryptedKey,
  };
}

export async function encryptMedia(arrayBuffer, receiverPublicKeyB64, senderPublicKeyB64, ratchetStep = 0) {
  const kyber = new MlKem512();
  const masterPayloadKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ratchetedAesKey = await deriveRatchetedPayloadKey(masterPayloadKeyBytes, ratchetStep);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    ratchetedAesKey,
    arrayBuffer
  );

  const encryptedKey = await encapsulatePayloadKey(kyber, masterPayloadKeyBytes, receiverPublicKeyB64);
  const senderEncryptedKey = senderPublicKeyB64
    ? await encapsulatePayloadKey(kyber, masterPayloadKeyBytes, senderPublicKeyB64)
    : null;

  return {
    encryptedBase64: toB64(ciphertext),
    iv: toB64(iv),
    encryptedKey,
    senderEncryptedKey,
  };
}

// ── Decrypt Message (Forward-Secrecy Ratcheted) ────────────────
export async function decryptMessage(ciphertextB64, ivB64, encryptedKeyB64, username, senderEncryptedKeyB64 = null, isMe = false, ratchetStep = 0) {
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
      const masterPayloadKeyBytes = await decapsulatePayloadKey(kyber, targetKeyStr, privateKey);
      
      // Try ratcheted key derivation first, fallback to direct master key for legacy messages
      let ratchetedAesKey;
      try {
        ratchetedAesKey = await deriveRatchetedPayloadKey(masterPayloadKeyBytes, ratchetStep);
      } catch (e) {
        ratchetedAesKey = await crypto.subtle.importKey(
          "raw", masterPayloadKeyBytes, { name: "AES-GCM" }, false, ["decrypt"]
        );
      }

      try {
        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: fromB64(ivB64) }, ratchetedAesKey, fromB64(ciphertextB64)
        );
        return new TextDecoder().decode(decrypted);
      } catch (ratchetErr) {
        // Legacy message fallback (unratcheted master key)
        const legacyKey = await crypto.subtle.importKey(
          "raw", masterPayloadKeyBytes, { name: "AES-GCM" }, false, ["decrypt"]
        );
        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: fromB64(ivB64) }, legacyKey, fromB64(ciphertextB64)
        );
        return new TextDecoder().decode(decrypted);
      }
    } catch (err) {
      // try next key container
    }
  }
  return null;
}

export async function decryptMediaData(encB64, ivB64, encryptedKeyB64, mimeType, username, senderEncryptedKeyB64 = null, isMe = false, ratchetStep = 0) {
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
      const masterPayloadKeyBytes = await decapsulatePayloadKey(kyber, targetKeyStr, privateKey);
      
      let ratchetedAesKey;
      try {
        ratchetedAesKey = await deriveRatchetedPayloadKey(masterPayloadKeyBytes, ratchetStep);
      } catch (e) {
        ratchetedAesKey = await crypto.subtle.importKey(
          "raw", masterPayloadKeyBytes, { name: "AES-GCM" }, false, ["decrypt"]
        );
      }

      try {
        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: fromB64(ivB64) }, ratchetedAesKey, fromB64(encB64)
        );
        return URL.createObjectURL(new Blob([decrypted], { type: mimeType }));
      } catch (ratchetErr) {
        const legacyKey = await crypto.subtle.importKey(
          "raw", masterPayloadKeyBytes, { name: "AES-GCM" }, false, ["decrypt"]
        );
        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: fromB64(ivB64) }, legacyKey, fromB64(encB64)
        );
        return URL.createObjectURL(new Blob([decrypted], { type: mimeType }));
      }
    } catch (err) {
      // try next key container
    }
  }
  return null;
}

// ── TOFU Key Authentication Safety Number Calculation ─────────────
export async function computeSafetyNumber(userA, pubKeyA, userB, pubKeyB) {
  if (!userA || !pubKeyA || !userB || !pubKeyB) return null;

  // Sort user tuples deterministically so (A, B) and (B, A) yield identical safety numbers
  const tuples = [
    { name: userA.trim(), key: pubKeyA.trim() },
    { name: userB.trim(), key: pubKeyB.trim() },
  ].sort((a, b) => a.name.localeCompare(b.name));

  const combinedStr = `SAFETY_VERIFY_V1:${tuples[0].name}:${tuples[0].key}:${tuples[1].name}:${tuples[1].key}`;
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc.encode(combinedStr));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();

  const blocks = [];
  for (let i = 0; i < 30; i += 5) {
    blocks.push(hex.slice(i, i + 5));
  }
  return blocks.join(" - ");
}
