import { test } from "node:test";
import assert from "node:assert/strict";

test("S3 upload targets are presigned for the browser-reachable endpoint", async () => {
  Object.assign(process.env, {
    S3_BUCKET: "pqchat-media",
    S3_ENDPOINT: "http://minio:9000",
    S3_PUBLIC_ENDPOINT: "http://localhost:9000",
    S3_FORCE_PATH_STYLE: "true",
    S3_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test-secret",
  });
  const { createUploadTarget, createDownloadUrl } = await import("../lib/storage.js");
  const id = "a".repeat(32);

  const up = await createUploadTarget(id, 1234);
  const url = new URL(up.url);
  assert.equal(up.direct, true);
  assert.equal(url.host, "localhost:9000");
  assert.equal(url.pathname, `/pqchat-media/media/${id}`);
  assert.ok(url.searchParams.get("X-Amz-Signature"));
  assert.match(url.searchParams.get("X-Amz-SignedHeaders"), /content-length/, "size is part of the signature");

  const down = new URL(await createDownloadUrl(id));
  assert.equal(down.searchParams.get("X-Amz-Expires"), "60");
});
