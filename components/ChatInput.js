import { useState, useEffect, useRef } from "react";
import { Paperclip, Send, X, FileText, Image, Film, Music, ShieldCheck } from "lucide-react";
import { encryptMessage, encryptMedia, loadPublicKey } from "../lib/pqcrypto";
import toast from "react-hot-toast";

const MAX_FILE_SIZE = 8 * 1024 * 1024;

function getFileIcon(mimeType) {
  if (!mimeType) return <FileText size={16} />;
  if (mimeType.startsWith("image/")) return <Image size={16} />;
  if (mimeType.startsWith("video/")) return <Film size={16} />;
  if (mimeType.startsWith("audio/")) return <Music size={16} />;
  return <FileText size={16} />;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default function ChatInput({ receiverUsername, onSend, onSendMedia, onTypingStart, onTypingStop }) {
  const [message, setMessage]       = useState("");
  const [attachment, setAttachment] = useState(null);
  const [preview, setPreview]       = useState(null);
  const [sending, setSending]       = useState(false);
  const [dragOver, setDragOver]     = useState(false);

  const typingTimeoutRef = useRef(null);
  const fileInputRef     = useRef(null);
  const textareaRef      = useRef(null);

  const handleTyping = (e) => {
    setMessage(e.target.value);
    if (onTypingStart) onTypingStart();
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (onTypingStop) onTypingStop();
    }, 1500);
  };

  const processFile = async (file) => {
    if (file.size > MAX_FILE_SIZE) {
      alert(`File too large. Max: ${formatBytes(MAX_FILE_SIZE)}`);
      return;
    }
    try {
      const arrayBuffer = await file.arrayBuffer();
      setAttachment({ name: file.name, mimeType: file.type, size: file.size, arrayBuffer });
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = e => setPreview(e.target.result);
        reader.readAsDataURL(file);
      } else {
        setPreview(null);
      }
    } catch (err) {
      console.error("File read failed:", err);
      alert("Could not read file.");
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const clearAttachment = () => { setAttachment(null); setPreview(null); };

  // Fetch public keys for receiver and sender
  const getPublicKeys = async () => {
    const senderUsername = sessionStorage.getItem("username");
    const sessionSenderPk = loadPublicKey(senderUsername);

    const res = await fetch(`/api/users`);
    const users = await res.json();
    const receiver = users.find(u => u.username === receiverUsername);
    const sender   = users.find(u => u.username === senderUsername);

    if (!receiver?.publicKey) {
      toast.error("Receiver has no encryption key. Ask them to re-register.");
      return null;
    }

    const finalSenderPk = sessionSenderPk || sender?.publicKey;
    if (!finalSenderPk) {
      toast.error("Sender public key not found.");
      return null;
    }

    // Auto-sync sender's public key if DB is out of date
    if (sessionSenderPk && sender?.publicKey !== sessionSenderPk) {
      fetch("/api/users/sync-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: senderUsername, publicKey: sessionSenderPk }),
      }).catch(console.error);
    }

    return {
      receiverPublicKey: receiver.publicKey,
      senderPublicKey: finalSenderPk,
    };
  };

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed && !attachment) return;
    if (onTypingStop) onTypingStop();

    setSending(true);
    try {
      const keys = await getPublicKeys();
      if (!keys || !keys.receiverPublicKey) return;
      const { receiverPublicKey, senderPublicKey } = keys;

      if (attachment) {
        // Encrypt file with receiver's and sender's Kyber public keys
        const { encryptedBase64, iv, encryptedKey, senderEncryptedKey } = await encryptMedia(
          attachment.arrayBuffer, receiverPublicKey, senderPublicKey
        );
        // Encrypt caption if present
        let encText = null, textIv = null, textKey = null, senderTextKey = null;
        if (trimmed) {
          const r = await encryptMessage(trimmed, receiverPublicKey, senderPublicKey);
          encText = r.ciphertext;
          textIv = r.iv;
          textKey = r.encryptedKey;
          senderTextKey = r.senderEncryptedKey;
        }
        onSendMedia({
          text: encText, textIv, textEncryptedKey: textKey, senderTextEncryptedKey: senderTextKey,
          mediaData: encryptedBase64, iv, encryptedKey, senderMediaEncKey: senderEncryptedKey,
          mediaName: attachment.name, mediaMimeType: attachment.mimeType,
          mediaSize: attachment.size,
          type: attachment.mimeType.startsWith("image/") ? "image"
            : attachment.mimeType.startsWith("video/") ? "video"
            : attachment.mimeType.startsWith("audio/") ? "audio"
            : "file",
        });
        clearAttachment();
      } else {
        // Encrypt text with receiver's and sender's Kyber public keys
        const { ciphertext, iv, encryptedKey, senderEncryptedKey } = await encryptMessage(
          trimmed, receiverPublicKey, senderPublicKey
        );
        onSend({ ciphertext, iv, encryptedKey, senderEncryptedKey, plaintext: trimmed });
      }
      setMessage("");
    } catch (err) {
      console.error("Send failed:", err);
      toast.error("Failed to encrypt message.");
    } finally {
      setSending(false);
    }
  };

  const canSend = (message.trim() || attachment) && !sending;

  useEffect(() => () => { if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current); }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [message]);

  return (
    <div
      className={`pqc-input-zone ${dragOver ? "drag-active" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {attachment && (
        <div className="attachment-preview">
          <div className="attach-icon">{getFileIcon(attachment.mimeType)}</div>
          {preview && <img src={preview} alt="preview" className="attach-thumb" />}
          <div className="attach-meta">
            <span className="attach-name">{attachment.name}</span>
            <span className="attach-size">
              <ShieldCheck size={10} className="inline mr-1 text-emerald-400" />
              {formatBytes(attachment.size)} · will encrypt on send
            </span>
          </div>
          <button onClick={clearAttachment} className="attach-remove">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="input-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="attach-btn"
          title="Attach file"
          disabled={sending}
        >
          {sending ? <span className="encrypting-spinner" /> : <Paperclip size={18} />}
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          value={message}
          onChange={handleTyping}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          placeholder={attachment ? "Add a caption… (optional)" : "Type a message…"}
          className="msg-textarea"
        />

        <button
          onClick={handleSend}
          disabled={!canSend}
          className={`send-btn ${canSend ? "send-active" : "send-disabled"}`}
        >
          <Send size={16} />
        </button>
      </div>

      {dragOver && (
        <div className="drop-overlay">
          <ShieldCheck size={24} className="text-emerald-400" />
          <span>Drop to encrypt &amp; send</span>
        </div>
      )}
    </div>
  );
}
