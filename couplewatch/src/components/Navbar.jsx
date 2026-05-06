import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import AuthModal from "./AuthModal";

export default function Navbar({ user }) {
  const navigate = useNavigate();
  const [showAuth, setShowAuth] = useState(false);
  const [authTab, setAuthTab] = useState("login");
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (user) {
      supabase
        .from("profiles")
        .select("full_name, avatar")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (data) setProfile(data);
        });
    }
  }, [user]);

  const handleAuth = (tab) => {
    setAuthTab(tab);
    setShowAuth(true);
  };

  const displayName = profile?.full_name || user?.email?.split('@')[0] || "User";
  const displayInitial = displayName.charAt(0).toUpperCase();

  return (
    <>
      <nav className="w-full h-24 flex items-center justify-between px-8 z-50">
        <div 
          className="flex items-center gap-2 text-2xl font-black text-primary-gradient tracking-tighter cursor-pointer"
          onClick={() => navigate("/")}
        >
          ♡ COUPLEWATCH
        </div>

        <div className="flex items-center gap-6">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-gradient flex items-center justify-center text-white font-bold shadow-lg shadow-purple-500/20">
                {displayInitial}
              </div>
              <span className="text-white font-bold tracking-tight">{displayName}</span>
              <button 
                onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
                className="text-[#9090A8] text-[10px] font-black uppercase tracking-widest hover:text-rose-500 transition ml-4"
              >
                Log out
              </button>
            </div>
          ) : (
            <>
              <button 
                onClick={() => handleAuth("login")}
                className="text-white font-bold hover:text-purple-400 transition text-sm"
              >
                Login
              </button>
              <button 
                onClick={() => handleAuth("signup")}
                className="pill-button bg-primary-gradient text-sm text-white px-6 py-2 shadow-lg shadow-purple-500/20"
              >
                Sign Up
              </button>
            </>
          )}
        </div>
      </nav>
      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} initialTab={authTab} />
    </>
  );
}
