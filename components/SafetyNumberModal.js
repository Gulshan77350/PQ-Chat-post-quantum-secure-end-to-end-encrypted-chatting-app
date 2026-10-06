import { useState, useEffect } from "react";
import { ShieldCheck, Copy, Check, X, ShieldAlert, KeyRound } from "lucide-react";
import toast from "react-hot-toast";
import { computeSafetyNumber, fingerprintPublicKey } from "../lib/pqcrypto";

/**
 * Shows the safety number for (me, peer). When the peer's key changed, it shows the
 * number for the NEW key and lets the user accept it after comparing out-of-band.
 */
export default function SafetyNumberModal({
  isOpen, onClose, currentUser, myPublicKey, peerUsername, peerPublicKey,
  verified, keyChanged, onToggleVerified, onAcceptNewKey,
}) {
  const [safetyNumber, setSafetyNumber] = useState(null);
  const [fingerprints, setFingerprints] = useState({ mine: "", peer: "" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !currentUser || !peerUsername || !myPublicKey || !peerPublicKey) {
      setSafetyNumber(null);
      return;
    }
    let active = true;
    Promise.all([
      computeSafetyNumber(currentUser, myPublicKey, peerUsername, peerPublicKey),
      fingerprintPublicKey(myPublicKey),
      fingerprintPublicKey(peerPublicKey),
    ]).then(([num, mine, peer]) => {
      if (!active) return;
      setSafetyNumber(num);
      setFingerprints({ mine, peer });
    });
    return () => { active = false; };
  }, [isOpen, currentUser, peerUsername, myPublicKey, peerPublicKey]);

  if (!isOpen || !peerUsername) return null;

  const handleCopy = () => {
    if (!safetyNumber) return;
    navigator.clipboard.writeText(safetyNumber);
    setCopied(true);
    toast.success("Safety number copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(12, 14, 20, 0.85)", backdropFilter: "blur(8px)", padding: "16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md border rounded-2xl p-6 shadow-2xl text-slate-100"
        style={{
          backgroundColor: "#131620",
          borderColor: keyChanged ? "rgba(244, 63, 94, 0.45)" : "rgba(110, 231, 183, 0.3)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
        }}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800">
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2.5 rounded-xl border ${keyChanged ? "bg-rose-500/15 text-rose-400 border-rose-500/20" : "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"}`}>
            {keyChanged ? <ShieldAlert size={26} /> : <ShieldCheck size={26} />}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              {keyChanged ? "Safety number changed" : "Safety Number"}
              {verified && !keyChanged && (
                <span className="text-xs font-normal text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Check size={12} /> Verified
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400">Encryption keys for you and {peerUsername}</p>
          </div>
        </div>

        <p className={`text-xs p-3 rounded-xl mb-5 leading-relaxed border ${keyChanged ? "text-rose-200 bg-rose-950/40 border-rose-900/60" : "text-slate-300 bg-slate-950/60 border-slate-800"}`}>
          {keyChanged ? (
            <>The server is now presenting a <b>different public key</b> for <b>{peerUsername}</b>. This happens when they rotate their key — or when someone is intercepting your messages. Compare the number below with {peerUsername} over a call or in person before accepting it.</>
          ) : (
            <>Compare this number with <b>{peerUsername}</b> out-of-band (video call or in person). If it matches on both devices, nobody — including the server — has substituted a key.</>
          )}
        </p>

        <div className="bg-slate-950 border border-emerald-500/20 rounded-xl p-4 text-center mb-5 font-mono text-sm font-bold text-emerald-300">
          {safetyNumber ? (
            <div className="grid grid-cols-2 gap-2 text-center text-base">
              {safetyNumber.split(" - ").map((chunk, i) => (
                <span key={i} className="bg-slate-900/80 py-1.5 px-2 rounded border border-emerald-500/10 tracking-widest">{chunk}</span>
              ))}
            </div>
          ) : (
            <span className="text-slate-500 font-sans text-xs">{peerPublicKey ? "Computing…" : `${peerUsername} has no encryption key`}</span>
          )}
        </div>

        <div className="text-xs text-slate-400 space-y-1.5 mb-6 border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-300"><KeyRound size={13} className="text-emerald-400" /> Your key</span>
            <span className="font-mono text-[11px]">{fingerprints.mine.slice(0, 24)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-300"><KeyRound size={13} className="text-emerald-400" /> {peerUsername}'s key</span>
            <span className="font-mono text-[11px]">{fingerprints.peer.slice(0, 24)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium text-xs border border-slate-700 active:scale-[0.98]"
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>

          {keyChanged ? (
            <button
              onClick={onAcceptNewKey}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs bg-rose-600 hover:bg-rose-500 text-white font-semibold active:scale-[0.98]"
            >
              <ShieldAlert size={14} /> Accept new key
            </button>
          ) : (
            <button
              onClick={onToggleVerified}
              disabled={!safetyNumber}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium text-xs active:scale-[0.98] disabled:opacity-50 ${
                verified
                  ? "bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30"
                  : "bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold"
              }`}
            >
              <ShieldCheck size={14} />
              {verified ? "Unmark verified" : "Mark verified"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
