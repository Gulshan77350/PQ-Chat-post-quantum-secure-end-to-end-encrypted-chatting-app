import { useState, useEffect, useRef, useCallback } from "react";
import { ShieldCheck, ShieldAlert, MoreVertical, X, KeyRound, Trash2, ArrowUpCircle } from "lucide-react";
import { useRouter } from "next/router";
import toast from "react-hot-toast";
import UserList from "../components/UserList";
import MessageBubble, { rememberPlaintext, rememberMedia, forgetMessage } from "../components/MessageBubble";
import ChatInput from "../components/ChatInput";
import SafetyNumberModal from "../components/SafetyNumberModal";
import SettingsModal from "../components/SettingsModal";
import useSocket from "../hooks/useSocket";
import { apiJson, apiFetch, ensureAccessToken, logout, AuthError } from "../lib/session";
import { loadPrivateKey, loadPublicKey, clearSessionKeys, encryptMessage, encryptMedia } from "../lib/pqcrypto";
import { checkPeerKey, acceptPeerKey, setPeerVerified } from "../lib/keyPinning";

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const STATUS_RANK = { failed: 0, sending: 1, sent: 2, delivered: 3, seen: 4 };

const newClientId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

/** Insert or replace by server id, falling back to the optimistic clientId. */
function upsert(list, msg) {
  const idx = list.findIndex((m) => (msg.id && m.id === msg.id) || (msg.clientId && m.clientId === msg.clientId));
  if (idx === -1) return [...list, msg];
  const prev = list[idx];
  // Never let a late event downgrade a status (e.g. "sent" arriving after "delivered").
  const status = STATUS_RANK[prev.status] > STATUS_RANK[msg.status] && prev.id ? prev.status : msg.status;
  const next = [...list];
  next[idx] = { ...prev, ...msg, status, clientId: prev.clientId || msg.clientId, _plaintext: undefined, _localMedia: msg._localMedia ?? (msg.media ? undefined : prev._localMedia) };
  return next;
}

export default function Chat() {
  const router = useRouter();
  const [me, setMe] = useState("");
  const [ready, setReady] = useState(false);
  const [ownKeyMismatch, setOwnKeyMismatch] = useState(false);

  const [conversations, setConversations] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState(() => new Set());
  const [selectedUser, setSelectedUser] = useState(null);
  const [peerKey, setPeerKey] = useState({ status: "idle" });
  const [messages, setMessages] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const selectedRef = useRef(null);
  const seenTimer = useRef(null);
  selectedRef.current = selectedUser;

  const goToLogin = useCallback((reason) => {
    if (reason) toast.error(reason);
    router.replace("/");
  }, [router]);

  // ── Session bootstrap: restore token from the refresh cookie ────
  useEffect(() => {
    const stored = sessionStorage.getItem("username");
    if (!stored) return goToLogin("Please login first");
    if (!loadPrivateKey(stored)) return goToLogin("Private key not loaded. Please sign in with your .pqkey file.");

    ensureAccessToken()
      .then(async () => {
        setMe(stored);
        setReady(true);
        // Detect server-side tampering with OUR OWN pinned key.
        const profile = await apiJson("/api/auth/me");
        setOwnKeyMismatch(!!profile.publicKey && profile.publicKey !== loadPublicKey(stored));
      })
      .catch(() => goToLogin("Session expired. Please sign in again."));
  }, [goToLogin]);

  const handleApiError = useCallback((err) => {
    if (err instanceof AuthError) return goToLogin("Session expired. Please sign in again.");
    console.error(err);
    toast.error(err.message || "Something went wrong");
  }, [goToLogin]);

  const socket = useSocket(ready, { onAuthError: () => goToLogin("Your session was signed out.") });

  const scrollToBottom = (smooth = true) =>
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });

  const fetchConversations = useCallback(async () => {
    try {
      setConversations(await apiJson("/api/messages/recent"));
    } catch (err) { handleApiError(err); }
  }, [handleApiError]);

  useEffect(() => { if (ready) fetchConversations(); }, [ready, fetchConversations]);

  const bumpConversation = (partner, { unseenDelta = 0 } = {}) => {
    setConversations((prev) => {
      const existing = prev.find((c) => c.username === partner) || { username: partner, unseen: 0 };
      const updated = { ...existing, lastAt: new Date().toISOString(), unseen: Math.max(0, (existing.unseen || 0) + unseenDelta) };
      return [updated, ...prev.filter((c) => c.username !== partner)];
    });
  };

  // Debounced so a burst of incoming messages produces one request.
  const scheduleMarkSeen = useCallback((partner) => {
    clearTimeout(seenTimer.current);
    seenTimer.current = setTimeout(() => {
      apiJson("/api/messages/mark-seen", { method: "POST", body: { with: partner } }).catch(handleApiError);
    }, 300);
  }, [handleApiError]);

  // ── Peer key: fetch + TOFU check ─────────────────────────────────
  const loadPeerKey = useCallback(async (username) => {
    setPeerKey({ status: "loading" });
    try {
      const info = await apiJson(`/api/users/${encodeURIComponent(username)}`);
      if (selectedRef.current?.username !== username) return;
      if (!info.publicKey) return setPeerKey({ status: "missing" });
      const check = checkPeerKey(me, username, info.publicKey, { keyVersion: info.keyVersion });
      setPeerKey({
        status: check.status === "changed" ? "changed" : "match",
        publicKey: info.publicKey,
        keyVersion: info.keyVersion,
        verified: check.status === "match" && !!check.pin.verified,
      });
      if (check.status === "changed") setShowSafetyModal(true);
    } catch (err) {
      setPeerKey({ status: "error" });
      handleApiError(err);
    }
  }, [me, handleApiError]);

  // ── Socket event wiring (re-subscribes whenever the socket object changes) ──
  useEffect(() => {
    if (!socket || !me) return;
    let typingTimeout;

    const onSnapshot = (list) => setOnlineUsers(new Set(list));
    const onOnline = ({ username }) => setOnlineUsers((s) => new Set(s).add(username));
    const onOffline = ({ username }) => setOnlineUsers((s) => { const n = new Set(s); n.delete(username); return n; });

    const onNew = (msg) => {
      const partner = msg.sender === me ? msg.receiver : msg.sender;
      const isIncoming = msg.receiver === me;
      if (isIncoming) socket.emit("messages:delivered", { ids: [msg.id] });

      const open = selectedRef.current?.username === partner;
      if (open) {
        setMessages((prev) => upsert(prev, msg));
        if (isIncoming) scheduleMarkSeen(partner);
        setTimeout(() => scrollToBottom(true), 30);
      }
      bumpConversation(partner, { unseenDelta: isIncoming && !open ? 1 : 0 });
    };

    const onUpdated = (msg) => {
      if (msg.deletedAt) forgetMessage(msg.id);
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? upsert(prev, msg) : prev));
    };

    const applyStatus = (status) => ({ ids, at }) => {
      const idSet = new Set(ids);
      setMessages((prev) => prev.map((m) =>
        idSet.has(m.id) && STATUS_RANK[status] > STATUS_RANK[m.status]
          ? { ...m, status, ...(status === "seen" ? { seenAt: at } : { deliveredAt: at }) }
          : m
      ));
    };

    const onCleared = ({ partner }) => {
      if (selectedRef.current?.username === partner) setMessages([]);
      fetchConversations();
    };

    const onTypingStart = ({ from }) => { clearTimeout(typingTimeout); setTypingUser(from); };
    const onTypingStop = () => { typingTimeout = setTimeout(() => setTypingUser(null), 400); };

    const onKeyChanged = ({ username }) => {
      if (username === selectedRef.current?.username) loadPeerKey(username);
      if (username === me) {
        apiJson("/api/auth/me")
          .then((p) => setOwnKeyMismatch(p.publicKey !== loadPublicKey(me)))
          .catch(() => {});
      }
    };

    const handlers = {
      "presence:snapshot": onSnapshot,
      "presence:online": onOnline,
      "presence:offline": onOffline,
      "message:new": onNew,
      "message:updated": onUpdated,
      "messages:delivered": applyStatus("delivered"),
      "messages:seen": applyStatus("seen"),
      "messages:cleared": onCleared,
      "typing:start": onTypingStart,
      "typing:stop": onTypingStop,
      "key:changed": onKeyChanged,
      connect: fetchConversations, // catch up on anything missed while disconnected
    };
    for (const [ev, fn] of Object.entries(handlers)) socket.on(ev, fn);
    return () => {
      clearTimeout(typingTimeout);
      for (const [ev, fn] of Object.entries(handlers)) socket.off(ev, fn);
    };
  }, [socket, me, fetchConversations, loadPeerKey, scheduleMarkSeen]);

  // ── History ──────────────────────────────────────────────────────
  const fetchChatHistory = async (partner, beforeCursor = null) => {
    if (beforeCursor) setLoadingMore(true);
    else { setLoadingMessages(true); setMessages([]); }

    try {
      let url = `/api/messages?with=${encodeURIComponent(partner)}&limit=50`;
      if (beforeCursor) url += `&before=${encodeURIComponent(beforeCursor)}`;
      const data = await apiJson(url);
      if (selectedRef.current?.username !== partner) return;

      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
      if (beforeCursor) {
        // Keep the viewport anchored when prepending older messages.
        const el = containerRef.current;
        const prevHeight = el?.scrollHeight || 0;
        setMessages((prev) => [...data.messages, ...prev]);
        requestAnimationFrame(() => { if (el) el.scrollTop += el.scrollHeight - prevHeight; });
      } else {
        setMessages(data.messages);
        setTimeout(() => scrollToBottom(false), 40);
        const undelivered = data.messages.filter((m) => m.receiver === me && m.status === "sent").map((m) => m.id);
        if (undelivered.length) socket?.emit("messages:delivered", { ids: undelivered });
        scheduleMarkSeen(partner);
      }
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoadingMessages(false);
      setLoadingMore(false);
    }
  };

  const handleSelectUser = (user) => {
    if (!user) return;
    setSelectedUser({ username: user.username });
    selectedRef.current = { username: user.username };
    setTypingUser(null);
    setEditing(null);
    setConversations((prev) => prev.map((c) => (c.username === user.username ? { ...c, unseen: 0 } : c)));
    loadPeerKey(user.username);
    fetchChatHistory(user.username);
  };

  // ── Encryption keys (only ever the pinned, accepted peer key) ────
  const encryptionKeys = () => {
    if (peerKey.status !== "match") throw new Error("Peer key not verified — cannot encrypt");
    const myPublicKey = loadPublicKey(me);
    if (!myPublicKey) throw new Error("Your private key is not loaded");
    return { receiverPublicKey: peerKey.publicKey, senderPublicKey: myPublicKey, sender: me, receiver: selectedUser.username };
  };

  const postMessage = async (optimistic, body) => {
    try {
      const saved = await apiJson("/api/messages", { method: "POST", body });
      if (body.text) rememberPlaintext(saved.id, optimistic._plaintext, saved.text);
      if (optimistic._localMedia) rememberMedia(saved.id, optimistic._localMedia);
      setMessages((prev) => upsert(prev, saved));
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.clientId === optimistic.clientId ? { ...m, status: "failed", _retryBody: body } : m)));
      handleApiError(err);
    }
  };

  const addOptimistic = (extra) => {
    const optimistic = {
      clientId: newClientId(),
      id: null,
      sender: me,
      receiver: selectedUser.username,
      status: "sending",
      createdAt: new Date().toISOString(),
      ...extra,
    };
    setMessages((prev) => [...prev, optimistic]);
    bumpConversation(selectedUser.username);
    setTimeout(() => scrollToBottom(true), 20);
    return optimistic;
  };

  const handleSendText = async (text) => {
    const keys = encryptionKeys();
    const optimistic = addOptimistic({ _plaintext: text, text: null });
    const env = await encryptMessage(text, keys);
    await postMessage(optimistic, {
      to: keys.receiver, clientId: optimistic.clientId, cryptoVersion: env.cryptoVersion,
      text: env.ciphertext, iv: env.iv, encryptedKey: env.encryptedKey, senderEncryptedKey: env.senderEncryptedKey,
    });
  };

  const handleSendFile = async (file, caption) => {
    const keys = encryptionKeys();
    const localMedia = { url: URL.createObjectURL(file), name: file.name, mimeType: file.type || "application/octet-stream", size: file.size };
    const optimistic = addOptimistic({ _localMedia: localMedia, _plaintext: caption || null, text: null });
    try {
      const env = await encryptMedia(await file.arrayBuffer(), { name: file.name, mimeType: localMedia.mimeType }, keys);
      // 1. reserve a slot, 2. upload ciphertext (directly to object storage when configured)
      const slot = await apiJson("/api/media", { method: "POST", body: { size: env.ciphertext.byteLength } });
      const uploadInit = { method: slot.upload.method, headers: slot.upload.headers, body: env.ciphertext };
      const up = slot.upload.direct ? await fetch(slot.upload.url, uploadInit) : await apiFetch(slot.upload.url, uploadInit);
      if (!up.ok) throw new Error("Upload failed");

      const body = {
        to: keys.receiver, clientId: optimistic.clientId, cryptoVersion: env.cryptoVersion,
        media: { id: slot.mediaId, iv: env.iv, encryptedKey: env.encryptedKey, senderEncryptedKey: env.senderEncryptedKey },
      };
      if (caption) {
        const t = await encryptMessage(caption, keys);
        Object.assign(body, { text: t.ciphertext, iv: t.iv, encryptedKey: t.encryptedKey, senderEncryptedKey: t.senderEncryptedKey });
      }
      await postMessage(optimistic, body);
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.clientId === optimistic.clientId ? { ...m, status: "failed" } : m)));
      handleApiError(err);
    }
  };

  const handleRetry = (msg) => {
    if (!msg._retryBody) return toast.error("Please resend this message");
    setMessages((prev) => prev.map((m) => (m.clientId === msg.clientId ? { ...m, status: "sending" } : m)));
    postMessage(msg, msg._retryBody);
  };

  const handleSubmitEdit = async (text) => {
    const target = editing;
    const keys = encryptionKeys();
    const env = await encryptMessage(text, keys);
    const saved = await apiJson(`/api/messages/${target.id}`, {
      method: "PATCH",
      body: { cryptoVersion: env.cryptoVersion, text: env.ciphertext, iv: env.iv, encryptedKey: env.encryptedKey, senderEncryptedKey: env.senderEncryptedKey },
    });
    rememberPlaintext(saved.id, text, saved.text);
    setMessages((prev) => upsert(prev, saved));
    setEditing(null);
  };

  const handleDelete = async (msg) => {
    if (!confirm("Delete this message for everyone?")) return;
    try {
      const saved = await apiJson(`/api/messages/${msg.id}`, { method: "DELETE" });
      forgetMessage(msg.id);
      setMessages((prev) => upsert(prev, saved));
      if (editing?.id === msg.id) setEditing(null);
    } catch (err) { handleApiError(err); }
  };

  const handleClearChat = async () => {
    if (!selectedUser) return;
    setShowDropdown(false);
    if (!confirm(`Permanently delete your entire conversation with ${selectedUser.username} for both of you?`)) return;
    try {
      await apiJson("/api/messages/clear", { method: "POST", body: { with: selectedUser.username } });
      setMessages([]);
      toast.success("Chat history cleared");
    } catch (err) { handleApiError(err); }
  };

  const handleAcceptNewKey = () => {
    acceptPeerKey(me, selectedUser.username, peerKey.publicKey, { keyVersion: peerKey.keyVersion });
    setPeerKey((k) => ({ ...k, status: "match", verified: false }));
    setShowSafetyModal(false);
    toast.success(`New key for ${selectedUser.username} accepted. Verify the safety number when you can.`);
  };

  const handleToggleVerified = () => {
    const next = !peerKey.verified;
    setPeerVerified(me, selectedUser.username, next);
    setPeerKey((k) => ({ ...k, verified: next }));
    toast.success(next ? `Marked ${selectedUser.username} as verified` : "Verification removed");
  };

  const handleLogout = async () => {
    await logout();
    clearSessionKeys(me);
    sessionStorage.removeItem("username");
    router.replace("/");
  };

  // Auto-scroll only when a message is appended at the bottom (not when paging older ones).
  const lastKey = messages.length ? messages[messages.length - 1].clientId || messages[messages.length - 1].id : null;
  useEffect(() => {
    const t = setTimeout(() => scrollToBottom(true), 40);
    return () => clearTimeout(t);
  }, [lastKey]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const peerOnline = selectedUser && onlineUsers.has(selectedUser.username);
  const keyChanged = peerKey.status === "changed";
  const disabledReason =
    keyChanged ? `${selectedUser?.username}'s safety number changed. Review it before sending.`
    : peerKey.status === "missing" ? `${selectedUser?.username} has no encryption key.`
    : peerKey.status === "loading" ? "Loading encryption keys…"
    : peerKey.status === "error" ? "Could not load encryption keys."
    : null;

  return (
    <div className="app-shell">
      <UserList
        conversations={conversations}
        onlineUsers={onlineUsers}
        username={me}
        activeUser={selectedUser}
        typingUser={typingUser}
        onSelectUser={handleSelectUser}
        onLogout={handleLogout}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="chat-main">
        {ownKeyMismatch && (
          <div className="flex items-center gap-2 text-xs text-rose-200 bg-rose-950/70 border-b border-rose-900 px-4 py-2">
            <ShieldAlert size={14} className="shrink-0" />
            The server is publishing a public key for you that does not match your key file. Someone may be intercepting messages sent to you.
          </div>
        )}

        {selectedUser ? (
          <>
            <div className="chat-header">
              <div className="chat-header-left">
                <div className="chat-avatar">
                  {selectedUser.username[0]?.toUpperCase()}
                  <span className={`chat-dot ${peerOnline ? "online" : "offline"}`} />
                </div>
                <div>
                  <h2 className="chat-peer">{selectedUser.username}</h2>
                  <p className="chat-status">
                    {typingUser === selectedUser.username ? "typing…" : peerOnline ? (<><span className="status-dot-green" />Online</>) : "Offline"}
                  </p>
                </div>
              </div>

              <div className="chat-header-right">
                <button
                  onClick={() => setShowSafetyModal(true)}
                  className={`e2e-pill cursor-pointer active:scale-95 ${keyChanged ? "!border-rose-500/60 !text-rose-300" : "hover:border-emerald-400/60"}`}
                  title="View safety number"
                >
                  {keyChanged ? <ShieldAlert size={12} className="text-rose-400" /> : <KeyRound size={12} className="text-emerald-400" />}
                  <span>{keyChanged ? "Key changed" : peerKey.verified ? "Verified" : "PQC E2EE"}</span>
                </button>

                <div ref={dropdownRef} className="relative">
                  <button onClick={() => setShowDropdown((s) => !s)} className="icon-btn" aria-label="Chat menu">
                    <MoreVertical size={18} />
                  </button>
                  {showDropdown && (
                    <div className="header-dropdown">
                      <button onClick={() => { setShowSafetyModal(true); setShowDropdown(false); }} className="dropdown-item">
                        <ShieldCheck size={14} className="text-emerald-400" /> Safety Number
                      </button>
                      <button onClick={handleClearChat} className="dropdown-item text-rose-400 hover:text-rose-300">
                        <Trash2 size={14} /> Clear Chat
                      </button>
                      <button onClick={() => { setSelectedUser(null); setMessages([]); setShowDropdown(false); }} className="dropdown-item">
                        <X size={14} /> Close Chat
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {keyChanged && (
              <button
                onClick={() => setShowSafetyModal(true)}
                className="flex items-center gap-2 text-xs text-rose-200 bg-rose-950/60 border-b border-rose-900 px-4 py-2 text-left hover:bg-rose-950/80"
              >
                <ShieldAlert size={14} className="shrink-0" />
                Your safety number with {selectedUser.username} changed. Tap to review before sending messages.
              </button>
            )}

            <div ref={containerRef} className="messages-area">
              {hasMore && (
                <div className="text-center py-2">
                  <button
                    onClick={() => fetchChatHistory(selectedUser.username, nextCursor)}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-1.5 text-xs bg-slate-800/90 hover:bg-slate-700 text-emerald-400 px-3 py-1.5 rounded-full border border-emerald-500/20 shadow-md active:scale-95 disabled:opacity-50"
                  >
                    {loadingMore ? <span className="spinner" /> : <ArrowUpCircle size={14} />}
                    {loadingMore ? "Loading..." : "Load earlier messages"}
                  </button>
                </div>
              )}

              {loadingMessages ? (
                <div className="msg-loading"><span className="spinner" /></div>
              ) : messages.length > 0 ? (
                messages.map((msg) => (
                  <MessageBubble
                    key={msg.clientId || msg.id}
                    msg={msg}
                    currentUser={me}
                    canEdit={!!msg.id && Date.now() - new Date(msg.createdAt).getTime() < EDIT_WINDOW_MS && peerKey.status === "match"}
                    onEdit={(m, text) => setEditing({ id: m.id, text })}
                    onDelete={handleDelete}
                    onRetry={handleRetry}
                  />
                ))
              ) : (
                <div className="msg-empty">
                  <ShieldCheck size={32} className="text-emerald-500/40 mx-auto mb-3" />
                  <p>End-to-end encrypted</p>
                  <p className="text-sm opacity-60 mt-1">Messages and files are secured with post-quantum cryptography</p>
                </div>
              )}

              {typingUser === selectedUser.username && (
                <div className="typing-indicator">
                  <div className="typing-bubble"><span /><span /><span /></div>
                  <span className="typing-label">{selectedUser.username} is typing…</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="input-area">
              <ChatInput
                onSendText={(t) => handleSendText(t).catch(handleApiError)}
                onSendFile={(f, c) => handleSendFile(f, c).catch(handleApiError)}
                onSubmitEdit={handleSubmitEdit}
                editing={editing}
                onCancelEdit={() => setEditing(null)}
                disabledReason={disabledReason}
                onTypingStart={() => socket?.emit("typing:start", { to: selectedUser.username })}
                onTypingStop={() => socket?.emit("typing:stop", { to: selectedUser.username })}
              />
            </div>
          </>
        ) : (
          <div className="no-chat-selected">
            <div className="no-chat-icon"><ShieldCheck size={48} className="text-emerald-500/50" /></div>
            <h3>Select a conversation</h3>
            <p>Messages and files are secured with ML-KEM (Kyber) post-quantum encryption</p>
          </div>
        )}
      </div>

      <SafetyNumberModal
        isOpen={showSafetyModal && !!selectedUser}
        onClose={() => setShowSafetyModal(false)}
        currentUser={me}
        myPublicKey={me ? loadPublicKey(me) : null}
        peerUsername={selectedUser?.username}
        peerPublicKey={peerKey.publicKey}
        verified={peerKey.verified}
        keyChanged={keyChanged}
        onToggleVerified={handleToggleVerified}
        onAcceptNewKey={handleAcceptNewKey}
      />

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        username={me}
        onKeyRotated={() => setOwnKeyMismatch(false)}
      />
    </div>
  );
}
