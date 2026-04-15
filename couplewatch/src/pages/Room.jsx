import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function Room() {
  const { code } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  
  // Persistence Refs
  const channelRef = useRef(null);
  const roomStateRef = useRef(null);
  const isHostRef = useRef(false);
  const hasInteractedRef = useRef(false);

  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [roomState, setRoomState] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [status, setStatus] = useState("Connecting...");
  const [connectionStatus, setConnectionStatus] = useState("...");
  const [driftValue, setDriftValue] = useState(0);
  const [newVideoUrl, setNewVideoUrl] = useState("");

  // Keep refs updated
  useEffect(() => { roomStateRef.current = roomState; }, [roomState]);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { hasInteractedRef.current = hasInteracted; }, [hasInteracted]);

  const updateStateIfNewer = (newState) => {
    setRoomState(prev => {
      if (!prev) return newState;
      const isUrlChange = newState.video_url !== undefined && newState.video_url !== prev.video_url;
      const isStateChange = newState.is_playing !== undefined && newState.is_playing !== prev.is_playing;
      const isNewerTime = newState.current_timestamp_seconds > prev.current_timestamp_seconds;
      const isLargeJump = Math.abs((newState.current_timestamp_seconds || 0) - (prev.current_timestamp_seconds || 0)) > 3;

      if (isUrlChange || isStateChange || isNewerTime || isLargeJump) {
        return { ...prev, ...newState };
      }
      return prev;
    });
  };

  // 1. Initial Load
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: roomData } = await supabase.from("rooms").select("*").eq("room_code", code).single();
      if (!roomData) { setStatus("❌ Room not found"); return; }
      setRoom(roomData);

      const { data: mData } = await supabase.from("room_members").select("id, role, user_id, profiles(email)").eq("room_id", roomData.id);
      setMembers(mData || []);
      setIsHost(mData?.find(m => m.user_id === user.id)?.role === "host");

      const { data: sData } = await supabase.from("room_state").select("*").eq("room_id", roomData.id).single();
      if (sData) { setRoomState(sData); roomStateRef.current = sData; }
      setStatus("Connected ✅");
    }
    init();
  }, [code]);

  // 2. CONSOLIDATED "GOD CHANNEL" (State + Broadcast + Presence + Members)
  useEffect(() => {
    if (!room?.id) return;

    const channel = supabase.channel(`room_v2:${room.id}`, {
      config: { presence: { key: "user" }, ack: true }
    });
    
    channelRef.current = channel;

    channel
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "room_state", filter: `room_id=eq.${room.id}` }, 
        (p) => updateStateIfNewer(p.new)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${room.id}` }, 
        async () => {
          const { data } = await supabase.from("room_members").select("id, role, user_id, profiles(email)").eq("room_id", room.id);
          setMembers(data || []);
        }
      )
      .on("broadcast", { event: "sync-event" }, ({ payload }) => {
        updateStateIfNewer(payload);
        if (!isHostRef.current && videoRef.current && hasInteractedRef.current) {
          if (payload.is_playing === false) {
            videoRef.current.pause();
            videoRef.current.currentTime = payload.current_timestamp_seconds;
          } else {
            videoRef.current.play().catch(() => {});
          }
        }
      })
      .on("presence", { event: "sync" }, () => {
        setOnlineUsers(Object.keys(channel.presenceState()));
      })
      .subscribe((s) => {
        setConnectionStatus(s);
        if (s === "SUBSCRIBED") channel.track({ online_at: new Date().toISOString() });
        if (s === "CLOSED" || s === "TIMED_OUT") setTimeout(() => channel.subscribe(), 2000);
      });

    return () => { supabase.removeChannel(channel); };
  }, [room?.id]);

  // 3. Adaptive Sync Loop (200ms)
  useEffect(() => {
    if (isHost || !videoRef.current || !hasInteracted || !roomState) return;

    const interval = setInterval(() => {
      const state = roomStateRef.current;
      const video = videoRef.current;
      if (!state || !video) return;

      if (state.is_playing && video.paused) video.play().catch(() => {});
      else if (!state.is_playing && !video.paused) video.pause();

      const drift = video.currentTime - state.current_timestamp_seconds;
      setDriftValue(drift);
      
      if (state.is_playing) {
        if (Math.abs(drift) > 1.5) video.currentTime = state.current_timestamp_seconds;
        else if (drift < -0.1) video.playbackRate = 1.1;
        else if (drift > 0.1) video.playbackRate = 0.9;
        else video.playbackRate = 1.0;
      } else {
        video.playbackRate = 1.0;
        if (Math.abs(drift) > 0.1) video.currentTime = state.current_timestamp_seconds;
      }
    }, 200); 

    return () => clearInterval(interval);
  }, [isHost, hasInteracted, !!roomState]);

  // 4. Host Heartbeat (500ms Broadcast, 5s DB)
  useEffect(() => {
    if (!isHost || !room || !roomState?.is_playing) return;

    let dbCounter = 0;
    const heartbeat = setInterval(() => {
      if (!videoRef.current || videoRef.current.paused) return;
      const time = videoRef.current.currentTime + 0.2;

      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "sync-event",
          payload: { is_playing: true, current_timestamp_seconds: time },
        });
      }

      dbCounter++;
      if (dbCounter >= 10) { 
        dbCounter = 0;
        supabase.from("room_state").update({ current_timestamp_seconds: time, is_playing: true }).eq("room_id", room.id);
      }
    }, 500); 

    return () => clearInterval(heartbeat);
  }, [isHost, room?.id, roomState?.is_playing]);

  async function updateRoomState(newValues) {
    if (!isHost || !room) return;
    const time = videoRef.current?.currentTime || 0;
    const compensatedValues = { ...newValues };
    if (compensatedValues.current_timestamp_seconds !== undefined) compensatedValues.current_timestamp_seconds += 0.2;
    
    setRoomState((prev) => ({ ...prev, ...compensatedValues }));
    if (channelRef.current) channelRef.current.send({ type: "broadcast", event: "sync-event", payload: compensatedValues });
    await supabase.from("room_state").update(compensatedValues).eq("room_id", room.id);
  }

  async function handleSetVideoUrl() {
    if (!isHost || !newVideoUrl.trim()) return;
    const payload = { video_url: newVideoUrl.trim(), current_timestamp_seconds: 0, is_playing: false };
    setRoomState(prev => ({ ...prev, ...payload }));
    await supabase.from("room_state").update(payload).eq("room_id", room.id);
    setNewVideoUrl("");
  }

  async function handleClearVideo() {
    if (!isHost) return;
    const payload = { video_url: null, is_playing: false, current_timestamp_seconds: 0 };
    setRoomState(prev => ({ ...prev, ...payload }));
    await supabase.from("room_state").update(payload).eq("room_id", room.id);
  }

  return (
    <div className="min-h-screen bg-[#0f0f1a] text-white px-6 py-10">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Movie Night Room</h1>
          <p className="mt-1 text-white/70">Room Code: <span className="font-semibold">{code}</span></p>
          {roomState?.video_url && <p className="text-[10px] text-white/30 mt-1 truncate max-w-xs font-mono">Playing: {roomState.video_url}</p>}
        </div>
        <div className={`px-4 py-2 rounded-full text-xs font-medium flex gap-3 items-center ${
          connectionStatus === "SUBSCRIBED" ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"
        }`}>
          <span>{connectionStatus === "SUBSCRIBED" ? "🟢 Connected" : "🟠 " + connectionStatus}</span>
          <span className="opacity-20">|</span>
          <span className="text-white/50 text-xs">Drift: {driftValue.toFixed(2)}s</span>
        </div>
      </div>

      <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl">
        {room && (
          <>
            <div className="relative mt-4">
              <video
                key={roomState?.video_url}
                ref={videoRef}
                src={roomState?.video_url}
                className="rounded-xl w-full aspect-video bg-black"
                controls={isHost}
                playsInline
                onPlay={() => isHost && updateRoomState({ is_playing: true, current_timestamp_seconds: videoRef.current?.currentTime || 0 })}
                onPause={() => isHost && updateRoomState({ is_playing: false, current_timestamp_seconds: videoRef.current?.currentTime || 0 })}
                onSeeked={() => isHost && updateRoomState({ current_timestamp_seconds: videoRef.current?.currentTime || 0 })}
              />

              {!hasInteracted && (
                <div onClick={() => {
                  setHasInteracted(true);
                  if (videoRef.current) videoRef.current.play().then(() => videoRef.current.pause());
                }} className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center cursor-pointer rounded-xl backdrop-blur-sm z-10">
                  <div className="w-16 h-16 bg-purple-500 rounded-full flex items-center justify-center mb-4 animate-pulse shadow-lg">
                    <span className="text-2xl text-white">▶️</span>
                  </div>
                  <p className="text-white text-lg font-semibold uppercase tracking-widest">Tap to join sync</p>
                </div>
              )}
            </div>

            {isHost && (
              <div className="mt-8 space-y-6">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newVideoUrl}
                    onChange={(e) => setNewVideoUrl(e.target.value)}
                    placeholder="PASTE MP4 VIDEO URL HERE..."
                    className="flex-1 bg-white/10 border border-white/20 px-4 py-3 rounded-xl text-sm outline-none focus:border-purple-500 transition shadow-inner"
                  />
                  <button onClick={handleSetVideoUrl} className="bg-purple-500 hover:bg-purple-600 px-6 py-3 rounded-xl font-bold transition text-sm shadow-lg shadow-purple-500/20">Set Video</button>
                  <button onClick={handleClearVideo} className="bg-red-500/20 text-red-400 hover:bg-red-500/40 px-4 py-3 rounded-xl font-bold transition text-sm">Clear</button>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => videoRef.current?.play()} className="flex-1 px-6 py-3 bg-green-500 hover:bg-green-600 rounded-xl font-bold transition shadow-lg shadow-green-500/20">PLAY ▶️</button>
                  <button onClick={() => videoRef.current?.pause()} className="flex-1 px-6 py-3 bg-yellow-500 hover:bg-yellow-600 rounded-xl font-bold transition text-black shadow-lg shadow-yellow-500/20">PAUSE ⏸</button>
                </div>
              </div>
            )}

            {!isHost && roomState && (
              <div className="mt-6 flex flex-col items-center p-6 bg-white/5 rounded-2xl border border-white/5">
                <p className="text-purple-400 font-bold mb-4 uppercase text-xs tracking-widest">Host is {roomState.is_playing ? "Playing ▶️" : "Paused ⏸"}</p>
                <button
                  onClick={async () => {
                    const { data } = await supabase.from("room_state").select("*").eq("room_id", room.id).single();
                    if (data && videoRef.current) {
                      setRoomState(data);
                      videoRef.current.currentTime = data.current_timestamp_seconds;
                    }
                  }}
                  className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-black border border-white/10 transition-all"
                >
                  🔄 FORCE SYNC NOW
                </button>
              </div>
            )}

            <div className="mt-12">
              <h2 className="text-xl font-semibold mb-6 border-l-4 border-purple-500 pl-4">Room Members</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {members.map((member) => (
                  <div key={member.id} className="flex justify-between items-center px-4 py-3 bg-white/5 rounded-xl border border-white/5 backdrop-blur-sm">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${onlineUsers.includes(member.user_id) ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]" : "bg-gray-500"}`} />
                      <span className="text-sm">{member.profiles?.email || "Anonymous Member"}</span>
                    </div>
                    {member.role === "host" ? <span className="px-3 py-1 text-[10px] bg-purple-500 rounded-full font-bold uppercase tracking-widest">👑 Host</span> : <span className="px-3 py-1 text-[10px] bg-white/10 rounded-full font-bold uppercase tracking-widest">Member</span>}
                  </div>
                ))}
              </div>
              <button onClick={async () => {
                const { data: { user } } = await supabase.auth.getUser();
                if (user) await supabase.from("room_members").delete().eq("user_id", user.id);
                navigate("/");
              }} className="mt-10 px-6 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-xl text-xs font-bold transition-all border border-red-500/10">Leave Room</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}