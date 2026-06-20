// pages/_app.js
import "../styles/global.css";
import { useEffect } from "react";
import { Toaster } from "react-hot-toast";

export default function MyApp({ Component, pageProps }) {
  useEffect(() => {
    // ✅ Initialize Socket.IO server on first load
    const startSocketServer = async () => {
      try {
        await fetch("/api/socket");
        console.log("✅ Socket.IO server initialized");
      } catch (err) {
        console.warn("⚠️ Failed to initialize socket server:", err);
      }
    };
    startSocketServer();
  }, []);

  return (
    <>
      <Component {...pageProps} />
      <Toaster
        position="bottom-center"
        toastOptions={{
          duration: 3000,
          style: {
            background: "#333",
            color: "#fff",
          },
        }}
      />
    </>
  );
}
