import { Search, MoreVertical, LogOut, ShieldCheck } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { motion, AnimatePresence } from "framer-motion";
import { clearSessionKeys } from "../lib/pqcrypto";

export default function UserList({ users = [], allUsers = [], onSelectUser, username = "", activeUser = null, typingUser = null }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const router = useRouter();
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  const handleLogout = () => {
    if (username) clearSessionKeys(username);
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("username");
    router.replace("/");
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (buttonRef.current?.contains(event.target)) return;
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setShowDropdown(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!searchTerm.trim()) { setFilteredUsers([]); setShowSuggestions(false); return; }
    const regex = new RegExp(searchTerm, "i");
    const matched = allUsers.filter((u) => regex.test(u.username));
    setFilteredUsers(matched);
    setShowSuggestions(matched.length > 0);
  }, [searchTerm, allUsers]);

  return (
    <aside className="sidebar">
      {/* SIDEBAR HEADER */}
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <ShieldCheck size={18} className="text-emerald-400" />
          <span className="brand-name">PQChat</span>
        </div>
        <div className="relative">
          <button ref={buttonRef} onClick={() => setShowDropdown((p) => !p)} className="icon-btn">
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
                <button onClick={handleLogout} className="dropdown-item">
                  <LogOut size={14} /> Logout
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* MY IDENTITY */}
      <div className="my-identity">
        <div className="my-avatar">{username ? username[0].toUpperCase() : "?"}</div>
        <div>
          <p className="my-name">{username}</p>
          <p className="my-badge"><span className="status-dot-green" />You're online</p>
        </div>
      </div>

      {/* SEARCH */}
      <div className="search-wrap">
        <Search size={14} className="search-icon" />
        <input
          type="text"
          value={searchTerm}
          placeholder="Search users…"
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        {showSuggestions && (
          <ul className="search-results">
            {filteredUsers.map((user) => (
              <li
                key={user._id || user.username}
                onClick={() => { setSearchTerm(""); setShowSuggestions(false); onSelectUser(user); }}
                className="search-result-item"
              >
                <div className="sr-avatar">{user.username[0]?.toUpperCase()}</div>
                <span>{user.username}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* CHATS LABEL */}
      <p className="section-label">Conversations</p>

      {/* USER LIST */}
      <ul className="user-list">
        {users.length > 0 ? (
          users.map((user) => (
            <motion.li
              key={user._id || user.username}
              layout
              onClick={() => onSelectUser(user)}
              className={`user-item ${activeUser?.username === user.username ? "user-item-active" : ""}`}
            >
              <div className="relative">
                <div className="user-avatar">{user.username[0]?.toUpperCase()}</div>
                <span className={`user-dot ${user.online ? "online" : "offline"}`} />
              </div>
              <div className="user-meta">
                <span className="user-name">{user.username}</span>
                <span className="user-sub">
                  {typingUser === user.username ? (
                    <span className="typing-text">typing…</span>
                  ) : user.lastMessage ? (
                    user.lastMessage.length > 22 ? user.lastMessage.slice(0, 22) + "…" : user.lastMessage
                  ) : ""}
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
