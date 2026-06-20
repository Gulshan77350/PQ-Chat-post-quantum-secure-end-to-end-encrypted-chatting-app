import { useState } from "react";
import toast from "react-hot-toast";
import { Eye, EyeOff, ShieldCheck, UserPlus } from "lucide-react";
import { useRouter } from "next/router";
import { generateKeyPair, saveKeyPair, toB64 } from "../lib/pqcrypto";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername]         = useState("");
  const [password, setPassword]         = useState("");
  const [confirm, setConfirm]           = useState("");
  const [loading, setLoading]           = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim() || !confirm.trim()) {
      toast.error("Please fill in all fields"); return;
    }
    if (password !== confirm) { toast.error("Passwords do not match"); return; }
    if (password.length < 6)  { toast.error("Password must be at least 6 characters"); return; }

    setLoading(true);
    try {
      // 1. Generate Kyber-512 keypair in browser
      const { publicKey, privateKey } = await generateKeyPair();

      // 2. Save privateKey ONLY to localStorage — never sent to server
      saveKeyPair(username, publicKey, privateKey);

      // 3. Register — send publicKey to server (safe, it's public)
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          publicKey: toB64(publicKey),
        }),
      });
      const data = await res.json();
      if (res.ok) { toast.success("Account created!"); router.push("/"); }
      else toast.error(data.message || "Registration failed");
    } catch (err) {
      console.error(err);
      toast.error("Error during registration");
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
        <p className="auth-subtitle">Create your encrypted account</p>

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
