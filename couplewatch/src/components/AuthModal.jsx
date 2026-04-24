import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AuthModal({ isOpen, onClose, initialTab = "login" }) {
  const [tab, setTab] = useState(initialTab); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // Sync tab with initialTab when modal opens
  useEffect(() => {
    if (isOpen) setTab(initialTab);
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  async function handleAuth(e) {
    e.preventDefault();
    setLoading(true);
    setMsg("");

    try {
      if (tab === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        const user = data?.user;
        if (!user) throw new Error("User not returned");

        await supabase.from("profiles").insert([{ id: user.id, email: user.email }]);
        setMsg("✅ Account created! You can now log in.");
        setTab("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMsg("✅ Logged in!");
        setTimeout(() => onClose(), 500);
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
          {tab === "login" ? "Welcome back ♡" : "Join the Romance ♡"}
        </h2>
        <p className="text-[#9090A8] text-sm mb-8 leading-relaxed">
          {tab === "login" ? "Log in to sync with your favorite person." : "Create an account to start your journey."}
        </p>

        <div className="grid grid-cols-2 bg-black/40 p-1 rounded-full mb-8 border border-white/5">
          <button onClick={() => setTab("login")} className={`py-3 rounded-full text-xs font-black uppercase tracking-widest transition ${tab === "login" ? "bg-white/10 text-white" : "text-[#9090A8]"}`}>Login</button>
          <button onClick={() => setTab("signup")} className={`py-3 rounded-full text-xs font-black uppercase tracking-widest transition ${tab === "signup" ? "bg-white/10 text-white" : "text-[#9090A8]"}`}>Sign Up</button>
        </div>

        <form onSubmit={handleAuth} className="space-y-6">
          <div>
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#9090A8] mb-3 block">Email Address</label>
            <input 
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="romantic-input w-full"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#9090A8] mb-3 block">Password</label>
            <input 
              type="password" required value={password} onChange={e => setPassword(e.target.value)}
              className="romantic-input w-full"
              placeholder="••••••••"
            />
          </div>

          {msg && <p className={`text-xs font-bold text-center ${msg.includes("✅") ? "text-green-400" : "text-pink-500"}`}>{msg}</p>}

          <button disabled={loading} className="w-full pill-button bg-primary-gradient justify-center py-4 text-sm tracking-widest shadow-xl shadow-purple-500/20 text-white">
            {loading ? "PROCESSING..." : tab === "login" ? "CONTINUE ♡" : "CREATE ACCOUNT ♡"}
          </button>
        </form>
      </div>
    </div>
  );
}
