export default async function handler(req, res) {
  const { data } = req.body;

  // encrypt here

  res.status(200).json({
    encryptedMedia: "...",
    iv: "...",
    tag: "..."
  });
}