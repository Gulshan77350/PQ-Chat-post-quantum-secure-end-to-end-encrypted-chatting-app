import crypto from "crypto";

export default async function handler(req, res) {
  try {
    const {
      encryptedMedia,
      iv,
      tag,
      key
    } = req.body;

    const decipher =
      crypto.createDecipheriv(
        "aes-256-gcm",
        Buffer.from(key, "base64"),
        Buffer.from(iv, "base64")
      );

    decipher.setAuthTag(
      Buffer.from(tag, "base64")
    );

    const decrypted = Buffer.concat([
      decipher.update(
        Buffer.from(
          encryptedMedia,
          "base64"
        )
      ),
      decipher.final()
    ]);

    res.status(200).json({
      decryptedBase64:
        decrypted.toString("base64")
    });

  } catch (err) {
    res.status(500).json({
      error: "Decryption failed"
    });
  }
}