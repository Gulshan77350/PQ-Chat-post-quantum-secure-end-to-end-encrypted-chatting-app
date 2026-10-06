import mongoose from "mongoose";

// Cached on globalThis: Next bundles API routes separately from server.js, and dev-mode
// hot reload re-evaluates modules, so module-scoped state would open extra connections.
export default async function db() {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!globalThis._mongooseConnectionPromise) {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error("Missing MONGO_URI in environment variables");
    globalThis._mongooseConnectionPromise = mongoose
      .connect(uri, { serverSelectionTimeoutMS: 5000 })
      .catch((err) => {
        globalThis._mongooseConnectionPromise = null;
        throw err;
      });
  }
  return globalThis._mongooseConnectionPromise;
}
