// server.js — single entry point: Next.js pages/API + Socket.IO on one HTTP server.
import { createServer } from "http";
import next from "next";
import dotenv from "dotenv";
import db from "./lib/db.js";
import { initIO } from "./lib/socket.js";

dotenv.config();

const dev = process.env.NODE_ENV !== "production" && !process.argv.includes("--production");
if (!dev) process.env.NODE_ENV = "production";
const port = parseInt(process.env.PORT, 10) || 3000;

async function main() {
  // Fail closed: refuse to start without the secrets the security model depends on.
  for (const name of ["MONGO_URI", "JWT_SECRET"]) {
    if (!process.env[name]) throw new Error(`Missing ${name} in environment variables`);
  }
  if (!dev && process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }

  const app = next({ dev });
  const handle = app.getRequestHandler();
  await app.prepare();

  await db();
  console.log("✅ Connected to MongoDB");

  const server = createServer((req, res) => handle(req, res));
  await initIO(server);

  server.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port} (${dev ? "development" : "production"})`);
  });
}

main().catch((error) => {
  console.error("❌ Server startup error:", error);
  process.exit(1);
});
