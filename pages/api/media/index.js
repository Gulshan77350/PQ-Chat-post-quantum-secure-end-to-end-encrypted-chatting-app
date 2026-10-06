import crypto from "crypto";
import Media from "../../../models/Media.js";
import { apiRoute, HttpError } from "../../../lib/api.js";
import { createUploadTarget, MAX_MEDIA_BYTES } from "../../../lib/storage.js";

// POST /api/media { size } — reserve a media id and get an upload target for the
// already-encrypted blob (a presigned S3 URL, or the local PUT endpoint).
export default apiRoute(
  {
    POST: async (req, res) => {
      const size = Number(req.body?.size);
      if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, "size is required");
      if (size > MAX_MEDIA_BYTES) throw new HttpError(413, `Attachments are limited to ${MAX_MEDIA_BYTES} bytes`);

      const id = crypto.randomBytes(16).toString("hex");
      await Media.create({ _id: id, owner: req.user.id, size, status: "pending" });
      return res.status(201).json({ mediaId: id, maxBytes: MAX_MEDIA_BYTES, upload: await createUploadTarget(id, size) });
    },
  },
  { rateLimit: { name: "media-create", limit: 30, windowMs: 60 * 1000 } }
);
