import { useState } from "react";
import toast from "react-hot-toast";
import { Eye, EyeOff, ShieldCheck, KeyRound } from "lucide-react";
import { useRouter } from "next/router";

export default function ForgotPassword() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

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

  const strength = getPasswordStrength(newPassword);

  const handleReset = async (e) => {
    e.preventDefault();

    if (!username.trim() || !newPassword.trim() || !confirm.trim()) {
      toast.error("Please fill in all fields!");
      return;
    }

    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters long");
      return;
    }

    if (newPassword !== confirm) {
      toast.error("Passwords do not match!");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), newPassword }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success("Password reset successful! Redirecting to login...");
        setUsername("");
        setNewPassword("");
        setConfirm("");
        setTimeout(() => router.replace("/"), 1500);
      } else {
        toast.error(data.message || "Password reset failed!");
      }
    } catch (error) {
      console.error("Error resetting password:", error);
      toast.error("Something went wrong. Please try again.");
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
        <p className="auth-subtitle">Reset your account password</p>

        <form onSubmit={handleReset}>
          <div className="auth-field">
            <label className="auth-label">Username</label>
            <input
              className="auth-input"
              type="text"
              placeholder="your_username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="auth-field">
            <label className="auth-label">New Password</label>
            <div className="auth-input-wrap">
              <input
                className="auth-input"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={{ paddingRight: "40px" }}
              />
              <button
                type="button"
                className="auth-eye"
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="auth-field">
            <label className="auth-label">Confirm Password</label>
            <div className="auth-input-wrap">
              <input
                className="auth-input"
                type={showConfirm ? "text" : "password"}
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                style={{ paddingRight: "40px" }}
              />
              <button
                type="button"
                className="auth-eye"
                onClick={() => setShowConfirm((s) => !s)}
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* PASSWORD STRENGTH INDICATOR NEAR SUBMIT BUTTON */}
          {newPassword && (
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
            {loading ? (
              "Resetting password…"
            ) : (
              <>
                <KeyRound size={14} /> Reset Password
              </>
            )}
          </button>
        </form>

        <p className="auth-divider">Remembered your password?</p>
        <div style={{ textAlign: "center" }}>
          <button className="auth-link-btn" onClick={() => router.push("/")}>
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
}
