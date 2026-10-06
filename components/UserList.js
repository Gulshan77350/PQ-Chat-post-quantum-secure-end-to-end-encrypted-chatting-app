import { Search, MoreVertical, LogOut, ShieldCheck, Settings } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiJson } from "../lib/session";

export default function UserList({
  conversations = [], onlineUsers, onSelectUser, username = "", activeUser = null, typingUser = null,
  onLogout, onOpenSettings,
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);

  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (buttonRef.current?.contains(event.target)) return;
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setShowDropdown(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced server-side search (the server escapes the query and caps results).
  useEffect(() => {
    const q = searchTerm.trim();
    if (!q) { setResults([]); return; }
    let active = true;
    const t = setTimeout(() => {
      apiJson(`/api/users?q=${encodeURIComponent(q)}`)
        .then((list) => active && setResults(list.filter((u) => u.username !== username)))
        .catch(() => active && setResults([]));
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [searchTerm, username]);

  const isOnline = (u) => onlineUsers?.has(u);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <ShieldCheck size={18} className="text-emerald-400" />
          <span className="brand-name">PQChat</span>
        </div>
        <div className="relative">
          <button ref={buttonRef} onClick={() => setShowDropdown((p) => !p)} className="icon-btn" aria-label="Menu">
            <MoreVertical size={18} />
          </button>
          <AnimatePresence>
            {showDropdown && (
              <motion.div
                ref={dropdownRef}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.12 }}
                className="header-dropdown"
              >
                <button onClick={() => { setShowDropdown(false); onOpenSettings?.(); }} className="dropdown-item">
                  <Settings size={14} /> Settings & security
                </button>
                <button onClick={onLogout} className="dropdown-item">
                  <LogOut size={14} /> Logout
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="my-identity">
        <div className="my-avatar">{username ? username[0].toUpperCase() : "?"}</div>
        <div>
          <p className="my-name">{username}</p>
          <p className="my-badge"><span className="status-dot-green" />You're online</p>
        </div>
      </div>

      <div className="search-wrap">
        <Search size={14} className="search-icon" />
        <input
          type="text"
          value={searchTerm}
          placeholder="Search users…"
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
          maxLength={32}
        />
        {results.length > 0 && (
          <ul className="search-results">
            {results.map((user) => (
              <li
                key={user.username}
                onClick={() => { setSearchTerm(""); setResults([]); onSelectUser({ username: user.username }); }}
                className="search-result-item"
              >
                <div className="sr-avatar">{user.username[0]?.toUpperCase()}</div>
                <span>{user.username}</span>
                {isOnline(user.username) && <span className="status-dot-green ml-auto" />}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="section-label">Conversations</p>

      <ul className="user-list">
        {conversations.length > 0 ? (
          conversations.map((user) => (
            <motion.li
              key={user.username}
              layout
              onClick={() => onSelectUser(user)}
              className={`user-item ${activeUser?.username === user.username ? "user-item-active" : ""}`}
            >
              <div className="relative">
                <div className="user-avatar">{user.username[0]?.toUpperCase()}</div>
                <span className={`user-dot ${isOnline(user.username) ? "online" : "offline"}`} />
              </div>
              <div className="user-meta">
                <span className="user-name">{user.username}</span>
                <span className="user-sub">
                  {typingUser === user.username ? <span className="typing-text">typing…</span> : ""}
                </span>
              </div>
              {user.unseen > 0 && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="unread-badge">
                  {user.unseen > 99 ? "99+" : user.unseen}
                </motion.span>
              )}
            </motion.li>
          ))
        ) : (
          <p className="no-chats">No conversations yet</p>
        )}
      </ul>
    </aside>
  );
}
