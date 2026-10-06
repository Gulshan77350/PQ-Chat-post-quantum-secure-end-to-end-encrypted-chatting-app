import { motion } from "framer-motion";
import {
  Check, CheckCheck, Clock, AlertCircle, Download, FileText, Image, Film, Music,
  Pencil, Trash2, Ban, ShieldAlert, RotateCw,
} from "lucide-react";
import { useState, useEffect } from "react";
import { decryptMessage, decryptMedia, fromB64 } from "../lib/pqcrypto";
import { apiFetch } from "../lib/session";

// Decrypted plaintext/media cached in memory, so re-renders don't re-run Kyber
// decapsulation. Text is keyed on (id, ciphertext): an edit replaces the ciphertext and
// therefore misses the cache. Never persisted to storage.
const plaintextCache = new Map();
const mediaCache = new Map();

function cachedPlaintext(msg) {
  const hit = msg.id ? plaintextCache.get(msg.id) : null;
  return hit && hit.ct === msg.text ? hit : null;
}

/** Called by the sender after a successful send/edit: it already knows the plaintext. */
export function rememberPlaintext(id, text, ciphertext) {
  if (id) plaintextCache.set(id, { text, legacy: false, ct: ciphertext });
}
export function rememberMedia(id, media) {
  if (id) mediaCache.set(id, media);
}
export function forgetMessage(id) {
  plaintextCache.delete(id);
  const m = mediaCache.get(id);
  if (m?.url) URL.revokeObjectURL(m.url);
  mediaCache.delete(id);
}

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function getFileIcon(mimeType) {
  if (!mimeType) return <FileText size={14} />;
  if (mimeType.startsWith("image/")) return <Image size={14} />;
  if (mimeType.startsWith("video/")) return <Film size={14} />;
  if (mimeType.startsWith("audio/")) return <Music size={14} />;
  return <FileText size={14} />;
}

/** Fetches the encrypted blob (local stream or presigned S3 URL) as bytes. */
async function fetchCiphertext(mediaId) {
  const res = await apiFetch(`/api/media/${mediaId}`);
  if (!res.ok) throw new Error(`media fetch failed (${res.status})`);
  if ((res.headers.get("content-type") || "").includes("application/json")) {
    const { url } = await res.json();
    const blobRes = await fetch(url);
    if (!blobRes.ok) throw new Error("object storage fetch failed");
    return new Uint8Array(await blobRes.arrayBuffer());
  }
  return new Uint8Array(await res.arrayBuffer());
}

// ── Media renderer ────────────────────────────────────────────
function MediaContent({ msg, currentUser, isMe }) {
  const cached = msg.id ? mediaCache.get(msg.id) : null;
  const [media, setMedia] = useState(cached || msg._localMedia || null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (media || !msg.media || !msg.id) return;
    let active = true;
    (async () => {
      const m = msg.media;
      const meta = {
        iv: m.iv, encryptedKey: m.encryptedKey, senderEncryptedKey: m.senderEncryptedKey,
        cryptoVersion: msg.cryptoVersion, sender: msg.sender, receiver: msg.receiver,
      };
      const ciphertext = m.data ? fromB64(m.data) : await fetchCiphertext(m.id);
      const out = await decryptMedia(ciphertext, meta, currentUser, isMe);
      if (!out) throw new Error("decrypt failed");
      const mimeType = out.mimeType || m.mimeType || "application/octet-stream";
      const result = {
        url: URL.createObjectURL(new Blob([out.data], { type: mimeType })),
        name: out.name || m.name || "file",
        mimeType,
        size: out.data.byteLength,
        legacy: out.legacy,
      };
      mediaCache.set(msg.id, result);
      if (active) setMedia(result);
    })().catch((err) => {
      console.error("Media decrypt failed:", err);
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [msg.id, msg.media, msg.cryptoVersion, msg.sender, msg.receiver, currentUser, isMe, media]);

  if (failed) return <div className="text-[11px] opacity-50 py-1">⚠️ Could not decrypt media</div>;
  if (!media) return <div className="text-[11px] opacity-50 py-1.5">🔓 Decrypting{msg.media?.size ? ` ${formatBytes(msg.media.size)}` : ""}…</div>;

  const download = () => {
    const a = document.createElement("a");
    a.href = media.url;
    a.download = media.name;
    a.click();
  };

  if (media.mimeType.startsWith("image/")) return (
    <div className="media-img-wrap">
      <img src={media.url} alt={media.name} className={`media-img ${expanded ? "expanded" : ""}`} onClick={() => setExpanded((e) => !e)} />
      <button onClick={download} className="media-dl-btn" title="Download"><Download size={12} /></button>
    </div>
  );
  if (media.mimeType.startsWith("video/")) return <div className="media-video-wrap"><video src={media.url} controls className="media-video" /></div>;
  if (media.mimeType.startsWith("audio/")) return <div className="media-audio-wrap"><audio src={media.url} controls className="media-audio" /></div>;

  return (
    <div className="media-file-card">
      <div className="media-file-icon">{getFileIcon(media.mimeType)}</div>
      <div className="media-file-meta">
        <span className="media-file-name">{media.name}</span>
        <span className="media-file-size">{formatBytes(media.size)}</span>
      </div>
      <button onClick={download} className="media-file-dl"><Download size={14} /></button>
    </div>
  );
}

function StatusIcon({ status }) {
  switch (status) {
    case "sending": return <Clock size={12} className="seen-icon unseen" aria-label="Sending" />;
    case "failed": return <AlertCircle size={13} className="text-rose-400" aria-label="Failed" />;
    case "seen": return <CheckCheck size={13} className="seen-icon seen" aria-label="Seen" />;
    case "delivered": return <CheckCheck size={13} className="seen-icon unseen" aria-label="Delivered" />;
    default: return <Check size={13} className="seen-icon unseen" aria-label="Sent" />;
  }
}

// ── MessageBubble ─────────────────────────────────────────────
export default function MessageBubble({ msg, currentUser, canEdit, onEdit, onDelete, onRetry }) {
  const isMe = msg.sender === currentUser;
  const [plain, setPlain] = useState(msg._plaintext != null ? { text: msg._plaintext, legacy: false } : cachedPlaintext(msg));
  const [decryptFailed, setDecryptFailed] = useState(false);

  useEffect(() => {
    if (msg._plaintext != null) return setPlain({ text: msg._plaintext, legacy: false });
    if (!msg.text || msg.deletedAt) return;
    const hit = cachedPlaintext(msg);
    if (hit) return setPlain(hit);

    // Pre-encryption legacy rows had no IV / key container at all.
    if (!msg.iv || !msg.encryptedKey) {
      setPlain({ text: msg.text, legacy: true, unencrypted: true });
      return;
    }
    let active = true;
    decryptMessage(msg, currentUser, isMe).then((out) => {
      if (!active) return;
      if (out) {
        if (msg.id) plaintextCache.set(msg.id, { ...out, ct: msg.text });
        setPlain(out);
        setDecryptFailed(false);
      } else {
        setDecryptFailed(true);
      }
    });
    return () => { active = false; };
  }, [msg.id, msg.text, msg.iv, msg.encryptedKey, msg.senderEncryptedKey, msg.editedAt, msg.deletedAt, msg._plaintext, currentUser, isMe]);

  const formattedTime = msg.createdAt
    ? new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  const isDeleted = !!msg.deletedAt;
  const hasMedia = !isDeleted && (msg.media || msg._localMedia);
  const legacy = plain?.legacy;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={`bubble-row group ${isMe ? "bubble-me" : "bubble-them"}`}
    >
      {isMe && !isDeleted && msg.id && (
        <div className="self-center mr-1.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {canEdit && msg.text && plain && (
            <button onClick={() => onEdit(msg, plain.text)} className="icon-btn !w-7 !h-7" title="Edit"><Pencil size={13} /></button>
          )}
          <button onClick={() => onDelete(msg)} className="icon-btn !w-7 !h-7 hover:!text-rose-400" title="Delete for everyone"><Trash2 size={13} /></button>
        </div>
      )}

      <div className={`bubble ${isMe ? "bubble-sent" : "bubble-recv"} ${isDeleted ? "opacity-60" : ""}`}>
        {isDeleted ? (
          <p className="bubble-text italic text-[12px] flex items-center gap-1.5"><Ban size={12} /> This message was deleted</p>
        ) : (
          <>
            {hasMedia && <MediaContent msg={msg} currentUser={currentUser} isMe={isMe} />}
            {msg.text != null || msg._plaintext != null ? (
              plain ? (
                <p className="bubble-text">{plain.text}</p>
              ) : decryptFailed ? (
                <p className="bubble-text" style={{ opacity: 0.45, fontStyle: "italic", fontSize: "12px" }}>
                  🔒 Can't decrypt — encrypted to a different key
                </p>
              ) : (
                <p className="bubble-text" style={{ opacity: 0.4, fontSize: "12px" }}>🔓 decrypting…</p>
              )
            ) : null}
          </>
        )}

        <div className={`bubble-footer ${isMe ? "bubble-footer-me" : "bubble-footer-them"}`}>
          {legacy && !isDeleted && (
            <span className="flex items-center gap-0.5 text-amber-400/80 text-[10px]" title={plain?.unencrypted ? "Stored before encryption was enabled" : "Legacy v1 encryption (no sender/receiver binding)"}>
              <ShieldAlert size={10} /> {plain?.unencrypted ? "unencrypted" : "legacy"}
            </span>
          )}
          {msg.editedAt && !isDeleted && <span className="text-[10px] opacity-60">edited</span>}
          <span className="bubble-time">{formattedTime}</span>
          {isMe && !isDeleted && <StatusIcon status={msg.status} />}
          {isMe && msg.status === "failed" && onRetry && (
            <button onClick={() => onRetry(msg)} className="text-rose-300 hover:text-rose-200" title="Retry"><RotateCw size={12} /></button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
