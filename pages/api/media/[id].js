import Media from "../../../models/Media.js";
import Message from "../../../models/Message.js";
import { apiRoute, HttpError } from "../../../lib/api.js";
import { isS3, writeLocal, readLocal, createDownloadUrl } from "../../../lib/storage.js";

// Streamed — never buffered into memory or limited by the JSON body parser.
export const config = { api: { bodyParser: false } };

const validId = (id) => typeof id === "string" && /^[a-f0-9]{32}$/.test(id);

export default apiRoute(
  {
    // PUT /api/media/:id — local-disk backend upload (S3 uploads go to the presigned URL).
    PUT: {
      rateLimit: { name: "media-upload", limit: 30, windowMs: 60 * 1000 },
      handler: async (req, res) => {
        if (isS3()) throw new HttpError(400, "Upload directly to object storage");
        const id = req.query.id;
        if (!validId(id)) throw new HttpError(400, "Invalid media id");
        const claim = await Media.findOneAndUpdate(
          { _id: id, owner: req.user.id, status: "pending" },
          { status: "uploading" }
        );
        if (!claim) throw new HttpError(404, "Upload slot not found");
        try {
          const written = await writeLocal(id, req, claim.size);
          if (written !== claim.size) throw new Error("UPLOAD_SIZE_MISMATCH");
        } catch (err) {
          await Media.updateOne({ _id: id }, { status: "pending" });
          throw new HttpError(400, "Upload failed or exceeded the declared size");
        }
        await Media.updateOne({ _id: id }, { status: "uploaded" });
        return res.status(204).end();
      },
    },

    // GET /api/media/:id — only the uploader or a participant of the message may fetch.
    GET: {
      rateLimit: { name: "media-download", limit: 300, windowMs: 60 * 1000 },
      handler: async (req, res) => {
        const id = req.query.id;
        if (!validId(id)) throw new HttpError(400, "Invalid media id");
        const media = await Media.findById(id).lean();
        if (!media) throw new HttpError(404, "Not found");

        let allowed = String(media.owner) === req.user.id;
        if (!allowed && media.messageId) {
          allowed = !!(await Message.exists({ _id: media.messageId, receiver: req.user.id, deletedAt: null }));
        }
        if (!allowed) throw new HttpError(404, "Not found");

        res.setHeader("Cache-Control", "private, no-store");
        if (isS3()) return res.status(200).json({ url: await createDownloadUrl(id) });

        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", media.size);
        readLocal(id)
          .on("error", () => res.destroy())
          .pipe(res);
      },
    },
  }
);
