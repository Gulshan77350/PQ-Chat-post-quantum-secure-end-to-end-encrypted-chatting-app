import { ShieldCheck, KeyRound, Settings, AlertTriangle } from "lucide-react";
import { useRouter } from "next/router";

// There is intentionally no "reset password by username" endpoint. PQChat is
// non-custodial: the password wraps the private key inside the .pqkey file, and the
// server never holds that key. A server-side reset would either be an account-takeover
// primitive (anyone could reset anyone) or would still leave the key file locked.
export default function ForgotPassword() {
  const router = useRouter();

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <ShieldCheck size={22} color="#6ee7b7" />
          </div>
          <span className="auth-logo-text">PQChat</span>
        </div>
        <p className="auth-subtitle">Password recovery</p>

        <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
          <div className="flex gap-2.5 bg-slate-900/70 border border-slate-800 rounded-xl p-3">
            <KeyRound size={16} className="text-emerald-400 shrink-0 mt-0.5" />
            <p>
              Your password encrypts your private key inside your <b>.pqkey</b> file. The server never
              sees that key, so it <b>cannot</b> reset your password or recover your messages for you.
              That is what end-to-end encryption means.
            </p>
          </div>

          <div className="flex gap-2.5 bg-slate-900/70 border border-slate-800 rounded-xl p-3">
            <Settings size={16} className="text-emerald-400 shrink-0 mt-0.5" />
            <p>
              <b>Know your password and want a new one?</b> Sign in, then open <b>Settings → Change password</b>.
              You will get a new .pqkey file wrapped under the new password, and your other devices are signed out.
            </p>
          </div>

          <div className="flex gap-2.5 bg-rose-950/30 border border-rose-900/50 rounded-xl p-3">
            <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
            <p>
              <b>Lost the password or the .pqkey file?</b> The account cannot be recovered. Register a new account
              and share your new safety number with your contacts.
            </p>
          </div>
        </div>

        <p className="auth-divider">Remembered your password?</p>
        <div style={{ textAlign: "center" }}>
          <button className="auth-link-btn" onClick={() => router.push("/")}>Sign in</button>
          &nbsp;·&nbsp;
          <button className="auth-link-btn" onClick={() => router.push("/register")}>Create account</button>
        </div>
      </div>
    </div>
  );
}
