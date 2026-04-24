import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Navbar from "../components/Navbar";

export default function Room() {
  const { code } = useParams();
  const navigate = useNavigate();
  const playerRef = useRef(null);
  const chatEndRef = useRef(null);
  
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
  const [connectionStatus, setConnectionStatus] = useState("JOINING");
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [videoError, setVideoError] = useState(null);
  const [user, setUser] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [typingUsers, setTypingUsers] = useState([]);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef(null);

  useEffect(() => { roomStateRef.current = roomState; }, [roomState]);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { hasInteractedRef.current = hasInteracted; }, [hasInteracted]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Sync Logic
  useEffect(() => {
    if (playerRef.current && hasInteracted && roomState) {
      if (roomState.is_playing && playerRef.current.paused) {
        playerRef.current.play().catch(() => {});
      } else if (!roomState.is_playing && !playerRef.current.paused) {
        playerRef.current.pause();
      }

      if (!isHost) {
        const hostTime = roomState.current_timestamp_seconds;
        const myTime = playerRef.current.currentTime;
        const drift = myTime - hostTime;
        const absDrift = Math.abs(drift);

        if (absDrift > 2) {
          playerRef.current.currentTime = hostTime;
          playerRef.current.playbackRate = 1.0;
        } else if (absDrift > 0.5) {
          playerRef.current.playbackRate = drift < 0 ? 1.05 : 0.95;
        } else {
          playerRef.current.playbackRate = 1.0;
        }
      } else {
        playerRef.current.playbackRate = 1.0;
      }
    }
  }, [roomState?.is_playing, roomState?.current_timestamp_seconds, hasInteracted, isHost]);

  // Host Heartbeat (Optimized)
  useEffect(() => {
    if (!isHost || !roomState?.is_playing || connectionStatus !== "SUBSCRIBED") return;
    const interval = setInterval(() => {
      if (playerRef.current && channelRef.current) {
        const currentTime = playerRef.current.currentTime;
        channelRef.current.send({ 
          type: "broadcast", 
          event: "sync-event", 
          payload: { ...roomStateRef.current, current_timestamp_seconds: currentTime } 
        });
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isHost, roomState?.is_playing, connectionStatus]);

  const formatVideoUrl = (url) => {
    if (!url) return url;
    let formatted = url.trim();
    if (formatted.startsWith("http://")) formatted = formatted.replace("http://", "https://");
    if (formatted.includes("dropbox.com")) {
      formatted = formatted.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace("?dl=0", "").replace("?dl=1", "");
      formatted += (formatted.includes("?") ? "&raw=1" : "?raw=1");
    }
    if (formatted.includes("drive.google.com/file/d/")) {
      const id = formatted.split("/d/")[1]?.split("/")[0];
      if (id) formatted = `https://docs.google.com/uc?export=download&id=${id}`;
    }
    return formatted;
  };

  const handleForceSync = async () => {
    if (!room?.id || !playerRef.current) return;
    
    try {
      setHasInteracted(true);
      
      // 1. Broadcast a request for live sync from the host
      if (channelRef.current && connectionStatus === "SUBSCRIBED") {
        channelRef.current.send({
          type: "broadcast",
          event: "request-sync",
          payload: {}
        });
      }

      // 2. Fetch from DB as a fallback (in case host is offline)
      const { data, error } = await supabase.from("room_state").select("*").eq("room_id", room.id).single();
      
      if (error) throw error;
      
      if (data) {
        setRoomState(data);
        if (playerRef.current) {
          playerRef.current.currentTime = data.current_timestamp_seconds;
          if (data.is_playing) {
            playerRef.current.play().catch(() => {});
          } else {
            playerRef.current.pause();
          }
        }
      }
    } catch (err) {
      console.error("Force Sync Error:", err);
    }
  };

  useEffect(() => {
    async function initRoom() {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) { navigate("/", { replace: true }); return; }
        setUser(authUser);

        const { data: roomData, error: roomError } = await supabase.from("rooms").select("*").eq("room_code", code).single();
        if (roomError || !roomData) { navigate("/", { replace: true }); return; }
        setRoom(roomData);

        // Parallelize initial data fetching for speed
        const [stateRes, membersRes, messagesRes] = await Promise.all([
          supabase.from("room_state").select("*").eq("room_id", roomData.id).maybeSingle(),
          supabase.from("room_members").select("id, role, user_id, profiles(email)").eq("room_id", roomData.id),
          supabase.from("messages").select("id, content, created_at, user_id, profiles(email)").eq("room_id", roomData.id).order("created_at", { ascending: true }).limit(50)
        ]);

        if (stateRes.data) setRoomState(stateRes.data);
        
        if (membersRes.data) {
          setMembers(membersRes.data);
          const current = membersRes.data.find(m => m.user_id === authUser.id);
          if (current) setIsHost(current.role === "host");
          else if (roomData.created_by === authUser.id) setIsHost(true);
        }

        if (messagesRes.data) setMessages(messagesRes.data);
      } catch (err) { 
        console.error("Init Error:", err);
        navigate("/", { replace: true }); 
      }
    }
    initRoom();
  }, [code]);

  // Connection Management
  useEffect(() => {
    if (!room?.id || !user?.id) return;
    
    let subChannel;
    let reconnectTimeout;
    
    const setupChannel = async () => {
      // Clean up existing channel if any
      if (subChannel) {
        await supabase.removeChannel(subChannel);
      }

      subChannel = supabase.channel(`room_${room.id}`, { 
        config: { 
          presence: { key: user.id }, 
          broadcast: { self: false, ack: false } 
        } 
      });
      
      channelRef.current = subChannel;

      subChannel
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "room_state", filter: `room_id=eq.${room.id}` }, (p) => {
          setRoomState(prev => ({ ...prev, ...p.new }));
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${room.id}` }, async (payload) => {
          // Check if we already have this message from broadcast
          setMessages(current => {
            if (current.some(m => m.id === payload.new.id)) return current;
            
            // If not, we need to fetch the email since Postgres payload only has user_id
            supabase.from("profiles").select("email").eq("id", payload.new.user_id).single()
              .then(({ data }) => {
                setMessages(c => c.map(m => m.id === payload.new.id ? { ...m, profiles: data } : m));
              });
              
            return [...current, { ...payload.new, profiles: { email: "..." } }];
          });
        })
        .on("broadcast", { event: "chat-msg" }, ({ payload }) => {
          setMessages(current => current.some(x => x.id === payload.id) ? current : [...current, payload]);
        })
        .on("broadcast", { event: "sync-event" }, ({ payload }) => {
          setRoomState(payload);
        })
        .on("presence", { event: "sync" }, () => {
          const state = subChannel.presenceState();
          setOnlineUsers(Object.keys(state));
          
          const typing = [];
          Object.keys(state).forEach(key => {
            if (key === user.id) return;
            const presenceEntries = state[key];
            if (presenceEntries?.some(p => p.is_typing)) {
              typing.push(presenceEntries[0].email?.split('@')[0] || "Partner");
            }
          });
          setTypingUsers(typing);
        })
        .subscribe(async (status) => {
          setConnectionStatus(status);
          
          if (status === "SUBSCRIBED") {
            // Immediately track presence so we appear online
            await subChannel.track({ 
              online_at: new Date().toISOString(), 
              is_typing: false, 
              email: user.email 
            });
          }
          
          if (status === "TIMED_OUT" || status === "CLOSED" || status === "CHANNEL_ERROR") {
            console.log(`Realtime ${status}, retrying in 2s...`);
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(setupChannel, 2000);
          }
        });
    };

    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible") {
        console.log("Tab visible, checking connection...");
        
        // Refresh room state from DB to ensure sync after being backgrounded
        const { data: stateData } = await supabase
          .from("room_state")
          .select("*")
          .eq("room_id", room.id)
          .single();
          
        if (stateData) {
          setRoomState(stateData);
          
          // If I am the host, immediately broadcast my current time to sync others
          if (isHostRef.current && playerRef.current && channelRef.current) {
            channelRef.current.send({ 
              type: "broadcast", 
              event: "sync-event", 
              payload: { ...stateData, current_timestamp_seconds: playerRef.current.currentTime } 
            });
          }
        }

        // Check if channel is healthy
        if (!subChannel || subChannel.state !== "joined") {
          console.log("Channel not joined, re-establishing...");
          setupChannel();
        } else {
          // Even if joined, re-track presence to be sure
          subChannel.track({ 
            online_at: new Date().toISOString(), 
            is_typing: false, 
            email: user.email 
          });
        }
      }
    };

    setupChannel();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", setupChannel);

    return () => { 
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", setupChannel);
      if (subChannel) supabase.removeChannel(subChannel); 
    };
  }, [room?.id, user?.id]);

  const handleTyping = () => {
    if (!channelRef.current || !user || connectionStatus !== "SUBSCRIBED") return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      channelRef.current.track({ online_at: new Date().toISOString(), is_typing: true, email: user.email });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      if (channelRef.current) channelRef.current.track({ online_at: new Date().toISOString(), is_typing: false, email: user.email });
    }, 3000);
  };

  async function updateRoomState(newValues) {
    if (!isHost || !room) return;
    const compensatedValues = { ...roomStateRef.current, ...newValues };
    setRoomState(compensatedValues);
    if (channelRef.current && connectionStatus === "SUBSCRIBED") {
      channelRef.current.send({ type: "broadcast", event: "sync-event", payload: compensatedValues });
    }
    await supabase.from("room_state").update(newValues).eq("room_id", room.id);
  }

  async function handleSetVideoUrl() {
    const url = formatVideoUrl(videoUrlInput);
    if (!isHost || !room || !url.trim()) return;
    const payload = { video_url: url, current_timestamp_seconds: 0, is_playing: false };
    setVideoError(null);
    setVideoLoading(true);
    setRoomState(prev => ({ ...prev, ...payload }));
    setHasInteracted(true);
    if (channelRef.current && connectionStatus === "SUBSCRIBED") {
      channelRef.current.send({ type: "broadcast", event: "sync-event", payload });
    }
    await supabase.from("room_state").update(payload).eq("room_id", room.id);
    setVideoUrlInput("");
  }

  async function handleSendMessage(e) {
    e.preventDefault(); if (!newMessage.trim() || !user || !room) return;
    const content = newMessage.trim(); setNewMessage("");
    const { data } = await supabase.from("messages").insert([{ room_id: room.id, user_id: user.id, content }]).select().single();
    if (data) {
      const fullMsg = { ...data, profiles: { email: user.email } };
      setMessages(current => [...current, fullMsg]);
      if (channelRef.current && connectionStatus === "SUBSCRIBED") {
        channelRef.current.send({ type: "broadcast", event: "chat-msg", payload: fullMsg });
      }
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex flex-col font-sans overflow-hidden">
      <div className="w-full absolute top-0 z-50"><Navbar user={user} /></div>
      <div className="flex-1 overflow-y-auto custom-scrollbar pt-32 pb-20 px-4 md:px-8">
        <div className="max-width-container mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-12">
            <div>
              <h1 className="text-4xl font-black tracking-tight uppercase italic text-primary-gradient leading-none">Movie Night Room</h1>
              <p className="mt-3 text-[#8B8B9A] text-[11px] font-black tracking-[0.3em] uppercase flex items-center gap-3">Room Code: <span className="text-white bg-white/5 px-3 py-1 rounded-md">{code}</span></p>
            </div>
            <div className="flex items-center gap-6 self-end md:self-auto">
              <div className="px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-black text-white border border-white/10 shadow-xl shadow-black">
                <span className={`w-2 h-2 rounded-full inline-block mr-2 shadow-[0_0_8px_rgba(34,197,94,0.6)] ${connectionStatus === "SUBSCRIBED" ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`}></span>
                {connectionStatus === "SUBSCRIBED" ? "Connected" : connectionStatus === "JOINING" ? "Connecting..." : "Reconnecting..."}
              </div>
              <button onClick={() => { if (!user || !room) return; supabase.from("room_members").delete().eq("room_id", room.id).eq("user_id", user.id).then(() => navigate("/", { replace: true })); }} className="px-8 py-3.5 rounded-full bg-[#881337] border border-[#BE123C]/20 text-white text-[10px] font-black uppercase tracking-[0.2em] hover:brightness-125 active:scale-95 transition-all shadow-lg shadow-black">Leave Room</button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-10 items-start">
            <div className="flex-1 w-full space-y-10">
              <div className="romantic-card !p-0 border-white/5 bg-white/[0.02] overflow-hidden shadow-2xl relative">
                <div className="relative aspect-video bg-black group">
                  {roomState?.video_url ? (
                    <video 
                      key={roomState.video_url}
                      ref={playerRef}
                      src={roomState.video_url}
                      className="absolute inset-0 w-full h-full object-contain"
                      playsInline
                      onLoadedMetadata={() => { setVideoLoading(false); setVideoError(null); }}
                      onWaiting={() => setVideoLoading(true)}
                      onPlaying={() => setVideoLoading(false)}
                      onPlay={() => isHost && updateRoomState({ is_playing: true, current_timestamp_seconds: playerRef.current?.currentTime || 0 })}
                      onPause={() => isHost && updateRoomState({ is_playing: false, current_timestamp_seconds: playerRef.current?.currentTime || 0 })}
                      onSeeked={() => isHost && updateRoomState({ current_timestamp_seconds: playerRef.current?.currentTime || 0 })}
                      onEnded={() => { if (isHost) updateRoomState({ is_playing: false, current_timestamp_seconds: 0 }); }}
                      onError={() => { setVideoError("Playback failed. Ensure it's a direct MP4 URL."); setVideoLoading(false); }}
                    />
                  ) : ( <div className="w-full h-full bg-black flex items-center justify-center"><div className="text-center space-y-4 opacity-20"><span className="text-6xl">🎬</span><p className="text-[#8B8B9A] text-[11px] font-black uppercase tracking-[0.4em]">Ready for action</p></div></div> )}

                  {videoLoading && !videoError && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-[4px] flex flex-col items-center justify-center z-10"><div className="w-14 h-14 border-4 border-rose-500/20 border-t-rose-500 rounded-full animate-spin mb-4"></div><p className="text-[10px] font-black uppercase tracking-[0.3em] text-rose-500">Buffering...</p></div>
                  )}

                  {!hasInteracted && roomState?.video_url && (
                    <div onClick={() => setHasInteracted(true)} className="absolute inset-0 bg-[#0A0A0F]/95 flex flex-col items-center justify-center cursor-pointer backdrop-blur-2xl z-20 hover:bg-[#0A0A0F]/90 transition-all group"><div className="w-24 h-24 bg-primary-gradient rounded-full flex items-center justify-center mb-8 shadow-[0_0_50px_rgba(190,18,60,0.3)] group-hover:scale-110 transition-transform"><span className="text-4xl text-white ml-2">▶</span></div><p className="text-3xl font-black tracking-[0.3em] text-white uppercase italic">Tap to join sync ❤️</p></div>
                  )}
                  
                  {videoError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-12 bg-[#0A0A0F]/95 backdrop-blur-xl z-30">
                      <div className="w-24 h-24 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-8"><span className="text-5xl">⚠️</span></div>
                      <h3 className="text-xl font-black uppercase italic mb-4">Playback Failed</h3>
                      <p className="text-[#8B8B9A] font-bold uppercase tracking-[0.2em] text-[10px] max-w-xs leading-relaxed mb-8">{videoError}</p>
                      <button onClick={() => { setVideoError(null); setRoomState(prev => ({ ...prev, video_url: null })); }} className="px-8 py-3 bg-white/5 rounded-full text-[10px] text-white font-black uppercase tracking-widest hover:bg-white/10 transition-all">Clear Link</button>
                    </div>
                  )}
                </div>

                <div className="p-8 border-t border-white/5 bg-white/[0.01]">
                  {isHost ? (
                    <div className="space-y-8">
                      <div className="flex flex-col md:flex-row gap-4">
                        <input type="text" value={videoUrlInput} onChange={(e) => setVideoUrlInput(e.target.value)} placeholder="PASTE DIRECT MP4 LINK..." className="romantic-input flex-1 text-center font-bold tracking-[0.1em] placeholder:text-[#33334A] focus:scale-[1.01]" />
                        <button onClick={handleSetVideoUrl} className="pill-button bg-primary-gradient px-12 text-white shadow-[0_10px_20px_rgba(190,18,60,0.2)] active:scale-95 transition-all">SET VIDEO</button>
                      </div>
                      {roomState?.video_url && (
                        <div className="flex justify-center gap-10">
                          <button 
                            onClick={() => {
                              const isAtEnd = playerRef.current?.currentTime === playerRef.current?.duration;
                              updateRoomState({ is_playing: true, current_timestamp_seconds: isAtEnd ? 0 : (playerRef.current?.currentTime || 0) });
                            }} 
                            className="w-20 h-20 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 hover:bg-rose-500/20 hover:scale-110 active:scale-90 transition-all shadow-[0_0_20px_rgba(244,63,94,0.1)]"
                          >
                            <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                          </button>
                          <button 
                            onClick={() => updateRoomState({ is_playing: false, current_timestamp_seconds: playerRef.current?.currentTime || 0 })} 
                            className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 hover:scale-110 active:scale-90 transition-all shadow-[0_0_20px_rgba(255,255,255,0.05)]"
                          >
                            <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      {roomState?.video_url ? (
                        <div className="w-full flex flex-col items-center gap-8">
                          <div className="flex flex-col items-center gap-4">
                            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[#8B8B9A]">Host Status</span>
                            <div className="flex items-center gap-6">
                              {roomState?.is_playing ? (
                                <div className="flex flex-col items-center gap-2">
                                  <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.1)]">
                                    <svg className="w-8 h-8 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                  </div>
                                  <span className="text-[9px] font-black uppercase tracking-widest text-rose-400">Playing</span>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-2">
                                  <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/50 shadow-[0_0_20px_rgba(255,255,255,0.05)]">
                                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                                  </div>
                                  <span className="text-[9px] font-black uppercase tracking-widest text-[#8B8B9A]">Paused</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <button onClick={handleForceSync} className="pill-button bg-white/5 border border-white/10 px-12 py-4 text-[10px] font-black tracking-[0.2em] hover:bg-white/10 active:scale-95 transition-all">🔄 FORCE SYNC</button>
                        </div>
                      ) : ( <div className="py-8 text-center"><p className="text-[#8B8B9A] text-[11px] font-black uppercase tracking-[0.4em] italic">Waiting for host...</p></div> )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="w-full lg:w-[350px] romantic-card !p-0 border-white/5 bg-white/[0.02] flex flex-col h-[600px] relative overflow-hidden shadow-2xl">
              <div className="p-7 border-b border-white/5 flex items-center justify-between bg-black/40 backdrop-blur-md"><div className="flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></div><h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-[#8B8B9A]">Chat</h3></div><span className="text-[9px] font-black text-[#55556A] uppercase tracking-[0.2em]">{messages.length} MSGS</span></div>
              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-black/10">
                {messages.length === 0 ? ( <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-10"><span className="text-4xl">💬</span><p className="text-[10px] font-black uppercase tracking-[0.3em]">Start a conversation</p></div> ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.user_id === user?.id ? "items-end" : "items-start"}`}>
                      <span className="text-[8px] font-black text-[#55556A] mb-2 uppercase tracking-[0.2em]">{msg.profiles?.email?.split('@')[0]}</span>
                      <div className={`px-4 py-2.5 rounded-2xl text-[13px] font-medium leading-relaxed max-w-[90%] shadow-lg ${msg.user_id === user?.id ? "bg-primary-gradient text-white rounded-tr-none" : "bg-white/5 text-white/90 rounded-tl-none border border-white/5"}`}>{msg.content}</div>
                    </div>
                  ))
                )}
                {typingUsers.length > 0 && <div className="flex items-center gap-2 px-2"><div className="flex gap-1"><span className="w-1 h-1 bg-rose-400 rounded-full animate-bounce"></span><span className="w-1 h-1 bg-rose-400 rounded-full animate-bounce [animation-delay:0.2s]"></span></div><p className="text-[9px] text-rose-400/70 font-black uppercase tracking-widest">{typingUsers[0]} is typing...</p></div>}
                <div ref={chatEndRef} />
              </div>
              <div className="p-6 border-t border-white/5 bg-black/40 backdrop-blur-md"><form onSubmit={handleSendMessage} className="flex gap-3"><input className="romantic-input flex-1 !py-3.5 text-[14px] font-semibold placeholder:text-[#33334A] border-white/5 focus:border-rose-500/50" value={newMessage} onChange={e => { setNewMessage(e.target.value); handleTyping(); }} placeholder="Message..." /><button type="submit" className="w-12 h-12 rounded-full bg-primary-gradient flex items-center justify-center text-white shadow-lg hover:scale-105 active:scale-95 transition-all"><span className="text-xl">➜</span></button></form></div>
            </div>
          </div>

          <div className="mt-20">
            <div className="flex items-center gap-8 mb-12 opacity-50"><div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/10" /><h2 className="text-[11px] font-black uppercase tracking-[0.6em] text-[#9090A8]">Members</h2><div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/10" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pb-20">
              {members.map((member) => (
                <div key={member.id} className="flex justify-between items-center px-8 py-6 bg-white/[0.01] border border-white/5 backdrop-blur-sm shadow-xl group hover:border-white/10 transition-all rounded-3xl"><div className="flex items-center gap-4"><div className={`w-3 h-3 rounded-full ${onlineUsers.includes(member.user_id) ? "bg-rose-500 shadow-[0_0_15px_rgba(190,18,60,0.5)]" : "bg-white/10"}`} /><span className="text-[12px] font-black tracking-widest uppercase italic group-hover:text-white transition-colors">{member.profiles?.email?.split('@')[0] || "Lover"}</span></div>{member.role === "host" ? <span className="px-4 py-1.5 text-[8px] bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-full font-black uppercase tracking-widest">Host</span> : <span className="px-4 py-1.5 text-[8px] bg-white/5 rounded-full font-black uppercase tracking-widest text-[#55556A]">Partner</span>}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
