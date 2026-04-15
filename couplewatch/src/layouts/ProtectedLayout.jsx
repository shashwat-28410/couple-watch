import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import AuthModal from "../components/AuthModal";

export default function ProtectedLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeRoomCode, setActiveRoomCode] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
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
        (_event, newSession) => {
          setSession(newSession);
        }
      );

      return () => listener.subscription.unsubscribe();      
    } catch (e) {
      setCritError("Auth Init Error: " + e.message);
    }
  }, []);

  // 🧠 Check membership when session changes
  useEffect(() => {
    const checkMembership = async () => {
      try {
        if (!session?.user) {
          setShowAuth(true);
          return;
        }

        setShowAuth(false);

        const { data, error } = await supabase
          .from("room_members")
          .select("rooms(room_code)")
          .eq("user_id", session.user.id)
          .single();

        if (error && error.code !== "PGRST116") {
          console.error("Membership error:", error);
        }

        const roomCode = data?.rooms?.room_code || null;
        setActiveRoomCode(roomCode);

        // 🔄 Redirect logic
        if (roomCode && location.pathname === "/") {
          navigate(`/room/${roomCode}`, { replace: true });
        }

        if (!roomCode && location.pathname.startsWith("/room")) {
          navigate("/", { replace: true });
        }
      } catch (err) {
        console.error("Critical Layout Error:", err);
        setCritError("Layout Error: " + err.message);
      } finally {
        setLoading(false);
      }
    };

    checkMembership();
  }, [session, location.pathname]);

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

  // 💜 Branded loading screen
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0b0b15] via-[#0c0c1c] to-[#0a0a12] text-white">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-purple-400 mb-3">
            CoupleWatch
          </h1>
          <p className="text-gray-300">Checking your room… 💜</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Outlet />
      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />
    </>
  );
}