import { useState, useEffect, useRef } from "react";
import { ShieldCheck, MoreVertical, X, KeyRound, Trash2, ArrowUpCircle } from "lucide-react";
import UserList from "../components/UserList";
import MessageBubble from "../components/MessageBubble";
import ChatInput from "../components/ChatInput";
import SafetyNumberModal from "../components/SafetyNumberModal";
import { useRouter } from "next/router";
import toast from "react-hot-toast";
import useSocket from "../hooks/useSocket";
import { loadPrivateKey, loadPublicKey } from "../lib/pqcrypto";

export default function Chat() {
  const [username, setUsername] = useState("");
  const [allUsers, setAllUsers] = useState([]);
  const [recentUsers, setRecentUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);

  const router = useRouter();
  const chatContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const dropdownRef = useRef(null);

  const { socket, onMessageNew, onUsersChanged, onPresenceChange, onTypingStart, onTypingStop, onMessagesSeen, onMessagesCleared, onConnected } = useSocket(username);

  useEffect(() => {
    const stored = sessionStorage.getItem("username");
    if (!stored) {
      toast.error("Please login first");
      router.replace("/");
      return;
    }
    const privKey = loadPrivateKey(stored);
    if (!privKey) {
      toast.error("Private key session expired. Please sign in with your .pqkey file.");
      router.replace("/");
      return;
    }
    const pubKey = loadPublicKey(stored);
    if (pubKey) {
      fetch("/api/users/sync-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: stored, publicKey: pubKey }),
      }).catch(console.error);
    }
    setUsername(stored);
  }, [router]);

  const scrollToBottom = (smooth = true) =>
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });

  const movePartnerToTop = (partnerUsername) => {
    setRecentUsers((prev) => {
      const uname = partnerUsername?.username || partnerUsername;
      if (!uname) return prev;
      const existing = prev.find((u) => u.username === uname) || { username: uname };
      const filtered = prev.filter((u) => u.username !== uname);
      return [existing, ...filtered];
    });
  };

  const fetchAllUsers = async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) setAllUsers(await res.json());
    } catch (err) { console.error(err); }
  };

  const fetchRecentUsers = async () => {
    if (!username) return;
    try {
      const res = await fetch(`/api/message?user1=${encodeURIComponent(username)}&recent=true`);
      if (res.ok) setRecentUsers(await res.json());
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchAllUsers(); }, []);
  useEffect(() => { if (username) fetchRecentUsers(); }, [username]);

  useEffect(() => {
    if (!socket || !username) return;
    onUsersChanged(fetchAllUsers);
    onConnected(() => { fetchAllUsers(); fetchRecentUsers(); });

    onPresenceChange(({ username: u, socketId, status }) => {
      const update = (list) => list.map((x) => x.username === u ? { ...x, online: status === "online", socketId } : x);
      setAllUsers(update);
      setRecentUsers(update);
      setSelectedUser((prev) => prev && prev.username === u ? { ...prev, online: status === "online", socketId } : prev);
    });

    onMessageNew((msg) => {
      if (msg.sender !== username && msg.receiver !== username) return;
      const partner = msg.sender === username ? msg.receiver : msg.sender;
      movePartnerToTop(partner);

      if (selectedUser && partner === selectedUser.username) {
        setMessages((prev) => {
          if (msg.sender === username) {
            const hasOptimistic = prev.some((m) => m._optimistic);
            if (hasOptimistic) {
              return prev.map((m) => m._optimistic ? {
                _id: msg.id || msg._id,
                sender: { username: msg.sender },
                receiver: { username: msg.receiver },
                text: msg.text,
                iv: msg.iv,
                encryptedKey: msg.encryptedKey,
                senderEncryptedKey: msg.senderEncryptedKey,
                mediaData: msg.mediaData,
                mediaIv: msg.mediaIv,
                mediaEncKey: msg.mediaEncKey,
                senderMediaEncKey: msg.senderMediaEncKey,
                mediaName: msg.mediaName,
                mediaMimeType: msg.mediaMimeType,
                mediaSize: msg.mediaSize,
                type: msg.type,
                createdAt: msg.createdAt,
                seen: msg.seen,
              } : m);
            }
          }
          if (prev.some((m) => (m._id && (m._id === msg.id || m._id === msg._id)))) {
            return prev;
          }
          return [...prev, {
            _id: msg.id || msg._id,
            sender: { username: msg.sender },
            receiver: { username: msg.receiver },
            text: msg.text,
            iv: msg.iv,
            encryptedKey: msg.encryptedKey,
            senderEncryptedKey: msg.senderEncryptedKey,
            mediaData: msg.mediaData,
            mediaIv: msg.mediaIv,
            mediaEncKey: msg.mediaEncKey,
            senderMediaEncKey: msg.senderMediaEncKey,
            mediaName: msg.mediaName,
            mediaMimeType: msg.mediaMimeType,
            mediaSize: msg.mediaSize,
            type: msg.type,
            createdAt: msg.createdAt,
            seen: true,
          }];
        });
        if (msg.sender !== username) {
          socket?.emit("messages:seen", { from: msg.sender, by: username });
          fetch("/api/messages/mark-seen", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user1: username, user2: msg.sender }),
          }).catch(console.error);
        }
        setTimeout(() => scrollToBottom(true), 30);
      } else {
        setRecentUsers((prev) => prev.map((u) => u.username === partner ? { ...u, unseen: (u.unseen || 0) + 1 } : u));
      }
    });

    let typingTimeout;
    onTypingStart(({ from }) => { if (from !== username) { setTypingUser(from); clearTimeout(typingTimeout); } });
    onTypingStop(({ from }) => { if (from !== username) { typingTimeout = setTimeout(() => setTypingUser(null), 500); } });
    onMessagesSeen(({ from }) => { if (from === selectedUser?.username) setMessages((prev) => prev.map((m) => ({ ...m, seen: true }))); });
    onMessagesCleared(({ by, partner }) => {
      if (partner === username || partner === selectedUser?.username) {
        setMessages([]);
        toast.success("Chat history cleared");
      }
    });

    return () => clearTimeout(typingTimeout);
  }, [socket, username, selectedUser]);

  const fetchChatHistory = async (partner, beforeCursor = null) => {
    if (!username || !partner) return;

    if (beforeCursor) {
      setLoadingMore(true);
    } else {
      setLoadingMessages(true);
      setMessages([]);
    }

    try {
      let url = `/api/message?user1=${encodeURIComponent(username)}&user2=${encodeURIComponent(partner.username)}&limit=50`;
      if (beforeCursor) url += `&before=${encodeURIComponent(beforeCursor)}`;

      const res = await fetch(url);
      const data = res.ok ? await res.json() : {};

      const fetchedMsgs = Array.isArray(data) ? data : (data.messages || []);
      const more = data.hasMore || false;
      const cursor = data.nextCursor || null;

      setHasMore(more);
      setNextCursor(cursor);

      if (beforeCursor) {
        setMessages((prev) => [...fetchedMsgs, ...prev]);
      } else {
        setMessages(fetchedMsgs);
        setTimeout(() => scrollToBottom(false), 40);
      }

      await fetch("/api/messages/mark-seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user1: username, user2: partner.username }),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMessages(false);
      setLoadingMore(false);
    }
  };

  const handleSelectUser = async (user) => {
    if (!user) return;
    setSelectedUser(user);
    setTypingUser(null);
    setRecentUsers((prev) => prev.map((u) => u.username === user.username ? { ...u, unseen: 0 } : u));
    try {
      await fetch("/api/messages/mark-seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user1: username, user2: user.username }),
      });
      socket?.emit("messages:seen", { from: user.username, by: username });
    } catch (err) { console.error(err); }
    await fetchChatHistory(user);
  };

  const handleSend = async ({ ciphertext, iv, encryptedKey, senderEncryptedKey, plaintext }) => {
    if (!selectedUser || !ciphertext) return;
    try { localStorage.setItem("pqc_sent_" + ciphertext, plaintext); } catch (e) {}
    setMessages((prev) => [...prev, {
      sender: { username },
      receiver: { username: selectedUser.username },
      text: plaintext,
      iv: null,
      encryptedKey: null,
      senderEncryptedKey: null,
      type: "text",
      createdAt: new Date().toISOString(),
      _optimistic: true,
    }]);
    movePartnerToTop(selectedUser.username);
    scrollToBottom(true);
    try {
      await fetch("/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderUsername: username,
          receiverUsername: selectedUser.username,
          text: ciphertext,
          iv,
          encryptedKey,
          senderEncryptedKey,
        }),
      });
    } catch (err) { console.error(err); }
  };

  const handleSendMedia = async ({ text, textIv, textEncryptedKey, senderTextEncryptedKey, mediaData, iv, encryptedKey, senderMediaEncKey, mediaName, mediaMimeType, mediaSize, type }) => {
    if (!selectedUser) return;
    setMessages((prev) => [...prev, {
      sender: { username },
      receiver: { username: selectedUser.username },
      text,
      iv: textIv,
      encryptedKey: textEncryptedKey,
      senderEncryptedKey: senderTextEncryptedKey,
      mediaData,
      mediaIv: iv,
      mediaEncKey: encryptedKey,
      senderMediaEncKey,
      mediaName,
      mediaMimeType,
      mediaSize,
      type,
      createdAt: new Date().toISOString(),
    }]);
    movePartnerToTop(selectedUser.username);
    scrollToBottom(true);
    try {
      await fetch("/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderUsername: username,
          receiverUsername: selectedUser.username,
          text,
          iv: textIv,
          encryptedKey: textEncryptedKey,
          senderEncryptedKey: senderTextEncryptedKey,
          mediaData,
          mediaIv: iv,
          mediaEncKey: encryptedKey,
          senderMediaEncKey,
          mediaName,
          mediaMimeType,
          mediaSize,
          type,
        }),
      });
    } catch (err) { console.error(err); }
  };

  const handleClearChat = async () => {
    if (!selectedUser) return;
    if (!confirm(`Are you sure you want to clear all chat history with ${selectedUser.username}? This will permanently delete messages from the database.`)) {
      return;
    }
    setShowDropdown(false);
    try {
      const res = await fetch("/api/messages/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user1: username, user2: selectedUser.username }),
      });
      if (res.ok) {
        setMessages([]);
        toast.success("Chat history cleared from database");
      } else {
        toast.error("Failed to clear chat");
      }
    } catch (err) {
      console.error("Clear chat error:", err);
      toast.error("Failed to clear chat");
    }
  };

  useEffect(() => {
    const t = setTimeout(() => scrollToBottom(true), 40);
    return () => clearTimeout(t);
  }, [messages.length]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  return (
    <div className="app-shell">
      {/* SIDEBAR */}
      <UserList
        users={recentUsers}
        allUsers={allUsers}
        username={username}
        activeUser={selectedUser}
        typingUser={typingUser}
        onSelectUser={handleSelectUser}
      />

      {/* CHAT MAIN */}
      <div className="chat-main">
        {selectedUser ? (
          <>
            {/* HEADER */}
            <div className="chat-header">
              <div className="chat-header-left">
                <div className="chat-avatar">
                  {selectedUser.username[0]?.toUpperCase()}
                  <span className={`chat-dot ${selectedUser.online ? "online" : "offline"}`} />
                </div>
                <div>
                  <h2 className="chat-peer">{selectedUser.username}</h2>
                  <p className="chat-status">
                    {selectedUser.online ? (
                      <><span className="status-dot-green" />Online</>
                    ) : "Offline"}
                  </p>
                </div>
              </div>

              <div className="chat-header-right">
                <button
                  onClick={() => setShowSafetyModal(true)}
                  className="e2e-pill hover:border-emerald-400/60 cursor-pointer transition-all active:scale-95"
                  title="Click to view Safety Number"
                >
                  <KeyRound size={12} className="text-emerald-400" />
                  <span>PQC Non-Custodial</span>
                </button>

                <div ref={dropdownRef} className="relative">
                  <button onClick={() => setShowDropdown((s) => !s)} className="icon-btn">
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

            {/* MESSAGES */}
            <div ref={chatContainerRef} className="messages-area">
              {hasMore && (
                <div className="text-center py-2">
                  <button
                    onClick={() => fetchChatHistory(selectedUser, nextCursor)}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-1.5 text-xs bg-slate-800/90 hover:bg-slate-700 text-emerald-400 px-3 py-1.5 rounded-full border border-emerald-500/20 transition-all shadow-md active:scale-95 disabled:opacity-50"
                  >
                    {loadingMore ? <span className="spinner" /> : <ArrowUpCircle size={14} />}
                    {loadingMore ? "Loading..." : "Load earlier messages"}
                  </button>
                </div>
              )}

              {loadingMessages ? (
                <div className="msg-loading">
                  <span className="spinner" />
                </div>
              ) : messages.length > 0 ? (
                messages.map((msg, i) => (
                  <MessageBubble
                    key={msg._id || i}
                    text={msg.text}
                    iv={msg.iv}
                    encryptedKey={msg.encryptedKey}
                    senderEncryptedKey={msg.senderEncryptedKey}
                    from={msg.sender?.username === username ? "me" : msg.sender?.username}
                    seen={msg.seen}
                    createdAt={msg.createdAt}
                    type={msg.type}
                    mediaData={msg.mediaData}
                    mediaIv={msg.mediaIv}
                    mediaEncKey={msg.mediaEncKey}
                    senderMediaEncKey={msg.senderMediaEncKey}
                    mediaMimeType={msg.mediaMimeType}
                    mediaName={msg.mediaName}
                    mediaSize={msg.mediaSize}
                    currentUser={username}
                  />
                ))
              ) : (
                <div className="msg-empty">
                  <ShieldCheck size={32} className="text-emerald-500/40 mx-auto mb-3" />
                  <p>End-to-end encrypted</p>
                  <p className="text-sm opacity-60 mt-1">Messages and files are secured with post-quantum cryptography</p>
                </div>
              )}

              {typingUser === selectedUser?.username && (
                <div className="typing-indicator">
                  <div className="typing-bubble">
                    <span /><span /><span />
                  </div>
                  <span className="typing-label">{selectedUser.username} is typing…</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* INPUT */}
            <div className="input-area">
              <ChatInput
                receiverUsername={selectedUser?.username}
                onSend={handleSend}
                onSendMedia={handleSendMedia}
                onTypingStart={() => socket?.emit("typing:start", { to: selectedUser.username, from: username })}
                onTypingStop={() => socket?.emit("typing:stop", { to: selectedUser.username, from: username })}
              />
            </div>
          </>
        ) : (
          <div className="no-chat-selected">
            <div className="no-chat-icon">
              <ShieldCheck size={48} className="text-emerald-500/50" />
            </div>
            <h3>Select a conversation</h3>
            <p>Messages and files are secured with CRYSTALS-Kyber post-quantum encryption</p>
          </div>
        )}
      </div>

      {/* SAFETY NUMBER MODAL */}
      <SafetyNumberModal
        isOpen={showSafetyModal}
        onClose={() => setShowSafetyModal(false)}
        currentUser={username}
        peerUser={selectedUser}
      />
    </div>
  );
}
