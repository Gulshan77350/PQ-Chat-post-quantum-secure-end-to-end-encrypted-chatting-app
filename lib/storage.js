// lib/storage.js — encrypted media blob storage.
//
// S3-compatible object storage (AWS S3, Cloudflare R2, MinIO) when S3_BUCKET is set: the
// browser uploads/downloads ciphertext directly with short-lived presigned URLs, so blobs
// never pass through Node or MongoDB. Otherwise a local-disk backend streams through
// the API (fine for development and single-host deployments).
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Transform } from "stream";

export const MAX_MEDIA_BYTES = parseInt(process.env.MAX_MEDIA_BYTES, 10) || 25 * 1024 * 1024;
const PRESIGN_TTL_SEC = 300;

export const isS3 = () => !!process.env.S3_BUCKET;

let s3Promise;
async function s3() {
  if (!s3Promise) {
    s3Promise = (async () => {
      const sdk = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const opts = {
        region: process.env.S3_REGION || "auto",
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      };
      const client = new sdk.S3Client({ ...opts, endpoint: process.env.S3_ENDPOINT || undefined });
      // Presigned URLs embed (and sign) the host, so they must use the address the BROWSER
      // reaches, e.g. http://localhost:9000 while the server talks to http://minio:9000.
      const presignClient = process.env.S3_PUBLIC_ENDPOINT
        ? new sdk.S3Client({ ...opts, endpoint: process.env.S3_PUBLIC_ENDPOINT })
        : client;
      return { sdk, client, presignClient, getSignedUrl, Bucket: process.env.S3_BUCKET };
    })();
  }
  return s3Promise;
}

const objectKey = (id) => `media/${id}`;
// The upload dir is runtime configuration, not a build input: tell Turbopack not to
// trace it (otherwise the whole project is bundled into the server output).
const localDir = () => path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "./uploads");
const localPath = (id) => {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Invalid media id");
  return path.join(/*turbopackIgnore: true*/ localDir(), id);
};

/** Where and how the client should upload the ciphertext. */
export async function createUploadTarget(id, size) {
  if (isS3()) {
    const { sdk, presignClient, getSignedUrl, Bucket } = await s3();
    const cmd = new sdk.PutObjectCommand({ Bucket, Key: objectKey(id), ContentLength: size, ContentType: "application/octet-stream" });
    const url = await getSignedUrl(presignClient, cmd, { expiresIn: PRESIGN_TTL_SEC });
    return { url, method: "PUT", headers: { "Content-Type": "application/octet-stream" }, direct: true };
  }
  return { url: `/api/media/${id}`, method: "PUT", headers: { "Content-Type": "application/octet-stream" }, direct: false };
}

/** Local backend only: stream the request body to disk, enforcing the declared size. */
export async function writeLocal(id, readable, maxBytes) {
  await fs.promises.mkdir(localDir(), { recursive: true });
  let written = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      written += chunk.length;
      if (written > maxBytes) return cb(new Error("UPLOAD_TOO_LARGE"));
      cb(null, chunk);
    },
  });
  const file = localPath(id);
  try {
    await pipeline(readable, limiter, fs.createWriteStream(file));
  } catch (err) {
    await fs.promises.rm(file, { force: true });
    throw err;
  }
  return written;
}

/** Size of the stored object, or null if missing. */
export async function statObject(id) {
  if (isS3()) {
    const { sdk, client, Bucket } = await s3();
    try {
      const head = await client.send(new sdk.HeadObjectCommand({ Bucket, Key: objectKey(id) }));
      return head.ContentLength;
    } catch {
      return null;
    }
  }
  try {
    return (await fs.promises.stat(localPath(id))).size;
  } catch {
    return null;
  }
}

/** S3: presigned GET URL. Local: null (caller streams via readLocal). */
export async function createDownloadUrl(id) {
  if (!isS3()) return null;
  const { sdk, presignClient, getSignedUrl, Bucket } = await s3();
  return getSignedUrl(presignClient, new sdk.GetObjectCommand({ Bucket, Key: objectKey(id) }), { expiresIn: 60 });
}

export function readLocal(id) {
  return fs.createReadStream(localPath(id));
}

export async function deleteObject(id) {
  try {
    if (isS3()) {
      const { sdk, client, Bucket } = await s3();
      await client.send(new sdk.DeleteObjectCommand({ Bucket, Key: objectKey(id) }));
    } else {
      await fs.promises.rm(localPath(id), { force: true });
    }
  } catch (err) {
    console.error(`Failed to delete media ${id}:`, err.message);
  }
}
