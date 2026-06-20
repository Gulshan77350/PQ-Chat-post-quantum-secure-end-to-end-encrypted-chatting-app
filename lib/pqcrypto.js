import { MlKem512 } from "crystals-kyber-js";

export const toB64   = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

// ── Per-user key storage ──────────────────────────────────────
// Keys stored as pqc_privateKey_<username> so multiple users
// on the same browser don't overwrite each other
export function saveKeyPair(username, publicKey, privateKey) {
  localStorage.setItem(`pqc_privateKey_${username}`, toB64(privateKey));
  localStorage.setItem(`pqc_publicKey_${username}`,  toB64(publicKey));
}

export function loadPrivateKey(username) {
  const k = localStorage.getItem(`pqc_privateKey_${username}`);
  return k ? fromB64(k) : null;
}

export async function generateKeyPair() {
  const kyber = new MlKem512();
  const [publicKey, privateKey] = await kyber.generateKeyPair();
  return { publicKey, privateKey };
}

// ── Encrypt (uses receiver's public key) ──────────────────────
export async function encryptMessage(plaintext, receiverPublicKeyB64) {
  const kyber = new MlKem512();
  const [kyberCiphertext, sharedSecret] = await kyber.encap(fromB64(receiverPublicKeyB64));

  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", sharedSecret, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)
  );
  return {
    ciphertext:   toB64(ciphertext),
    iv:           toB64(iv),
    encryptedKey: toB64(kyberCiphertext),
  };
}

export async function encryptMedia(arrayBuffer, receiverPublicKeyB64) {
  const kyber = new MlKem512();
  const [kyberCiphertext, sharedSecret] = await kyber.encap(fromB64(receiverPublicKeyB64));

  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", sharedSecret, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, arrayBuffer);
  return {
    encryptedBase64: toB64(ciphertext),
    iv:              toB64(iv),
    encryptedKey:    toB64(kyberCiphertext),
  };
}

// ── Decrypt (uses own private key by username) ────────────────
export async function decryptMessage(ciphertextB64, ivB64, encryptedKeyB64, username) {
  try {
    const privateKey = loadPrivateKey(username);
    if (!privateKey) throw new Error(`No private key for ${username}`);

    const kyber = new MlKem512();
    const sharedSecret = await kyber.decap(fromB64(encryptedKeyB64), privateKey);

    const key = await crypto.subtle.importKey("raw", sharedSecret, { name: "AES-GCM" }, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(ciphertextB64)
    );
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.error("Text decryption failed:", err.message);
    return null;
  }
}

export async function decryptMediaData(encB64, ivB64, encryptedKeyB64, mimeType, username) {
  try {
    const privateKey = loadPrivateKey(username);
    if (!privateKey) throw new Error(`No private key for ${username}`);

    const kyber = new MlKem512();
    const sharedSecret = await kyber.decap(fromB64(encryptedKeyB64), privateKey);

    const key = await crypto.subtle.importKey("raw", sharedSecret, { name: "AES-GCM" }, false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(encB64)
    );
    return URL.createObjectURL(new Blob([decrypted], { type: mimeType }));
  } catch (err) {
    console.error("Media decryption failed:", err.message);
    return null;
  }
}
