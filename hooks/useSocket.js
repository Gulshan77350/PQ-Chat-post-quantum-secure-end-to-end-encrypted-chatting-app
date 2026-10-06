import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { ensureAccessToken, refreshAccessToken } from "../lib/session";

/**
 * Opens an authenticated Socket.IO connection while `enabled` is true.
 * The socket is held in React state (not a ref) so consumers re-render and re-subscribe
 * when it changes — this keeps it correct under React Strict Mode's mount/unmount/mount.
 * `onAuthError` fires when the server rejects the handshake (session revoked/expired).
 */
export default function useSocket(enabled, { onAuthError } = {}) {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!enabled) return;

    const s = io({
      // WebSocket-only: no long-polling, so no sticky sessions are needed behind a load balancer.
      transports: ["websocket"],
      // Called on every (re)connect, so reconnections always present a fresh token.
      auth: (cb) => {
        ensureAccessToken()
          .then((token) => cb({ token }))
          .catch(() => cb({ token: null }));
      },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    s.on("connect_error", (err) => {
      // Middleware rejections don't auto-retry: mint a new token (the cached one may
      // belong to a revoked session) and reconnect, or give up if the session is gone.
      if (err?.message === "unauthorized") {
        refreshAccessToken()
          .then(() => s.connect())
          .catch(() => {
            s.disconnect();
            onAuthError?.();
          });
      }
    });

    // The server disconnects us when the access token expires or the session is
    // revoked; reconnect (the auth callback fetches a new token or fails cleanly).
    s.on("disconnect", (reason) => {
      if (reason === "io server disconnect") setTimeout(() => s.connect(), 500);
    });

    setSocket(s);
    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return socket;
}
