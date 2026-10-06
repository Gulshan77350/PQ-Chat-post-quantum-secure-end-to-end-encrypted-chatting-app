import { useState, useRef } from "react";
import { useRouter } from "next/router";
import toast from "react-hot-toast";
import { Eye, EyeOff, ShieldCheck, Lock, Key, CheckCircle2 } from "lucide-react";
import { decryptKeyFile, saveSessionPrivateKey, proveKeyPossession } from "../lib/pqcrypto";
import { setAccessToken } from "../lib/session";

export default function Home() {
  const router = useRouter();
  const fileInputRef = useRef(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keyFileContent, setKeyFileContent] = useState(null);
  const [keyFileName, setKeyFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const processFile = (file) => {
    if (!file) return;
    if (!file.name.endsWith(".pqkey") && !file.name.endsWith(".json")) {
      toast.error("Please upload a valid .pqkey key file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!parsed.salt || !parsed.iv || !parsed.encryptedPrivateKey) {
          toast.error("Invalid .pqkey file structure");
          return;
        }
        setKeyFileContent(parsed);
        setKeyFileName(file.name);
        toast.success(`Loaded key file: ${file.name}`);
      } catch (err) {
        toast.error("Failed to parse key file");
      }
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    processFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    processFile(file);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    const uname = username.trim();
    if (!uname || !password) {
      toast.error("Please enter username and password");
      return;
    }
    // The private key is a second factor: the server checks we hold it (see below).
    if (!keyFileContent) {
      toast.error("Private key file (.pqkey) is required for login");
      return;
    }
    if (keyFileContent.username && keyFileContent.username !== uname) {
      toast.error(`This key file belongs to "${keyFileContent.username}"`);
      return;
    }

    setLoading(true);
    try {
      // 1. Unwrap the private key locally. The password never leaves the browser for this step.
      let privateKey;
      try {
        privateKey = await decryptKeyFile(password, keyFileContent);
      } catch (decryptErr) {
        toast.error("Key file decryption failed. Check your password and key file.");
        return;
      }

      // 2. Ask the server for an ML-KEM challenge encapsulated to our pinned public key,
      //    and answer it by decapsulating with the private key (proof of possession).
      const chRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: uname }),
      });
      const challenge = await chRes.json();
      if (!chRes.ok) {
        toast.error(challenge.message || "Sign in failed");
        return;
      }
      const proof = await proveKeyPossession(challenge, privateKey);

      // 3. Password + proof → session (refresh cookie + in-memory access token).
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: uname, password, challengeId: challenge.challengeId, proof }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || "Invalid credentials");
        return;
      }

      saveSessionPrivateKey(data.username, privateKey);
      setAccessToken(data.accessToken);
      sessionStorage.setItem("username", data.username);
      toast.success("Authenticated & key verified");
      router.push("/chat");
    } catch (err) {
      console.error(err);
      toast.error("Server error during sign in.");
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
        <p className="auth-subtitle">Post-Quantum Non-Custodial Encrypted Messaging</p>

        <form onSubmit={handleLogin}>
          <div className="auth-field">
            <label className="auth-label">Username</label>
            <input
              className="auth-input"
              type="text"
              placeholder="your_username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div className="auth-field">
            <label className="auth-label">Password</label>
            <div className="auth-input-wrap">
              <input
                className="auth-input"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{ paddingRight: "40px" }}
              />
              <button type="button" className="auth-eye" onClick={() => setShowPassword((s) => !s)}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* KEYFILE UPLOADER */}
          <div className="auth-field">
            <div
              className={`rounded-xl p-2.5 text-center cursor-pointer transition-all ${
                isDragging ? "bg-emerald-950/60" : "bg-slate-900/60 hover:bg-slate-800/80"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pqkey,.json"
                className="hidden"
                onChange={handleFileChange}
              />
              {keyFileName ? (
                <div className="flex items-center justify-center gap-2 text-emerald-400 text-xs font-medium">
                  <CheckCircle2 size={15} />
                  <span>{keyFileName}</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 font-normal">
                  <Key size={13} className="text-emerald-400/80" />
                  <span>Upload your private key 📁</span>
                </div>
              )}
            </div>
          </div>

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? "Decrypting Key & Signing In…" : <><Lock size={14} /> Sign In</>}
          </button>
        </form>

        <p className="auth-divider">Don't have an account?</p>
        <div style={{ textAlign: "center" }}>
          <button className="auth-link-btn" onClick={() => router.push("/register")}>Create account</button>
          &nbsp;·&nbsp;
          <button className="auth-link-btn" onClick={() => router.push("/forgot_password")}>Forgot password?</button>
        </div>
      </div>
    </div>
  );
}

