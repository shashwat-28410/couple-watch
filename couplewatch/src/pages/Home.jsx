import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Navbar from "../components/Navbar";
import AuthModal from "../components/AuthModal";
import { FloatingHearts } from "../components/FloatingHearts";

const IconHeart = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
);

const IconSync = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
);

const IconVideo = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
);

const IconChat = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
);

const ModeCard = ({ title, description, icon }) => (
  <div className="romantic-card max-w-[380px] mx-auto flex flex-col items-center text-center transition-all duration-500 hover:bg-white/[0.04] border-white/5 group">
    <div className="w-20 h-20 rounded-full bg-primary-gradient flex items-center justify-center mb-7 group-hover:scale-105 transition-transform text-white">
      {icon}
    </div>
    <h3 className="text-2xl font-bold mb-4">{title}</h3>
    <p className="text-[#8B8B9A] text-sm leading-[1.8]">{description}</p>
  </div>
);

const FeatureCard = ({ title, description, icon, highlight }) => (
  <div className="romantic-card flex-1 flex flex-col items-center text-center border-white/5">
    <div className="w-14 h-14 rounded-full bg-primary-gradient flex items-center justify-center mb-6 text-white">
      {icon}
    </div>
    <h3 className="text-xl font-bold mb-3">
      {title} <span className="text-primary-gradient">{highlight}</span>
    </h3>
    <p className="text-[#8B8B9A] text-sm leading-[1.8]">{description}</p>
  </div>
);

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalTab, setAuthModalTab] = useState("signup");

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
  }, []);

  // Listen for error messages passed via query string (e.g. from expired room redirect)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const err = params.get("error");
    if (err) {
      setErrorMsg(decodeURIComponent(err));
      // Clean query string from browser bar without reloading
      if (typeof window !== "undefined" && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname);
      }
    }
  }, [location.search]);

  const generateRoomCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

  async function handleStartWatching() {
    setErrorMsg("");
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        setAuthModalTab("signup");
        setShowAuthModal(true);
        return;
      }
      
      setLoading(true);
      const code = generateRoomCode();
      
      // STEP 1: Fast room creation
      const { data: room, error } = await supabase.from("rooms")
        .insert([{ room_code: code, created_by: authUser.id }])
        .select().single();
      
      if (error || !room) throw new Error("Failed to create room");

      // STEP 2: Parallel background tasks
      await Promise.all([
        supabase.from("room_members").insert([{ room_id: room.id, user_id: authUser.id, role: "host" }]),
        supabase.from("room_state").insert([{ room_id: room.id, is_playing: false, current_timestamp_seconds: 0, updated_at: new Date().toISOString() }])
      ]);

      // Background sweep: delete abandoned rooms older than 1 hour
      const ONE_HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      supabase
        .from("room_state")
        .select("room_id")
        .lt("updated_at", ONE_HOUR_AGO)
        .then(({ data: expiredStates }) => {
          if (expiredStates && expiredStates.length > 0) {
            const ids = expiredStates.map(s => s.room_id);
            Promise.all([
              supabase.from("messages").delete().in("room_id", ids),
              supabase.from("room_memories").delete().in("room_id", ids),
              supabase.from("room_members").delete().in("room_id", ids),
              supabase.from("room_state").delete().in("room_id", ids)
            ]).then(() => {
              supabase.from("rooms").delete().in("id", ids).catch(() => {});
            }).catch(() => {});
          }
        }).catch(() => {});

      // FAST NAVIGATE: Go to room as soon as its state and membership are initialized
      navigate(`/room/${code}`);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom() {
    const code = roomCodeInput.trim().toUpperCase();
    if (!code) {
      setErrorMsg("Please enter a room code");
      return;
    }

    setErrorMsg("");
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        setAuthModalTab("login");
        setShowAuthModal(true);
        return;
      }
      
      setLoading(true);

      // Verify room exists & check if abandoned for > 1 hour
      const { data: roomData } = await supabase
        .from("rooms")
        .select("id, created_at")
        .eq("room_code", code)
        .maybeSingle();

      if (!roomData) {
        setErrorMsg("Room not found or already deleted");
        setLoading(false);
        return;
      }

      const { data: stateData } = await supabase
        .from("room_state")
        .select("updated_at")
        .eq("room_id", roomData.id)
        .maybeSingle();

      const lastActive = stateData?.updated_at || roomData.created_at;
      const ONE_HOUR_MS = 60 * 60 * 1000;
      if (lastActive && (Date.now() - new Date(lastActive).getTime() > ONE_HOUR_MS)) {
        // Expired! Delete all room data from database
        await Promise.all([
          supabase.from("messages").delete().eq("room_id", roomData.id),
          supabase.from("room_memories").delete().eq("room_id", roomData.id),
          supabase.from("room_members").delete().eq("room_id", roomData.id),
          supabase.from("room_state").delete().eq("room_id", roomData.id)
        ]).catch(() => {});
        await supabase.from("rooms").delete().eq("id", roomData.id).catch(() => {});

        setErrorMsg("This room expired and was deleted after 1 hour of inactivity");
        setLoading(false);
        return;
      }

      // Navigate to active room
      navigate(`/room/${code}`);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] flex flex-col items-center">
      <div className="w-full absolute top-0 z-50">
        <Navbar user={user} />
      </div>

      <section className="relative w-full min-h-screen flex flex-col items-center justify-center pt-32 pb-20 overflow-hidden">
        <FloatingHearts />
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-black/90 z-10" />
          <div className="absolute inset-0 z-20 bg-[radial-gradient(circle,rgba(159,18,57,0.08)_0%,rgba(10,10,15,0)_70%)]" />
          <img src="https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=2000&auto=format&fit=crop" className="w-full h-full object-cover opacity-30 grayscale" alt="Hero Background" />
        </div>

        <div className="relative z-30 w-full max-w-7xl px-8 flex flex-col items-center text-center">
          <h1 className="text-6xl md:text-7xl font-bold mb-8 tracking-tight text-white">Couple Watch Party, <br /><span className="text-primary-gradient">Stay connected.</span></h1>
          <p className="max-w-2xl text-[#8B8B9A] text-[17px] mb-14 leading-[1.8]">The premier watch party for couples. Experience movies in perfect sync with your partner, no matter the distance. Feel close, share emotions, and create memories.</p>

          <div className="w-full mb-16 flex justify-center">
            <ModeCard title="Couples mode" icon={<IconHeart />} description="Synchronized playback, video call and intimate chat for two lovers miles apart." />
          </div>

          <div className="flex flex-col md:flex-row gap-6 mb-20 items-center justify-center w-full">
            <button onClick={handleStartWatching} disabled={loading} className="pill-button bg-primary-gradient px-12 h-[56px] text-white disabled:opacity-50">Start watching now</button>
            <div className="flex gap-3 h-[56px]">
              <input className="romantic-input w-52 h-full text-center tracking-widest placeholder:text-[#55556A]" placeholder="ROOM CODE" value={roomCodeInput} onChange={e => setRoomCodeInput(e.target.value.toUpperCase())} />
              <button onClick={handleJoinRoom} disabled={loading} className="px-12 py-3 rounded-full border border-white/10 font-bold hover:bg-white/5 transition h-full text-white/80 disabled:opacity-50">Join</button>
            </div>
          </div>
          {errorMsg && <p className="mb-10 text-rose-400 font-medium">{errorMsg}</p>}
        </div>
      </section>

      <section className="w-full max-w-6xl px-8 py-40">
        <h2 className="text-5xl md:text-6xl font-bold text-center mb-24"><span className="text-white">Perfect for</span> <br /><span className="text-primary-gradient">long distance love</span></h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <FeatureCard title="Synchronized" highlight="playback" icon={<IconSync />} description="Our advanced sync engine ensures both partners are watching the exact same frame. Pause for one, and it pauses for both." />
          <FeatureCard title="Video" highlight="call" icon={<IconVideo />} description="See your partner's reactions in real-time. Share every laugh and tear as if you were sitting right next to each other." />
          <FeatureCard title="Real-time" highlight="chat" icon={<IconChat />} description="Whisper sweet nothings or debate the plot in our intimate chat window. Real-time typing indicators make it feel alive." />
        </div>
      </section>

      <footer className="w-full py-12 border-t border-white/5 text-center text-[#55556A] text-[10px] font-bold uppercase tracking-[0.4em]">&copy; 2026 CoupleWatch. Built for lovers across any distance.</footer>

      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)} 
        initialTab={authModalTab} 
      />
    </div>
  );
}
