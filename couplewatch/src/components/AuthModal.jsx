import { useState, useEffect } from "react";
import { X, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { ensureUserProfile } from "../lib/utils";

export default function AuthModal({ isOpen, onClose, initialTab = "login" }) {
  const [tab, setTab] = useState(initialTab); // login | signup | forgot | reset
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });

  // Sync tab with initialTab when modal opens
  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setMsg({ type: "", text: "" });
    }
  }, [isOpen, initialTab]);

  // Listen for Password Recovery event
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === "PASSWORD_RECOVERY") {
        setTab("reset");
      }
    });

    return () => {
      if (listener?.subscription) listener.subscription.unsubscribe();
    };
  }, []);

  if (!isOpen) return null;

  async function handleAuth(e) {
    e.preventDefault();
    setLoading(true);
    setMsg({ type: "", text: "" });

    try {
      if (tab === "signup") {
        const { data, error } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            data: {
              full_name: fullName
            }
          }
        });
        if (error) throw error;
        const user = data?.user;
        if (!user) throw new Error("User not returned");

        await supabase.from("profiles").upsert([{ 
          id: user.id, 
          email: user.email, 
          full_name: fullName
        }], { onConflict: "id" });
        setMsg({ type: "success", text: "Account created! Check your email to confirm." });
      } else if (tab === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data?.user) {
          await ensureUserProfile(data.user);
        }
        setMsg({ type: "success", text: "Logged in successfully!" });
        setTimeout(() => {
          onClose();
          window.location.reload();
        }, 500);
      } else if (tab === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: "https://couplewatch.in",
        });
        if (error) throw error;
        setMsg({ type: "success", text: "Reset link sent to your email!" });
      } else if (tab === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setMsg({ type: "success", text: "Password updated! Logging you in..." });
        if (typeof window !== "undefined" && window.history.replaceState) {
          window.history.replaceState(null, "", window.location.pathname);
        }
        setTimeout(() => {
          onClose();
          window.location.reload();
        }, 1500);
      }
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleAuth() {
    setLoading(true);
    setMsg({ type: "", text: "" });
    try {
      const redirectUrl = typeof window !== "undefined" ? window.location.origin : "https://couplewatch.in";
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUrl,
        },
      });
      if (error) throw error;
    } catch (err) {
      setMsg({ type: "error", text: err.message });
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div onClick={onClose} className="absolute inset-0 bg-[#0D0D1A]/80 backdrop-blur-md" />

      <div className="relative w-full max-w-md romantic-card p-10 bg-[#0D0D1A]/60 shadow-2xl border-[#881337]/30">
        <button onClick={onClose} className="absolute right-6 top-6 text-white/40 hover:text-white p-1 rounded-full hover:bg-white/10 transition">
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-3xl font-black mb-2 tracking-tight">
          {tab === "login" && "Welcome Back"}
          {tab === "signup" && "Join the Romance"}
          {tab === "forgot" && "Reset Password"}
          {tab === "reset" && "New Password"}
        </h2>
        <p className="text-[#9090A8] text-sm mb-8 leading-relaxed">
          {tab === "login" && "Log in to sync with your favorite person."}
          {tab === "signup" && "Create an account to start your journey."}
          {tab === "forgot" && "Enter your email to receive a reset link."}
          {tab === "reset" && "Enter your new password below."}
        </p>

        {(tab === "login" || tab === "signup") && (
          <>
            <div className="grid grid-cols-2 bg-black/40 p-1 rounded-full mb-6 border border-white/5">
              <button onClick={() => setTab("login")} className={`py-3 rounded-full text-xs font-black uppercase tracking-widest transition ${tab === "login" ? "bg-white/10 text-white" : "text-[#9090A8]"}`}>Login</button>
              <button onClick={() => setTab("signup")} className={`py-3 rounded-full text-xs font-black uppercase tracking-widest transition ${tab === "signup" ? "bg-white/10 text-white" : "text-[#9090A8]"}`}>Sign Up</button>
            </div>

            <button
              type="button"
              onClick={handleGoogleAuth}
              disabled={loading}
              className="w-full py-3.5 px-4 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold text-xs tracking-wider flex items-center justify-center gap-3 transition-all hover:border-white/20 disabled:opacity-50 mb-6"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>

            <div className="relative mb-6 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <span className="relative bg-[#0D0D1A] px-3 text-[9px] font-black uppercase tracking-widest text-[#9090A8]">
                or continue with email
              </span>
            </div>
          </>
        )}

        <form onSubmit={handleAuth} className="space-y-6">
          {tab === "signup" && (
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#9090A8] mb-3 block">Full Name</label>
              <input 
                type="text" required value={fullName} onChange={e => setFullName(e.target.value)}
                className="romantic-input w-full"
                placeholder="Your Full Name"
              />
            </div>
          )}
          
          {tab !== "reset" && (
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#9090A8] mb-3 block">Email Address</label>
              <input 
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="romantic-input w-full"
                placeholder="you@example.com"
              />
            </div>
          )}
          
          {tab !== "forgot" && (
            <div className="relative">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#9090A8] mb-3 block">
                {tab === "reset" ? "New Password" : "Password"}
              </label>
              <input 
                type={showPassword ? "text" : "password"} 
                required value={password} onChange={e => setPassword(e.target.value)}
                className="romantic-input w-full pr-12"
                placeholder="••••••••"
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 bottom-3.5 text-[#9090A8] hover:text-white transition"
              >
                {showPassword ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.643-9.943-6.442a10.455 10.455 0 011.668-2.633M12 5c4.478 0 8.268 2.643 9.943 6.442a10.455 10.455 0 01-1.668 2.633M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3l18 18" /></svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                )}
              </button>
            </div>
          )}

          {tab === "login" && (
            <div className="text-right">
              <button type="button" onClick={() => setTab("forgot")} className="text-[10px] font-black uppercase tracking-widest text-[#9090A8] hover:text-white transition">
                Forgot Password?
              </button>
            </div>
          )}

          {tab === "forgot" && (
            <div className="text-right">
              <button type="button" onClick={() => setTab("login")} className="text-[10px] font-black uppercase tracking-widest text-[#9090A8] hover:text-white transition">
                Back to Login
              </button>
            </div>
          )}

          {msg.text && (
            <div className={`flex items-center justify-center gap-2 text-xs font-semibold p-3 rounded-xl ${msg.type === "success" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"}`}>
              {msg.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span>{msg.text}</span>
            </div>
          )}

          <button disabled={loading} className="w-full pill-button bg-primary-gradient justify-center py-4 text-sm tracking-widest shadow-xl shadow-rose-600/20 text-white font-bold">
            {loading ? "PROCESSING..." : 
             tab === "login" ? "CONTINUE" : 
             tab === "signup" ? "CREATE ACCOUNT" : 
             tab === "forgot" ? "SEND RESET LINK" : 
             "UPDATE PASSWORD"}
          </button>
        </form>
      </div>
    </div>
  );
}
