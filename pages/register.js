import { useState } from "react";
import toast from "react-hot-toast";
import { Eye, EyeOff, ShieldCheck, UserPlus } from "lucide-react";
import { useRouter } from "next/router";
import { generateKeyPair, exportEncryptedKeyFile, saveSessionPrivateKey, toB64 } from "../lib/pqcrypto";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername]         = useState("");
  const [password, setPassword]         = useState("");
  const [confirm, setConfirm]           = useState("");
  const [loading, setLoading]           = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);

  const getPasswordStrength = (pass) => {
    if (!pass) return { label: "", score: 0, color: "", barColor: "" };
    if (pass.length < 6) return { label: "Too short (min 6 chars)", score: 1, color: "text-rose-400", barColor: "bg-rose-500" };
    
    let score = 0;
    if (pass.length >= 6) score++;
    if (pass.length >= 8) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;

    if (score <= 2) return { label: "Weak", score: 1, color: "text-amber-400", barColor: "bg-amber-500" };
    if (score <= 4) return { label: "Medium", score: 2, color: "text-emerald-400", barColor: "bg-emerald-400" };
    return { label: "Strong", score: 3, color: "text-emerald-300", barColor: "bg-emerald-300" };
  };

  const strength = getPasswordStrength(password);

  const triggerDownload = (filename, textContent) => {
    const blob = new Blob([textContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim() || !confirm.trim()) {
      toast.error("Please fill in all fields"); return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters long"); return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match"); return;
    }

    setLoading(true);
    try {
      // 1. Generate Kyber-512 keypair in browser
      const { publicKey, privateKey } = await generateKeyPair();

      // 2. Encrypt private key with password using PBKDF2 + AES-GCM
      const keyFileObj = await exportEncryptedKeyFile(username.trim(), password, privateKey);
      const keyFileJSON = JSON.stringify(keyFileObj, null, 2);

      // 3. Trigger .pqkey file download to user's system
      triggerDownload(`pqchat_${username.trim()}.pqkey`, keyFileJSON);

      // 4. Save in sessionStorage for current session
      saveSessionPrivateKey(username.trim(), privateKey);

      // 5. Register with backend API — send ONLY public key
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          publicKey: toB64(publicKey),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Account created! Save your downloaded .pqkey file securely.");
        router.push("/");
      } else {
        toast.error(data.message || "Registration failed");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error during registration & key generation");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <ShieldCheck size={22} color="#6ee7b7" />
          </div>
          <span className="auth-logo-text">PQChat</span>
        </div>
        <p className="auth-subtitle">Create your account</p>

        <form onSubmit={handleRegister}>
          <div className="auth-field">
            <label className="auth-label">Username</label>
            <input className="auth-input" type="text" placeholder="choose_a_username"
              value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>

          <div className="auth-field">
            <label className="auth-label">Password</label>
            <div className="auth-input-wrap">
              <input className="auth-input" type={showPassword ? "text" : "password"}
                placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingRight: "40px" }} />
              <button type="button" className="auth-eye" onClick={() => setShowPassword(s => !s)}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="auth-field">
            <label className="auth-label">Confirm Password</label>
            <div className="auth-input-wrap">
              <input className="auth-input" type={showConfirm ? "text" : "password"}
                placeholder="••••••••" value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                style={{ paddingRight: "40px" }} />
              <button type="button" className="auth-eye" onClick={() => setShowConfirm(s => !s)}>
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* PASSWORD STRENGTH INDICATOR NEAR SUBMIT BUTTON */}
          {password && (
            <div className="mb-3 px-1">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-400">Password strength:</span>
                <span className={`font-semibold ${strength.color}`}>{strength.label}</span>
              </div>
              <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden flex">
                <div
                  className={`h-full transition-all duration-300 ${strength.barColor}`}
                  style={{ width: `${(strength.score / 3) * 100}%` }}
                />
              </div>
            </div>
          )}

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading
              ? "Generating keys & registering…"
              : <><UserPlus size={14} /> Create Account</>
            }
          </button>
        </form>

        <p className="auth-divider">Already have an account?</p>
        <div style={{ textAlign: "center" }}>
          <button className="auth-link-btn" onClick={() => router.push("/")}>Sign in</button>
        </div>
      </div>
    </div>
  );
}
