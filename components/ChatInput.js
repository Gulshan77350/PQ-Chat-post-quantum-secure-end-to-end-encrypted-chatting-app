import { useState, useEffect, useRef } from "react";
import { Paperclip, Send, X, FileText, Image, Film, Music, ShieldCheck, Pencil, ShieldAlert } from "lucide-react";
import toast from "react-hot-toast";

// Ciphertext adds ~100 bytes of headers; the server's default cap is 25 MB.
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

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

/**
 * Pure input component — encryption happens in the parent, which owns the pinned peer key.
 * Props:
 *   onSendText(text), onSendFile(file, caption), onSubmitEdit(text)
 *   editing: { id, text } | null, onCancelEdit()
 *   disabledReason: string | null  (e.g. the peer's safety number changed)
 */
export default function ChatInput({ onSendText, onSendFile, onSubmitEdit, editing, onCancelEdit, onTypingStart, onTypingStop, disabledReason }) {
  const [message, setMessage]       = useState("");
  const [attachment, setAttachment] = useState(null);
  const [preview, setPreview]       = useState(null);
  const [sending, setSending]       = useState(false);
  const [dragOver, setDragOver]     = useState(false);

  const typingTimeoutRef = useRef(null);
  const fileInputRef     = useRef(null);
  const textareaRef      = useRef(null);

  // Entering edit mode pre-fills the existing text.
  useEffect(() => {
    if (editing) {
      setMessage(editing.text);
      clearAttachment();
      textareaRef.current?.focus();
    }
  }, [editing]);

  const handleTyping = (e) => {
    setMessage(e.target.value);
    if (editing) return;
    onTypingStart?.();
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => onTypingStop?.(), 1500);
  };

  const processFile = (file) => {
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`File too large. Max: ${formatBytes(MAX_FILE_SIZE)}`);
      return;
    }
    setAttachment(file);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (disabledReason || editing) return;
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  function clearAttachment() {
    setAttachment(null);
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
  }

  const cancelEdit = () => {
    setMessage("");
    onCancelEdit?.();
  };

  const handleSend = async () => {
    const trimmed = message.trim();
    if ((!trimmed && !attachment) || disabledReason) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    onTypingStop?.();

    setSending(true);
    try {
      if (editing) {
        if (trimmed !== editing.text) await onSubmitEdit(trimmed);
        else onCancelEdit?.();
      } else if (attachment) {
        const file = attachment;
        clearAttachment();
        setMessage("");
        await onSendFile(file, trimmed);
        return;
      } else {
        setMessage("");
        await onSendText(trimmed);
        return;
      }
      setMessage("");
    } catch (err) {
      console.error("Send failed:", err);
      toast.error(err.message || "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  const canSend = (message.trim() || attachment) && !sending && !disabledReason;

  useEffect(() => () => { if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current); }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [message]);

  if (disabledReason) {
    return (
      <div className="pqc-input-zone">
        <div className="flex items-center gap-2 text-xs text-rose-300 bg-rose-950/40 border border-rose-900/60 rounded-xl px-3 py-2.5">
          <ShieldAlert size={14} className="shrink-0" />
          <span>{disabledReason}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`pqc-input-zone ${dragOver ? "drag-active" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {editing && (
        <div className="flex items-center gap-2 text-xs text-emerald-300 mb-2 px-1">
          <Pencil size={12} /> Editing message
          <button onClick={cancelEdit} className="ml-auto text-slate-400 hover:text-slate-200"><X size={14} /></button>
        </div>
      )}

      {attachment && (
        <div className="attachment-preview">
          <div className="attach-icon">{getFileIcon(attachment.type)}</div>
          {preview && <img src={preview} alt="preview" className="attach-thumb" />}
          <div className="attach-meta">
            <span className="attach-name">{attachment.name}</span>
            <span className="attach-size">
              <ShieldCheck size={10} className="inline mr-1 text-emerald-400" />
              {formatBytes(attachment.size)} · name & type encrypted too
            </span>
          </div>
          <button onClick={clearAttachment} className="attach-remove"><X size={14} /></button>
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
          disabled={sending || !!editing}
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
            if (e.key === "Escape" && editing) cancelEdit();
          }}
          placeholder={editing ? "Edit message…" : attachment ? "Add a caption… (optional)" : "Type a message…"}
          className="msg-textarea"
          maxLength={20000}
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
