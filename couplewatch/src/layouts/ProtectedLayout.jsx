import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import AuthModal from "../components/AuthModal";

export default function ProtectedLayout() {
  const location = useLocation();
  const isHome = location.pathname === "/";

  const isRecoveryFromUrl = typeof window !== "undefined" && (
    window.location.hash.includes("type=recovery") ||
    window.location.search.includes("type=recovery")
  );

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(!isHome);
  const [showAuth, setShowAuth] = useState(isRecoveryFromUrl);
  const [initialTab, setInitialTab] = useState(isRecoveryFromUrl ? "reset" : "login");
  const [isRecovering, setIsRecovering] = useState(isRecoveryFromUrl);
  const [critError, setCritError] = useState(null);

  // 🔐 Load session + listen for auth changes
  useEffect(() => {
    try {
      const init = async () => {
        const { data } = await supabase.auth.getSession();
        setSession(data.session || null);
      };

      init();

      const { data: listener } = supabase.auth.onAuthStateChange(
        (event, newSession) => {
          setSession(newSession);
          if (event === "PASSWORD_RECOVERY") {
            setIsRecovering(true);
            setInitialTab("reset");
            setShowAuth(true);
          }
        }
      );

      return () => listener.subscription.unsubscribe();      
    } catch (e) {
      setCritError("Auth Init Error: " + e.message);
    }
  }, []);

  // 🧠 Check session when it changes
  useEffect(() => {
    const checkAuth = async () => {
      try {
        if (isRecovering) {
          // Keep modal open for password reset
          setShowAuth(true);
        } else if (!isHome && !session?.user) {
          // Only prompt login on protected routes (like /room/:code)
          setShowAuth(true);
        } else {
          setShowAuth(false);
        }
      } catch (err) {
        console.error("Critical Layout Error:", err);
        setCritError("Layout Error: " + err.message);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [session, isRecovering, isHome]);

  if (critError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-900 text-white p-10">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold mb-4">CRITICAL ERROR</h1>
          <p className="bg-black/20 p-4 rounded mb-4 font-mono text-sm">{critError}</p>
          <button onClick={() => window.location.reload()} className="bg-white text-red-900 px-6 py-2 rounded-full font-bold">Try Reloading</button>
        </div>
      </div>
    );
  }

  // Branded loading screen
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0b0b15] via-[#0c0c1c] to-[#0a0a12] text-white">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mb-2" />
          <h1 className="text-2xl font-black text-primary-gradient tracking-tight">
            CoupleWatch
          </h1>
          <p className="text-[#8B8B9A] text-xs font-semibold tracking-wider">Connecting to your room...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Outlet />
      <AuthModal 
        isOpen={showAuth} 
        onClose={() => {
          setShowAuth(false);
          setIsRecovering(false);
        }} 
        initialTab={initialTab} 
      />
    </>
  );
}