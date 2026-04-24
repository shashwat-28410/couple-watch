import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import AuthModal from "./AuthModal";

export default function Navbar({ user }) {
  const navigate = useNavigate();
  const [showAuth, setShowAuth] = useState(false);
  const [authTab, setAuthTab] = useState("login");

  const handleAuth = (tab) => {
    setAuthTab(tab);
    setShowAuth(true);
  };

  const getFirstName = (email) => email ? email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1) : "User";
  const getInitial = (email) => email ? email.charAt(0).toUpperCase() : "U";

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
                {getInitial(user.email)}
              </div>
              <span className="text-white font-medium">{getFirstName(user.email)}</span>
              <button 
                onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
                className="text-[#9090A8] text-sm font-bold hover:text-white transition ml-4"
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
