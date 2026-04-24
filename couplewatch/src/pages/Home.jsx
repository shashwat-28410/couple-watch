import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Navbar from "../components/Navbar";

const FloatingHearts = () => {
  const [hearts, setHearts] = useState([]);
  useEffect(() => {
    const newHearts = Array.from({ length: 15 }).map((_, i) => ({
      id: i,
      left: Math.random() * 100 + "%",
      delay: Math.random() * 15 + "s",
      duration: 10 + Math.random() * 10 + "s",
      size: 10 + Math.random() * 20 + "px"
    }));
    setHearts(newHearts);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {hearts.map(h => (
        <span key={h.id} className="heart-particle" style={{ left: h.left, animationDelay: h.delay, animationDuration: h.duration, fontSize: h.size }}>♡</span>
      ))}
    </div>
  );
};

const ModeCard = ({ title, description, icon }) => (
  <div className="romantic-card max-w-[380px] mx-auto flex flex-col items-center text-center transition-all duration-500 hover:bg-white/[0.04] border-white/5 group">
    <div className="w-20 h-20 rounded-full bg-primary-gradient flex items-center justify-center text-4xl mb-7 group-hover:scale-105 transition-transform text-white">
      {icon}
    </div>
    <h3 className="text-2xl font-bold mb-4">{title}</h3>
    <p className="text-[#8B8B9A] text-sm leading-[1.8]">{description}</p>
  </div>
);

const FeatureCard = ({ title, description, icon, highlight }) => (
  <div className="romantic-card flex-1 flex flex-col items-center text-center border-white/5">
    <div className="w-14 h-14 rounded-full bg-primary-gradient flex items-center justify-center text-2xl mb-6 text-white">
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
  const [loading, setLoading] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [user, setUser] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
  }, []);

  const generateRoomCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

  async function handleStartWatching() {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Please log in first ❤️");
      const code = generateRoomCode();
      const { data: room } = await supabase.from("rooms").insert([{ room_code: code, created_by: authUser.id }]).select().single();
      await supabase.from("room_members").insert([{ room_id: room.id, user_id: authUser.id, role: "host" }]);
      await supabase.from("room_state").insert([{ room_id: room.id, is_playing: false, current_timestamp_seconds: 0 }]);
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
      setErrorMsg("Please enter a room code ❤️");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Please log in first ❤️");
      
      const { data: room, error: roomError } = await supabase.from("rooms").select("*").eq("room_code", code).maybeSingle();
      if (roomError || !room) throw new Error("Room not found");
      
      const { data: existingMember } = await supabase.from("room_members")
        .select("*")
        .eq("room_id", room.id)
        .eq("user_id", authUser.id)
        .maybeSingle();

      if (!existingMember) {
        await supabase.from("room_members").insert([{ room_id: room.id, user_id: authUser.id, role: "member" }]);
      }
      
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
          <h1 className="text-6xl md:text-7xl font-bold mb-8 tracking-tight text-white">Watch together, <br /><span className="text-primary-gradient">Stay connected.</span></h1>
          <p className="max-w-2xl text-[#8B8B9A] text-[17px] mb-14 leading-[1.8]">Experience movies in perfect sync with your partner, no matter the distance. Feel close, share emotions, and create memories ❤️</p>

          <div className="w-full mb-16 flex justify-center">
            <ModeCard title="Couples mode" icon="♡" description="Synchronized playback and intimate chat for two lovers miles apart." />
          </div>

          <div className="flex flex-col md:flex-row gap-6 mb-20 items-center justify-center w-full">
            <button onClick={handleStartWatching} className="pill-button bg-primary-gradient px-12 h-[56px] text-white">Start watching now</button>
            <div className="flex gap-3 h-[56px]">
              <input className="romantic-input w-52 h-full text-center tracking-widest placeholder:text-[#55556A]" placeholder="ROOM CODE" value={roomCodeInput} onChange={e => setRoomCodeInput(e.target.value.toUpperCase())} />
              <button onClick={handleJoinRoom} className="px-12 py-3 rounded-full border border-white/10 font-bold hover:bg-white/5 transition h-full text-white/80">Join</button>
            </div>
          </div>
          {errorMsg && <p className="mb-10 text-rose-400 font-medium">{errorMsg}</p>}
        </div>
      </section>

      <section className="w-full max-w-6xl px-8 py-40">
        <h2 className="text-5xl md:text-6xl font-bold text-center mb-24"><span className="text-white">Perfect for</span> <br /><span className="text-primary-gradient">long distance love</span></h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <FeatureCard title="Synchronized" highlight="playback" icon="🔄" description="Our advanced sync engine ensures both partners are watching the exact same frame. Pause for one, and it pauses for both." />
          <FeatureCard title="Real-time" highlight="chat" icon="💬" description="Whisper sweet nothings or debate the plot in our intimate chat window. Real-time typing indicators make it feel alive." />
        </div>
      </section>

      <footer className="w-full py-12 border-t border-white/5 text-center text-[#55556A] text-[10px] font-bold uppercase tracking-[0.4em]">&copy; 2026 CoupleWatch. Built with ❤️ for lovers.</footer>
    </div>
  );
}
