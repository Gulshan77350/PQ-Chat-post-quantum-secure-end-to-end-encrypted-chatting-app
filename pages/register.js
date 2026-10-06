import { useState } from "react";
import toast from "react-hot-toast";
import { Eye, EyeOff, ShieldCheck, UserPlus } from "lucide-react";
import { useRouter } from "next/router";
import { generateKeyPair, exportEncryptedKeyFile, toB64 } from "../lib/pqcrypto";
import { getPasswordStrength, downloadJson, MIN_PASSWORD_LENGTH } from "../lib/passwordStrength";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername]         = useState("");
  const [password, setPassword]         = useState("");
  const [confirm, setConfirm]           = useState("");
  const [loading, setLoading]           = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);

  const strength = getPasswordStrength(password);

  const handleRegister = async (e) => {
    e.preventDefault();
    const uname = username.trim();
    if (!uname || !password || !confirm) {
      toast.error("Please fill in all fields"); return;
    }
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(uname)) {
      toast.error("Username: 3-32 letters, digits, _ . -"); return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`); return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match"); return;
    }

    setLoading(true);
    try {
      // 1. Generate the ML-KEM keypair in the browser. The private key never leaves it.
      const { publicKey, privateKey, kem } = await generateKeyPair();

      // 2. Wrap the private key under the password (PBKDF2-SHA256 600k + AES-GCM).
      const keyFile = await exportEncryptedKeyFile(uname, password, privateKey);

      // 3. Register with ONLY the public key.
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: uname, password, publicKey: toB64(publicKey), kem }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || "Registration failed");
        return;
      }

      // 4. Only after the account exists, hand the user their key file.
      downloadJson(`pqchat_${uname}.pqkey`, keyFile);
      toast.success("Account created! Keep your downloaded .pqkey file safe — it is required to sign in.", { duration: 6000 });
      router.push("/");
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
            <input className="auth-input" type="text" placeholder="choose_a_username" autoComplete="username"
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
