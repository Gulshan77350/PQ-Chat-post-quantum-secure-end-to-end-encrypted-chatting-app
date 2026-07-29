import { useState, useEffect } from "react";
import { ShieldCheck, Copy, Check, X, ShieldAlert, KeyRound } from "lucide-react";
import toast from "react-hot-toast";
import { computeSafetyNumber } from "../lib/pqcrypto";

export default function SafetyNumberModal({ isOpen, onClose, currentUser, peerUser }) {
  const [safetyNumber, setSafetyNumber] = useState("Computing...");
  const [copied, setCopied] = useState(false);
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    if (!isOpen || !currentUser || !peerUser) return;
    let active = true;

    async function loadNumber() {
      const num = await computeSafetyNumber(
        currentUser,
        sessionStorage.getItem(`pqc_publicKey_${currentUser}`) || "pubKeyA",
        peerUser.username,
        peerUser.publicKey || "pubKeyB"
      );
      if (active) setSafetyNumber(num || "Verification Unavailable");
    }

    loadNumber();

    const storedVerified = localStorage.getItem(`pqc_verified_${currentUser}_${peerUser.username}`);
    setIsVerified(storedVerified === "true");

    return () => {
      active = false;
    };
  }, [isOpen, currentUser, peerUser]);

  if (!isOpen || !peerUser) return null;

  const handleCopy = () => {
    if (!safetyNumber) return;
    navigator.clipboard.writeText(safetyNumber);
    setCopied(true);
    toast.success("Safety Number copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleVerify = () => {
    const nextState = !isVerified;
    setIsVerified(nextState);
    if (currentUser && peerUser.username) {
      localStorage.setItem(`pqc_verified_${currentUser}_${peerUser.username}`, String(nextState));
    }
    toast.success(nextState ? `Marked ${peerUser.username} as verified` : "Unmarked verification");
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(12, 14, 20, 0.85)",
        backdropFilter: "blur(8px)",
        padding: "16px",
      }}
    >
      <div
        className="relative w-full max-w-md border border-emerald-500/30 rounded-2xl p-6 shadow-2xl text-slate-100 animate-fade-in"
        style={{
          backgroundColor: "#131620",
          borderColor: "rgba(110, 231, 183, 0.3)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
        }}
      >
        
        {/* CLOSE BUTTON */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-slate-800"
        >
          <X size={18} />
        </button>

        {/* HEADER */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              Safety Number
              {isVerified && (
                <span className="text-xs font-normal text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Check size={12} /> Verified
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400">Verify encryption authenticity with {peerUser.username}</p>
          </div>
        </div>

        {/* VERIFICATION INFO BOX */}
        <p className="text-xs text-slate-300 bg-slate-950/60 border border-slate-800 p-3 rounded-xl mb-5 leading-relaxed">
          Compare this safety number with <b>{peerUser.username}</b> out-of-band (e.g. video call or in person). If both numbers match, your post-quantum Kyber keys are secure and authentic.
        </p>

        {/* SAFETY NUMBER DISPLAY */}
        <div className="bg-slate-950 border border-emerald-500/20 rounded-xl p-4 text-center mb-5 tracking-widest font-mono text-sm font-bold text-emerald-300 selection:bg-emerald-500 selection:text-slate-950">
          {safetyNumber ? (
            <div className="grid grid-cols-2 gap-2 text-center text-emerald-300 font-mono text-base">
              {safetyNumber.split(" - ").map((chunk, i) => (
                <span key={i} className="bg-slate-900/80 py-1.5 px-2 rounded border border-emerald-500/10">
                  {chunk}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-slate-500 font-sans text-xs">Computing safety number...</span>
          )}
        </div>

        {/* USER FINGERPRINT SUMMARY */}
        <div className="text-xs text-slate-400 space-y-1.5 mb-6 border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-300">
              <KeyRound size={13} className="text-emerald-400" /> Your Key:
            </span>
            <span className="font-mono text-slate-400 text-[11px] truncate max-w-[180px]">
              {sessionStorage.getItem(`pqc_publicKey_${currentUser}`)?.slice(0, 16) || "Active"}...
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-300">
              <KeyRound size={13} className="text-emerald-400" /> {peerUser.username}'s Key:
            </span>
            <span className="font-mono text-slate-400 text-[11px] truncate max-w-[180px]">
              {peerUser.publicKey ? `${peerUser.publicKey.slice(0, 16)}...` : "Synced"}
            </span>
          </div>
        </div>

        {/* ACTIONS */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-800 hover:bg-slate-750 text-slate-200 rounded-xl font-medium text-xs border border-slate-700 transition-all active:scale-[0.98]"
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy Safety Number"}
          </button>

          <button
            onClick={toggleVerify}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium text-xs transition-all active:scale-[0.98] ${
              isVerified
                ? "bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30"
                : "bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold shadow-lg shadow-emerald-900/20"
            }`}
          >
            <ShieldCheck size={14} />
            {isVerified ? "Unmark Verified" : "Mark Verified"}
          </button>
        </div>

      </div>
    </div>
  );
}
