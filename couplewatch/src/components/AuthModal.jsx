import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AuthModal({ isOpen, onClose, initialTab = "login" }) {
  const [tab, setTab] = useState(initialTab); // login | signup | forgot | reset
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // Sync tab with initialTab when modal opens
  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setMsg("");
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
    setMsg("");

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

        await supabase.from("profiles").insert([{ 
          id: user.id, 
          email: user.email, 
          full_name: fullName
        }]);
        setMsg("✅ Account created! Check your email to confirm.");
      } else if (tab === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMsg("✅ Logged in!");
        setTimeout(() => {
          onClose();
          window.location.reload();
        }, 500);
      } else if (tab === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setMsg("✅ Reset link sent to your email!");
      } else if (tab === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setMsg("✅ Password updated! Logging you in...");
        setTimeout(() => {
          onClose();
          window.location.reload();
        }, 1500);
      }
    } catch (err) {
      setMsg("❌ " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div onClick={onClose} className="absolute inset-0 bg-[#0D0D1A]/80 backdrop-blur-md" />

      <div className="relative w-full max-w-md romantic-card p-10 bg-[#0D0D1A]/60 shadow-2xl border-[#C84BE0]/20">
        <button onClick={onClose} className="absolute right-6 top-6 text-white/30 hover:text-white transition">✕</button>

        <h2 className="text-3xl font-black mb-2 tracking-tight">
          {tab === "login" && "Welcome back ♡"}
          {tab === "signup" && "Join the Romance ♡"}
          {tab === "forgot" && "Reset Password ♡"}
          {tab === "reset" && "New Password ♡"}
        </h2>
        <p className="text-[#9090A8] text-sm mb-8 leading-relaxed">
          {tab === "login" && "Log in to sync with your favorite person."}
          {tab === "signup" && "Create an account to start your journey."}
          {tab === "forgot" && "Enter your email to receive a reset link."}
          {tab === "reset" && "Enter your new password below."}
        </p>

        {(tab === "login" || tab === "signup") && (
          <div className="grid grid-cols-2 bg-black/40 p-1 rounded-full mb-8 border border-white/5">
            <button onClick={() => setTab("login")} className={`py-3 rounded-full text-xs font-black uppercase tracking-widest transition ${tab === "login" ? "bg-white/10 text-white" : "text-[#9090A8]"}`}>Login</button>
            <button onClick={() => setTab("signup")} className={`py-3 rounded-full text-xs font-black uppercase tracking-widest transition ${tab === "signup" ? "bg-white/10 text-white" : "text-[#9090A8]"}`}>Sign Up</button>
          </div>
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

          {msg && <p className={`text-xs font-bold text-center ${msg.includes("✅") ? "text-green-400" : "text-pink-500"}`}>{msg}</p>}

          <button disabled={loading} className="w-full pill-button bg-primary-gradient justify-center py-4 text-sm tracking-widest shadow-xl shadow-purple-500/20 text-white">
            {loading ? "PROCESSING..." : 
             tab === "login" ? "CONTINUE ♡" : 
             tab === "signup" ? "CREATE ACCOUNT ♡" : 
             tab === "forgot" ? "SEND RESET LINK ♡" : 
             "UPDATE PASSWORD ♡"}
          </button>
        </form>
      </div>
    </div>
  );
}
