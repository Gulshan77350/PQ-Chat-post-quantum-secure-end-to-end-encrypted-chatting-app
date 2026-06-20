import mongoose from "mongoose";

const onlineUri = process.env.MONGO_URI;
const offlineUri = process.env.MONGO_URI_LOCAL || process.env.MONGO_URI;
const useOnline = process.env.USE_ONLINE_DB === "true";

const uri = useOnline ? onlineUri : offlineUri;

// Prevent re-connection in Next.js hot reload or multiple API calls
if (!global._mongooseConnectionPromise) {
  global._mongooseConnectionPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 5000,
    })
    .then((conn) => {
      console.log(
        `✅ Connected to ${useOnline ? "Online" : "Offline"} MongoDB (${
          conn.connection.name
        })`
      );
      return conn;
    })
    .catch((err) => {
      console.error("❌ MongoDB connection error:", err);
      throw err;
    });
}

// Export the active connection (await db() before use)
export default async function db() {
  return global._mongooseConnectionPromise;
}
