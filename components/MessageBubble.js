import { motion } from "framer-motion";
import { Check, CheckCheck, Download, FileText, Image, Film, Music, ShieldCheck } from "lucide-react";
import { useState, useEffect } from "react";
import { decryptMessage, decryptMediaData } from "../lib/pqcrypto";

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

// ── Media renderer ────────────────────────────────────────────
function MediaContent({ mediaData, mediaIv, mediaEncKey, senderMediaEncKey, mediaMimeType, mediaName, mediaSize, currentUser, isMe }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState(false);

  useEffect(() => {
    if (!mediaData || !mediaIv || !mediaEncKey || !currentUser) {
      setLoading(false);
      return;
    }
    decryptMediaData(mediaData, mediaIv, mediaEncKey, mediaMimeType, currentUser, senderMediaEncKey, isMe)
      .then(url => { setObjectUrl(url); setLoading(false); });

    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [mediaData, mediaIv, mediaEncKey, senderMediaEncKey, currentUser, isMe]);

  const handleDownload = () => {
    if (!objectUrl) return;
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = mediaName || "file";
    a.click();
  };

  if (loading) return <div className="media-loading" style={{fontSize:"11px",opacity:0.5,padding:"6px 0"}}>🔓 Decrypting…</div>;
  if (!objectUrl) return <div style={{fontSize:"11px",opacity:0.4,padding:"4px 0"}}>⚠️ Could not decrypt media</div>;

  const isImage = mediaMimeType?.startsWith("image/");
  const isVideo = mediaMimeType?.startsWith("video/");
  const isAudio = mediaMimeType?.startsWith("audio/");

  if (isImage) return (
    <div className="media-img-wrap">
      <img src={objectUrl} alt={mediaName}
        className={`media-img ${expanded ? "expanded" : ""}`}
        onClick={() => setExpanded(e => !e)} />
      <button onClick={handleDownload} className="media-dl-btn" title="Download">
        <Download size={12} />
      </button>
    </div>
  );
  if (isVideo) return <div className="media-video-wrap"><video src={objectUrl} controls className="media-video" /></div>;
  if (isAudio) return <div className="media-audio-wrap"><audio src={objectUrl} controls className="media-audio" /></div>;

  return (
    <div className="media-file-card">
      <div className="media-file-icon">{getFileIcon(mediaMimeType)}</div>
      <div className="media-file-meta">
        <span className="media-file-name">{mediaName || "File"}</span>
        <span className="media-file-size">{formatBytes(mediaSize)}</span>
      </div>
      <button onClick={handleDownload} className="media-file-dl"><Download size={14} /></button>
    </div>
  );
}

// ── MessageBubble ─────────────────────────────────────────────
export default function MessageBubble({
  text, iv, encryptedKey, senderEncryptedKey,
  from, seen = false, createdAt, type,
  mediaData, mediaIv, mediaEncKey, senderMediaEncKey, mediaMimeType, mediaName, mediaSize,
  currentUser,
}) {
  const isMe = from === "me";
  const [plaintext, setPlaintext]         = useState(null);
  const [decryptFailed, setDecryptFailed] = useState(false);

  useEffect(() => {
    if (!text) return;

    // No encryption fields → old plain text message
    if (!iv || !encryptedKey) {
      setPlaintext(text);
      return;
    }

    if (!currentUser) {
      setDecryptFailed(true);
      return;
    }

    decryptMessage(text, iv, encryptedKey, currentUser, senderEncryptedKey, isMe)
      .then(result => {
        if (result !== null) {
          setPlaintext(result);
        } else {
          // Check local client sent cache if available
          const localSent = isMe ? localStorage.getItem("pqc_sent_" + text) : null;
          if (localSent) {
            setPlaintext(localSent);
          } else {
            setDecryptFailed(true);
          }
        }
      });
  }, [text, iv, encryptedKey, senderEncryptedKey, currentUser, isMe]);

  const formattedTime = createdAt
    ? new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={`bubble-row ${isMe ? "bubble-me" : "bubble-them"}`}
    >
      <div className={`bubble ${isMe ? "bubble-sent" : "bubble-recv"}`}>

        {/* Media */}
        {mediaData && (
          <MediaContent
            mediaData={mediaData}
            mediaIv={mediaIv}
            mediaEncKey={mediaEncKey}
            senderMediaEncKey={senderMediaEncKey}
            mediaMimeType={mediaMimeType}
            mediaName={mediaName}
            mediaSize={mediaSize}
            currentUser={currentUser}
            isMe={isMe}
          />
        )}

        {/* Text */}
        {text && (
          plaintext
            ? <p className="bubble-text">{plaintext}</p>
            : decryptFailed
              ? <p className="bubble-text" style={{ opacity: 0.4, fontStyle: "italic", fontSize: "12px" }}>
                  🔒 [Message encrypted under a previous keypair]
                </p>
              : <p className="bubble-text" style={{ opacity: 0.4, fontSize: "12px" }}>
                  🔓 decrypting…
                </p>
        )}

        {/* Footer */}
        <div className={`bubble-footer ${isMe ? "bubble-footer-me" : "bubble-footer-them"}`}>
          <span className="bubble-time">{formattedTime}</span>
          {isMe && (seen
            ? <CheckCheck size={13} className="seen-icon seen" />
            : <Check size={13} className="seen-icon unseen" />
          )}
        </div>
      </div>
    </motion.div>
  );
}
