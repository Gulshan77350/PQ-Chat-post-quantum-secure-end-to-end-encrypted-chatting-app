import crypto from "crypto";

export function encryptAES(buffer) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(buffer),
    cipher.final()
  ]);

  return {
    encrypted,
    key,
    iv,
    tag: cipher.getAuthTag()
  };
}