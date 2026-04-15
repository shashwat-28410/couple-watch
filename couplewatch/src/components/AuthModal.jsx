import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AuthModal({ isOpen, onClose }) {
  const [tab, setTab] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  if (!isOpen) return null;

  async function handleAuth(e) {
    e.preventDefault();
    setLoading(true);
    setMsg("");

    try {
      if (tab === "signup") {
        // ✅ Proper destructuring
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;

        const user = data?.user;

        if (!user) {
          throw new Error("User was not returned after signup.");
        }

        // 🔥 Insert profile row
        const { error: profileError } = await supabase
          .from("profiles")
          .insert([
            {
              id: user.id,
              email: user.email,
            },
          ]);

        if (profileError) {
          throw profileError;
        }

        setMsg("✅ Account created successfully! You can now log in.");
        setTab("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        setMsg("✅ Logged in!");

        setTimeout(() => {
          onClose();
        }, 500);
      }
    } catch (err) {
      console.error("Auth Error:", err);
      setMsg("❌ " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* modal */}
      <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-white/70 hover:text-white"
        >
          ✕
        </button>

        <h2 className="text-2xl font-bold text-white">
          {tab === "login" ? "Welcome back 💜" : "Create your account ✨"}
        </h2>

        <p className="mt-1 text-sm text-white/70">
          {tab === "login"
            ? "Log in to start watching together."
            : "Sign up to create a private room."}
        </p>

        {/* tabs */}
        <div className="mt-6 grid grid-cols-2 rounded-2xl bg-black/20 p-1">
          <button
            type="button"
            onClick={() => setTab("login")}
            className={`rounded-2xl py-2 text-sm font-semibold transition ${
              tab === "login"
                ? "bg-white/20 text-white"
                : "text-white/70 hover:text-white"
            }`}
          >
            Login
          </button>

          <button
            type="button"
            onClick={() => setTab("signup")}
            className={`rounded-2xl py-2 text-sm font-semibold transition ${
              tab === "signup"
                ? "bg-white/20 text-white"
                : "text-white/70 hover:text-white"
            }`}
          >
            Sign Up
          </button>
        </div>

        {/* form */}
        <form onSubmit={handleAuth} className="mt-6 space-y-4">
          <div>
            <label className="text-sm text-white/80">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none placeholder:text-white/40 focus:border-pink-400/50"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="text-sm text-white/80">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none placeholder:text-white/40 focus:border-pink-400/50"
              placeholder="••••••••"
            />
          </div>

          {msg && <p className="text-sm text-white/80">{msg}</p>}

          <button
            disabled={loading}
            className="w-full rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 py-3 font-semibold text-white shadow-lg shadow-purple-500/20 hover:opacity-95 disabled:opacity-60"
          >
            {loading
              ? "Please wait..."
              : tab === "login"
              ? "Login"
              : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}