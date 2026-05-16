import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import AuthModal from "../components/AuthModal";

/**
 * JoinViaLink — handles /join/:roomCode invite links.
 * Auto-validates the room and joins the user in, or shows appropriate error states.
 */
export default function JoinViaLink() {
  const { roomCode } = useParams();
  const navigate = useNavigate();

  const [status, setStatus] = useState("CHECKING"); // CHECKING | AUTH | JOINING | ERROR
  const [errorMsg, setErrorMsg] = useState("");
  const [showAuth, setShowAuth] = useState(false);

  const attemptJoin = async () => {
    setStatus("CHECKING");
    try {
      // 1. Ensure user is authenticated
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setStatus("AUTH");
        setShowAuth(true);
        return;
      }

      // 2. Validate room exists
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .select("*")
        .eq("room_code", roomCode.toUpperCase())
        .maybeSingle();

      if (roomError || !room) {
        throw new Error("This invite link is invalid or the room no longer exists 💔");
      }

      // 3. Check if user is already a member (rejoining is always allowed)
      const { data: existingMember } = await supabase
        .from("room_members")
        .select("id")
        .eq("room_id", room.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!existingMember) {
        // 4. Count current members to enforce 2-person limit
        const { count } = await supabase
          .from("room_members")
          .select("*", { count: "exact", head: true })
          .eq("room_id", room.id);

        if (count >= 2) {
          throw new Error("This room is full 💔 Only 2 people can watch together.");
        }

        // 5. Join as member
        await supabase.from("room_members").insert([
          { room_id: room.id, user_id: user.id, role: "member" },
        ]);
      }

      setStatus("JOINING");

      // Small delay so the user sees the "Joining…" state
      setTimeout(() => navigate(`/room/${room.room_code}`), 700);
    } catch (err) {
      setStatus("ERROR");
      setErrorMsg(err.message);
    }
  };

  // Run on mount
  useEffect(() => {
    attemptJoin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // After the auth modal closes, retry if the user is now signed in
  const handleAuthClose = () => {
    setShowAuth(false);
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) attemptJoin();
      else setStatus("AUTH");
    });
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] flex flex-col items-center justify-center text-white px-4">
      {/* Brand */}
      <div
        className="text-2xl font-black text-primary-gradient tracking-tighter mb-12 cursor-pointer select-none"
        onClick={() => navigate("/")}
      >
        ♡ COUPLEWATCH
      </div>

      {/* Status card */}
      <div className="romantic-card max-w-md w-full text-center shadow-[0_30px_80px_rgba(0,0,0,0.85)] border-[#881337]/20 animate-in fade-in duration-500">
        {/* ── Loading states ── */}
        {(status === "CHECKING" || status === "JOINING") && (
          <>
            <div className="w-20 h-20 mx-auto mb-8 relative">
              <div className="absolute inset-0 border-4 border-rose-500/10 rounded-full" />
              <div className="absolute inset-0 border-4 border-t-rose-500 rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center text-2xl">
                {status === "JOINING" ? "🚪" : "🔍"}
              </div>
            </div>
            <h2 className="text-base font-black uppercase tracking-[0.25em] text-white mb-3">
              {status === "JOINING" ? "Joining Room…" : "Checking Invite…"}
            </h2>
            <p className="text-[#55556A] text-sm">
              Room Code:{" "}
              <span className="text-white/50 font-bold">
                {roomCode?.toUpperCase()}
              </span>
            </p>
          </>
        )}

        {/* ── Auth required ── */}
        {status === "AUTH" && (
          <>
            <div className="text-5xl mb-6">💌</div>
            <h2 className="text-base font-black uppercase tracking-[0.25em] text-white mb-3">
              Sign in to join
            </h2>
            <p className="text-[#8B8B9A] text-sm mb-8 leading-relaxed">
              You need an account to join this watch room.
              <br />
              It only takes a second ❤️
            </p>
            <button
              onClick={() => setShowAuth(true)}
              className="pill-button bg-primary-gradient text-white w-full justify-center shadow-[0_10px_25px_rgba(136,19,55,0.25)]"
            >
              Sign In / Sign Up
            </button>
          </>
        )}

        {/* ── Error ── */}
        {status === "ERROR" && (
          <>
            <div className="text-5xl mb-6">💔</div>
            <h2 className="text-base font-black uppercase tracking-[0.25em] text-white mb-3">
              Couldn&apos;t Join
            </h2>
            <p className="text-[#8B8B9A] text-sm mb-8 leading-relaxed">
              {errorMsg}
            </p>
            <button
              onClick={() => navigate("/")}
              className="pill-button bg-white/5 border border-white/10 text-white w-full justify-center hover:bg-white/10"
            >
              Go Home
            </button>
          </>
        )}
      </div>

      <AuthModal
        isOpen={showAuth}
        onClose={handleAuthClose}
        initialTab="login"
      />
    </div>
  );
}
