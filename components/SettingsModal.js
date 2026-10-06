import { useEffect, useState } from "react";
import { X, KeyRound, MonitorSmartphone, RefreshCw, LogOut, Lock } from "lucide-react";
import toast from "react-hot-toast";
import { apiJson } from "../lib/session";
import {
  loadPrivateKey, saveSessionPrivateKey, exportEncryptedKeyFile, generateKeyPair, proveKeyPossession, toB64,
} from "../lib/pqcrypto";
import { getPasswordStrength, downloadJson, MIN_PASSWORD_LENGTH } from "../lib/passwordStrength";

function Section({ icon: Icon, title, children }) {
  return (
    <section className="border border-slate-800 rounded-xl p-4 bg-slate-950/40">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100 mb-3">
        <Icon size={15} className="text-emerald-400" /> {title}
      </h4>
      {children}
    </section>
  );
}

const inputCls = "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60";
const btnCls = "flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold active:scale-[0.98] disabled:opacity-50";

export default function SettingsModal({ isOpen, onClose, username, onKeyRotated }) {
  const [sessions, setSessions] = useState([]);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [rotatePw, setRotatePw] = useState("");
  const [busy, setBusy] = useState(null);

  const loadSessions = () => apiJson("/api/auth/sessions").then(setSessions).catch(() => {});

  useEffect(() => {
    if (isOpen) loadSessions();
    else {
      setPw({ current: "", next: "", confirm: "" });
      setRotatePw("");
    }
  }, [isOpen]);

  if (!isOpen) return null;
  const strength = getPasswordStrength(pw.next);

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next.length < MIN_PASSWORD_LENGTH) return toast.error(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    if (pw.next !== pw.confirm) return toast.error("Passwords do not match");
    const privateKey = loadPrivateKey(username);
    if (!privateKey) return toast.error("Private key not loaded — sign in again");

    setBusy("password");
    try {
      // Wrap first so a failure can't leave the account with no matching key file.
      const keyFile = await exportEncryptedKeyFile(username, pw.next, privateKey);
      const res = await apiJson("/api/auth/change-password", {
        method: "POST",
        body: { currentPassword: pw.current, newPassword: pw.next },
      });
      downloadJson(`pqchat_${username}.pqkey`, keyFile);
      toast.success(`Password changed. New .pqkey downloaded — the old file no longer matches.${res.revokedSessions ? ` ${res.revokedSessions} other device(s) signed out.` : ""}`, { duration: 7000 });
      setPw({ current: "", next: "", confirm: "" });
      loadSessions();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const logoutOthers = async () => {
    setBusy("sessions");
    try {
      const { revoked } = await apiJson("/api/auth/sessions", { method: "DELETE" });
      toast.success(revoked ? `Signed out ${revoked} other device(s)` : "No other devices were signed in");
      loadSessions();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const rotateKey = async (e) => {
    e.preventDefault();
    if (!confirm(
      "Rotate your encryption key?\n\n" +
      "• Messages encrypted to your current key will no longer be readable after you sign out.\n" +
      "• Your contacts will see a 'safety number changed' warning.\n" +
      "• A new .pqkey file will be downloaded and the old one stops working."
    )) return;

    setBusy("rotate");
    try {
      const { publicKey, privateKey } = await generateKeyPair();
      const publicKeyB64 = toB64(publicKey);
      const keyFile = await exportEncryptedKeyFile(username, rotatePw, privateKey);
      // Prove possession of the NEW key; the server only pins keys we can decapsulate with.
      const challenge = await apiJson("/api/keys/challenge", { method: "POST", body: { publicKey: publicKeyB64 } });
      const proof = await proveKeyPossession(challenge, privateKey);
      const res = await apiJson("/api/keys", {
        method: "PUT",
        body: { publicKey: publicKeyB64, challengeId: challenge.challengeId, proof, currentPassword: rotatePw },
      });
      saveSessionPrivateKey(username, privateKey);
      downloadJson(`pqchat_${username}.pqkey`, keyFile);
      toast.success(`Key rotated (version ${res.keyVersion}). New .pqkey downloaded.`, { duration: 7000 });
      setRotatePw("");
      onKeyRotated?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(12,14,20,0.85)", backdropFilter: "blur(8px)", padding: "16px" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto border border-emerald-500/30 rounded-2xl p-6 text-slate-100 space-y-4"
        style={{ backgroundColor: "#131620", boxShadow: "0 24px 64px rgba(0,0,0,0.8)" }}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800">
          <X size={18} />
        </button>
        <h3 className="text-lg font-semibold">Settings & security</h3>

        <Section icon={Lock} title="Change password">
          <form onSubmit={changePassword} className="space-y-2">
            <input className={inputCls} type="password" placeholder="Current password" autoComplete="current-password"
              value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            <input className={inputCls} type="password" placeholder="New password" autoComplete="new-password"
              value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            {pw.next && <p className={`text-[11px] ${strength.color}`}>Strength: {strength.label}</p>}
            <input className={inputCls} type="password" placeholder="Confirm new password" autoComplete="new-password"
              value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            <p className="text-[11px] text-slate-400">Your private key is re-wrapped under the new password locally and a new .pqkey file is downloaded. Other devices are signed out.</p>
            <button type="submit" disabled={busy || !pw.current || !pw.next} className={`${btnCls} w-full bg-emerald-600 hover:bg-emerald-500 text-slate-950`}>
              <KeyRound size={13} /> {busy === "password" ? "Updating…" : "Change password"}
            </button>
          </form>
        </Section>

        <Section icon={MonitorSmartphone} title="Signed-in devices">
          <ul className="space-y-1.5 mb-3">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-[11px] text-slate-300 bg-slate-900/70 rounded-lg px-2.5 py-1.5">
                <span className="truncate max-w-[70%]" title={s.userAgent}>{s.userAgent || "Unknown device"}</span>
                <span className={s.current ? "text-emerald-400" : "text-slate-500"}>
                  {s.current ? "this device" : new Date(s.lastUsedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
          <button onClick={logoutOthers} disabled={busy || sessions.length < 2} className={`${btnCls} w-full bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700`}>
            <LogOut size={13} /> {busy === "sessions" ? "Signing out…" : "Log out all other devices"}
          </button>
        </Section>

        <Section icon={RefreshCw} title="Rotate encryption key">
          <form onSubmit={rotateKey} className="space-y-2">
            <p className="text-[11px] text-slate-400">Use this if your .pqkey file may have been exposed. Requires your password and proves possession of the new key to the server.</p>
            <input className={inputCls} type="password" placeholder="Current password" autoComplete="current-password"
              value={rotatePw} onChange={(e) => setRotatePw(e.target.value)} />
            <button type="submit" disabled={busy || !rotatePw} className={`${btnCls} w-full bg-rose-700 hover:bg-rose-600 text-white`}>
              <RefreshCw size={13} /> {busy === "rotate" ? "Rotating…" : "Generate & pin a new key"}
            </button>
          </form>
        </Section>
      </div>
    </div>
  );
}
