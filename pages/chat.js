import { useState, useEffect, useRef } from "react";
import { ShieldCheck, MoreVertical, X } from "lucide-react";
import UserList from "../components/UserList";
import MessageBubble from "../components/MessageBubble";
import ChatInput from "../components/ChatInput";
import { useRouter } from "next/router";
import toast from "react-hot-toast";
import useSocket from "../hooks/useSocket";

export default function Chat() {
  const [username, setUsername] = useState("");
  const [allUsers, setAllUsers] = useState([]);
  const [recentUsers, setRecentUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const router = useRouter();
  const chatContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const dropdownRef = useRef(null);

  const { socket, onMessageNew, onUsersChanged, onPresenceChange, onTypingStart, onTypingStop, onMessagesSeen, onConnected } = useSocket(username);

  useEffect(() => {
    const stored = sessionStorage.getItem("username");
    if (stored) setUsername(stored);
    else { toast.error("Please login first"); router.replace("/"); }
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
        setMessages((prev) => [...prev, {
          sender: { username: msg.sender },
          receiver: { username: msg.receiver },
          text: msg.text,
          iv: msg.iv,
          encryptedKey: msg.encryptedKey,
          mediaData: msg.mediaData,
          mediaIv: msg.mediaIv,
          mediaEncKey: msg.mediaEncKey,
          mediaName: msg.mediaName,
          mediaMimeType: msg.mediaMimeType,
          mediaSize: msg.mediaSize,
          type: msg.type,
          createdAt: msg.createdAt,
          seen: true,
        }]);
        socket?.emit("messages:seen", { from: msg.sender, by: username });
        fetch("/api/messages/mark-seen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user1: username, user2: msg.sender }),
        }).catch(console.error);
        setTimeout(() => scrollToBottom(true), 30);
      } else {
        setRecentUsers((prev) => prev.map((u) => u.username === partner ? { ...u, unseen: (u.unseen || 0) + 1 } : u));
      }
    });

    let typingTimeout;
    onTypingStart(({ from }) => { if (from !== username) { setTypingUser(from); clearTimeout(typingTimeout); } });
    onTypingStop(({ from }) => { if (from !== username) { typingTimeout = setTimeout(() => setTypingUser(null), 500); } });
    onMessagesSeen(({ from }) => { if (from === selectedUser?.username) setMessages((prev) => prev.map((m) => ({ ...m, seen: true }))); });

    return () => clearTimeout(typingTimeout);
  }, [socket, username, selectedUser]);

  const fetchChatHistory = async (partner) => {
    if (!username || !partner) return;
    setLoadingMessages(true);
    setMessages([]);
    try {
      const res = await fetch(`/api/message?user1=${encodeURIComponent(username)}&user2=${encodeURIComponent(partner.username)}`);
      const data = res.ok ? await res.json() : [];
      setMessages(data || []);
      await fetch("/api/messages/mark-seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user1: username, user2: partner.username }),
      });
      setTimeout(() => scrollToBottom(false), 40);
    } catch (err) { console.error(err); }
    finally { setLoadingMessages(false); }
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

  const handleSend = async ({ ciphertext, iv, encryptedKey, plaintext }) => {
    if (!selectedUser || !ciphertext) return;
    // Optimistic update — show plaintext for sender, ciphertext stored in DB
    setMessages((prev) => [...prev, {
      sender: { username },
      receiver: { username: selectedUser.username },
      text: plaintext,
      iv:null,
      encryptedKey:null,
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
        }),
      });
    } catch (err) { console.error(err); }
  };

  const handleSendMedia = async ({ text, textIv, textEncryptedKey, mediaData, iv, encryptedKey, mediaName, mediaMimeType, mediaSize, type }) => {
    if (!selectedUser) return;
    setMessages((prev) => [...prev, {
      sender: { username },
      receiver: { username: selectedUser.username },
      text,
      iv: textIv,
      encryptedKey: textEncryptedKey,
      mediaData,
      mediaIv: iv,
      mediaEncKey: encryptedKey,
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
          mediaData,
          mediaIv: iv,
          mediaEncKey: encryptedKey,
          mediaName,
          mediaMimeType,
          mediaSize,
          type,
        }),
      });
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    const t = setTimeout(() => scrollToBottom(true), 40);
    return () => clearTimeout(t);
  }, [messages]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  return (
    <div className="app-shell">
      <UserList
        users={recentUsers}
        allUsers={allUsers}
        username={username}
        activeUser={selectedUser}
        typingUser={typingUser}
        onSelectUser={handleSelectUser}
      />

      <main className="chat-main">
        {selectedUser ? (
          <>
            {/* HEADER */}
            <header className="chat-header">
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
                <div className="e2e-pill">
                  <ShieldCheck size={12} />
                  <span>Post-Quantum E2E</span>
                </div>

                <div ref={dropdownRef} className="relative">
                  <button onClick={() => setShowDropdown((s) => !s)} className="icon-btn">
                    <MoreVertical size={18} />
                  </button>
                  {showDropdown && (
                    <div className="header-dropdown">
                      <button onClick={() => { setSelectedUser(null); setMessages([]); setShowDropdown(false); }} className="dropdown-item">
                        <X size={14} /> Close Chat
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </header>

            {/* MESSAGES */}
            <div className="messages-area" ref={chatContainerRef}>
              {loadingMessages ? (
                <div className="msg-loading">
                  <span className="loading-dots"><span/><span/><span/></span>
                </div>
              ) : messages.length > 0 ? (
                messages.map((msg, i) => (
                  <MessageBubble
                    key={i}
                    text={msg.text}
                    iv={msg.iv}
                    encryptedKey={msg.encryptedKey}
                    from={msg.sender?.username === username ? "me" : msg.sender?.username}
                    createdAt={msg.createdAt}
                    seen={msg.seen}
                    type={msg.type}
                    mediaData={msg.mediaData}
                    mediaIv={msg.mediaIv}
                    mediaEncKey={msg.mediaEncKey}
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
      </main>
    </div>
  );
}
