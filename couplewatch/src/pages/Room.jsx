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

  const [showControls, setShowControls] = useState(false);
  const controlsTimeoutRef = useRef(null);
  const [seekFeedback, setSeekFeedback] = useState(null);
  const seekFeedbackTimeoutRef = useRef(null);
  const lastClickTimeRef = useRef(0);

  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [callStatus, setCallStatus] = useState("IDLE"); // IDLE, CONNECTING, CONNECTED
  const [callType, setCallType] = useState(null); // 'audio' or 'video'
  
  const peerConnectionRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => { roomStateRef.current = roomState; }, [roomState]);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { hasInteractedRef.current = hasInteracted; }, [hasInteracted]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
useEffect(() => {
  if (localStream && localVideoRef.current) {
    localVideoRef.current.srcObject = localStream;
  }
}, [localStream, callStatus]);

useEffect(() => {
  if (remoteStream && remoteVideoRef.current) {
    remoteVideoRef.current.srcObject = remoteStream;
  }
}, [remoteStream, callStatus]);

// WebRTC Logic
  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "webrtc-signal",
          payload: { type: "candidate", candidate: event.candidate, senderId: user.id }
        });
      }
    };
    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
      if (callType === 'video' || event.streams[0].getVideoTracks().length > 0) {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
      } else {
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = event.streams[0];
      }
      setCallStatus("CONNECTED");
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        endCall();
      }
    };
    peerConnectionRef.current = pc;
    return pc;
  };

  const startCall = async (type) => {
    try {
      const constraints = { 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, 
        video: type === 'video' 
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);
      setCallType(type);
      setCallStatus("CONNECTING");
      if (type === 'video') setIsVideoEnabled(true);
      const pc = createPeerConnection();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      channelRef.current.send({
        type: "broadcast",
        event: "webrtc-signal",
        payload: { type: "offer", sdp: offer, senderId: user.id, callType: type }
      });
    } catch (err) {
      console.error("Call error:", err);
      setCallStatus("IDLE");
    }
  };

  const endCall = (sendSignal = true) => {
    if (sendSignal && channelRef.current) {
      channelRef.current.send({
        type: "broadcast",
        event: "webrtc-signal",
        payload: { type: "hangup", senderId: user.id }
      });
    }
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setRemoteStream(null);
    setCallStatus("IDLE");
    setCallType(null);
    setIsAudioMuted(false);
    setIsVideoEnabled(false);
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const handleWebRTCSignal = async (payload) => {
    const { type, sdp, candidate, senderId, callType: incomingType } = payload;
    if (senderId === user.id) return;
    if (type === "offer") {
      try {
        const constraints = { 
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, 
          video: incomingType === 'video' 
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setLocalStream(stream);
        setCallType(incomingType);
        setCallStatus("CONNECTING");
        if (incomingType === 'video') setIsVideoEnabled(true);
        const pc = createPeerConnection();
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        channelRef.current.send({
          type: "broadcast",
          event: "webrtc-signal",
          payload: { type: "answer", sdp: answer, senderId: user.id }
        });
      } catch (err) { console.error("Answer error:", err); }
    } else if (type === "answer") {
      if (peerConnectionRef.current) await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
    } else if (type === "candidate") {
      if (peerConnectionRef.current) {
        try { await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } 
        catch (e) { console.error("Error adding candidate", e); }
      }
    } else if (type === "hangup") {
      endCall(false);
    }
  };

  useEffect(() => {
    if (playerRef.current && hasInteracted && roomState) {
      if (roomState.is_playing && playerRef.current.paused) playerRef.current.play().catch(() => {});
      else if (!roomState.is_playing && !playerRef.current.paused) playerRef.current.pause();
      if (!isHost) {
        const hostTime = roomState.current_timestamp_seconds;
        const myTime = playerRef.current.currentTime;
        const drift = myTime - hostTime;
        if (Math.abs(drift) > 2) {
          playerRef.current.currentTime = hostTime;
          playerRef.current.playbackRate = 1.0;
        } else if (Math.abs(drift) > 0.5) playerRef.current.playbackRate = drift < 0 ? 1.05 : 0.95;
        else playerRef.current.playbackRate = 1.0;
      } else playerRef.current.playbackRate = 1.0;
    }
  }, [roomState?.is_playing, roomState?.current_timestamp_seconds, hasInteracted, isHost]);

  useEffect(() => {
    if (!isHost || !roomState?.is_playing || connectionStatus !== "SUBSCRIBED") return;
    const interval = setInterval(() => {
      if (playerRef.current && channelRef.current) {
        channelRef.current.send({ type: "broadcast", event: "sync-event", payload: { ...roomStateRef.current, current_timestamp_seconds: playerRef.current.currentTime } });
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isHost, roomState?.is_playing, connectionStatus]);

  const handleForceSync = async () => {
    if (!room?.id || !playerRef.current) return;
    try {
      setHasInteracted(true);
      if (channelRef.current && connectionStatus === "SUBSCRIBED") channelRef.current.send({ type: "broadcast", event: "request-sync", payload: {} });
      const { data } = await supabase.from("room_state").select("*").eq("room_id", room.id).single();
      if (data) {
        setRoomState(data);
        playerRef.current.currentTime = data.current_timestamp_seconds;
        if (data.is_playing) playerRef.current.play().catch(() => {}); else playerRef.current.pause();
      }
    } catch (err) { console.error("Sync error:", err); }
  };

  useEffect(() => {
    async function initRoom() {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) { navigate("/", { replace: true }); return; }
        setUser(authUser);
        const { data: roomData } = await supabase.from("rooms").select("*").eq("room_code", code).single();
        if (!roomData) { navigate("/", { replace: true }); return; }
        setRoom(roomData);
        const { data: existingMember } = await supabase.from("room_members").select("*").eq("room_id", roomData.id).eq("user_id", authUser.id).maybeSingle();
        if (!existingMember) {
          await supabase.from("room_members").insert([{ room_id: roomData.id, user_id: authUser.id, role: roomData.created_by === authUser.id ? "host" : "member" }]);
        }
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
        }
        if (messagesRes.data) setMessages(messagesRes.data);
      } catch (err) { navigate("/", { replace: true }); }
    }
    initRoom();
  }, [code]);

  useEffect(() => {
    if (!room?.id || !user?.id) return;
    let subChannel;
    let reconnectTimeout;
    const setupChannel = async () => {
      if (subChannel) await supabase.removeChannel(subChannel);
      subChannel = supabase.channel(`room_${room.id}`, { config: { presence: { key: user.id }, broadcast: { self: false, ack: false } } });
      channelRef.current = subChannel;
      subChannel
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "room_state", filter: `room_id=eq.${room.id}` }, (p) => setRoomState(prev => ({ ...prev, ...p.new })))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${room.id}` }, async (payload) => {
          setMessages(current => current.some(m => m.id === payload.new.id) ? current : [...current, { ...payload.new, profiles: { email: "Partner" } }]);
          supabase.from("profiles").select("email").eq("id", payload.new.user_id).single().then(({ data }) => {
            if (data) setMessages(c => c.map(m => m.id === payload.new.id ? { ...m, profiles: data } : m));
          });
        })
        .on("broadcast", { event: "chat-msg" }, ({ payload }) => setMessages(current => current.some(x => x.id === payload.id) ? current : [...current, payload]))
        .on("broadcast", { event: "webrtc-signal" }, ({ payload }) => handleWebRTCSignal(payload))
        .on("broadcast", { event: "sync-event" }, ({ payload }) => setRoomState(payload))
        .on("broadcast", { event: "request-sync" }, () => {
          if (isHostRef.current && playerRef.current && channelRef.current) {
            channelRef.current.send({ type: "broadcast", event: "sync-event", payload: { ...roomStateRef.current, current_timestamp_seconds: playerRef.current.currentTime } });
          }
        })
        .on("presence", { event: "sync" }, () => {
          const state = subChannel.presenceState();
          setOnlineUsers(Object.keys(state));
          const typing = [];
          Object.keys(state).forEach(key => {
            if (key === user.id) return;
            const presenceEntries = state[key];
            if (presenceEntries?.some(p => p.is_typing)) typing.push(presenceEntries[0].email?.split('@')[0] || "Partner");
          });
          setTypingUsers(typing);
        })
        .subscribe(async (status) => {
          setConnectionStatus(status);
          if (status === "SUBSCRIBED") await subChannel.track({ online_at: new Date().toISOString(), is_typing: false, email: user.email });
          if (status === "TIMED_OUT" || status === "CLOSED" || status === "CHANNEL_ERROR") {
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(setupChannel, 2000);
          }
        });
    };
    setupChannel();
    return () => { if (reconnectTimeout) clearTimeout(reconnectTimeout); if (subChannel) supabase.removeChannel(subChannel); };
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
    setRoomState(prev => {
      const compensatedValues = { ...prev, ...newValues };
      if (channelRef.current && connectionStatus === "SUBSCRIBED") {
        channelRef.current.send({ type: "broadcast", event: "sync-event", payload: compensatedValues });
      }
      return compensatedValues;
    });
    await supabase.from("room_state").update(newValues).eq("room_id", room.id);
  }

  const handleSendMessage = async (e) => {
    e.preventDefault(); if (!newMessage.trim() || !user || !room) return;
    const content = newMessage.trim(); setNewMessage("");
    const { data } = await supabase.from("messages").insert([{ room_id: room.id, user_id: user.id, content }]).select().single();
    if (data) {
      const fullMsg = { ...data, profiles: { email: user.email } };
      setMessages(current => [...current, fullMsg]);
      if (channelRef.current && connectionStatus === "SUBSCRIBED") channelRef.current.send({ type: "broadcast", event: "chat-msg", payload: fullMsg });
    }
  };

  const handleVideoClick = (e) => {
    if (e.target.closest('button')) return;
    const now = Date.now();
    const isDoubleTap = now - lastClickTimeRef.current < 300;
    lastClickTimeRef.current = now;
    if (isDoubleTap) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (playerRef.current) {
        const newTime = x < rect.width / 2 ? Math.max(0, playerRef.current.currentTime - 5) : Math.min(playerRef.current.duration || Infinity, playerRef.current.currentTime + 5);
        playerRef.current.currentTime = newTime;
        if (isHost) updateRoomState({ current_timestamp_seconds: newTime });
        setSeekFeedback(x < rect.width / 2 ? "backward" : "forward");
        if (seekFeedbackTimeoutRef.current) clearTimeout(seekFeedbackTimeoutRef.current);
        seekFeedbackTimeoutRef.current = setTimeout(() => setSeekFeedback(null), 800);
      }
    } else {
      setShowControls(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
    }
  };

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
                {connectionStatus === "SUBSCRIBED" ? "Connected" : "Reconnecting..."}
              </div>
              <button onClick={() => navigate("/", { replace: true })} className="px-8 py-3.5 rounded-full bg-[#881337] border border-[#BE123C]/20 text-white text-[10px] font-black uppercase tracking-[0.2em] hover:brightness-125 transition-all">Leave Room</button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-10 items-start">
            <div className="flex-1 w-full space-y-10">
              <div className="romantic-card !p-0 border-white/5 bg-white/[0.02] overflow-hidden shadow-2xl relative">
                <div className="relative aspect-video bg-black group cursor-pointer" onClick={handleVideoClick}>
                  {roomState?.video_url ? (
                    <video key={roomState.video_url} ref={playerRef} src={roomState.video_url} className="absolute inset-0 w-full h-full object-contain" playsInline
                      onLoadedMetadata={() => setVideoLoading(false)}
                      onWaiting={() => setVideoLoading(true)}
                      onPlaying={() => setVideoLoading(false)}
                      onPlay={() => isHost && updateRoomState({ is_playing: true, current_timestamp_seconds: playerRef.current?.currentTime || 0 })}
                      onPause={() => isHost && updateRoomState({ is_playing: false, current_timestamp_seconds: playerRef.current?.currentTime || 0 })}
                      onSeeked={() => isHost && updateRoomState({ current_timestamp_seconds: playerRef.current?.currentTime || 0 })}
                      onEnded={() => { if (isHost) updateRoomState({ is_playing: false, current_timestamp_seconds: 0 }); }}
                      onError={() => { setVideoError("Playback failed. Ensure it's a direct MP4 URL."); setVideoLoading(false); }}
                    />
                  ) : ( <div className="w-full h-full bg-black flex items-center justify-center opacity-20"><span className="text-6xl">🎬</span></div> )}

                  {seekFeedback && (
                    <div className={`absolute inset-y-0 ${seekFeedback === 'backward' ? 'left-0' : 'right-0'} w-1/2 z-50 flex items-center justify-center pointer-events-none`}>
                      <div className="w-24 h-24 rounded-full bg-white/10 backdrop-blur-md flex flex-col items-center justify-center animate-pulse">
                        <svg className="w-8 h-8 text-white/60" fill="currentColor" viewBox="0 0 24 24">
                          {seekFeedback === 'backward' ? <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/> : <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>}
                        </svg>
                        <span className="text-white/60 text-[10px] font-black mt-1">5S</span>
                      </div>
                    </div>
                  )}

                  {isHost && hasInteracted && roomState?.video_url && showControls && (
                    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40">
                      <div className="flex items-center gap-12 md:gap-20">
                        <button onClick={(e) => { e.stopPropagation(); if (playerRef.current) { playerRef.current.currentTime = Math.max(0, playerRef.current.currentTime - 5); updateRoomState({ current_timestamp_seconds: playerRef.current.currentTime }); } }} className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all"><span className="text-sm font-black">-5s</span></button>
                        <button onClick={(e) => { e.stopPropagation(); if (roomState.is_playing) updateRoomState({ is_playing: false, current_timestamp_seconds: playerRef.current?.currentTime || 0 }); else updateRoomState({ is_playing: true, current_timestamp_seconds: playerRef.current?.currentTime || 0 }); }} className="w-24 h-24 rounded-full border-2 border-white/30 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all">
                          {roomState.is_playing ? <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : <svg className="w-12 h-12 ml-2" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); if (playerRef.current) { playerRef.current.currentTime = Math.min(playerRef.current.duration, playerRef.current.currentTime + 5); updateRoomState({ current_timestamp_seconds: playerRef.current.currentTime }); } }} className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all"><span className="text-sm font-black">+5s</span></button>
                      </div>
                    </div>
                  )}
                  {videoLoading && !videoError && ( <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-10"><div className="w-14 h-14 border-4 border-rose-500/20 border-t-rose-500 rounded-full animate-spin mb-4"></div></div> )}
                  {!hasInteracted && roomState?.video_url && ( <div onClick={() => setHasInteracted(true)} className="absolute inset-0 bg-[#0A0A0F]/95 flex flex-col items-center justify-center cursor-pointer backdrop-blur-2xl z-20"><div className="w-24 h-24 bg-primary-gradient rounded-full flex items-center justify-center mb-8 shadow-2xl transition-transform hover:scale-110"><span className="text-4xl text-white ml-2">▶</span></div><p className="text-3xl font-black text-white uppercase italic">Tap to join sync ❤️</p></div> )}
                </div>
                <div className="p-8 border-t border-white/5 bg-white/[0.01]">
                  {isHost ? (
                    <div className="flex flex-col md:flex-row gap-4">
                      <input type="text" value={videoUrlInput} onChange={(e) => setVideoUrlInput(e.target.value)} placeholder="PASTE DIRECT MP4 LINK..." className="romantic-input flex-1 text-center font-bold tracking-[0.1em] placeholder:text-[#33334A]" />
                      <button onClick={() => { const url = formatVideoUrl(videoUrlInput); if (url.trim()) { updateRoomState({ video_url: url, current_timestamp_seconds: 0, is_playing: false }); setVideoUrlInput(""); } }} className="pill-button bg-primary-gradient px-12 text-white">SET VIDEO</button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-8">
                      <div className="flex items-center gap-6">
                        {roomState?.is_playing ? <div className="text-rose-500 flex flex-col items-center gap-2"><div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center"><svg className="w-8 h-8 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div><span className="text-[9px] font-black uppercase tracking-widest">Playing</span></div> : <div className="text-[#8B8B9A] flex flex-col items-center gap-2"><div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"><svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg></div><span className="text-[9px] font-black uppercase tracking-widest">Paused</span></div>}
                      </div>
                      <button onClick={handleForceSync} className="pill-button bg-white/5 border border-white/10 px-12 text-[10px] font-black tracking-[0.2em] hover:bg-white/10 active:scale-95 transition-all">🔄 FORCE SYNC</button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT PANEL - Communication System */}
            <div className="w-full lg:w-[400px] flex flex-col gap-6 h-[850px]">
              {/* ZONE 1 — Presence */}
              <div className="bg-white/[0.02] backdrop-blur-xl border border-[#881337]/30 rounded-[22px] p-5 shadow-[inset_0_0_20px_rgba(136,19,55,0.05),0_10px_40px_rgba(0,0,0,0.5)]">
                <div className="flex items-center justify-between mb-5 px-1">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-[#8B8B9A] flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#881337] shadow-[0_0_8px_#881337]"></span>Presence</h3>
                  <div className="px-2 py-0.5 rounded-md bg-white/5 border border-white/5 text-[9px] font-black text-[#55556A] uppercase tracking-widest">{onlineUsers.length} Online</div>
                </div>
                <div className="space-y-4">
                  {members.map((member) => (
                    <div key={member.id} className="flex items-center justify-between group px-1">
                      <div className="flex items-center gap-4">
                        <div className="relative">
                          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-white/10 to-transparent border border-white/10 flex items-center justify-center text-[11px] font-bold text-white shadow-xl group-hover:border-[#881337]/30 transition-all uppercase">{member.profiles?.email?.[0] || "?"}</div>
                          {onlineUsers.includes(member.user_id) && <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-[3px] border-[#0A0A0F] shadow-[0_0_10px_rgba(34,197,94,0.8)]"></div>}
                        </div>
                        <div className="flex flex-col gap-0.5"><span className="text-[13px] font-bold text-white/90 truncate max-w-[140px] tracking-tight">{member.profiles?.email?.split('@')[0]}</span><span className="text-[9px] font-bold text-[#55556A] uppercase tracking-widest">{member.role === 'host' ? 'Master of Sync' : 'Partner'}</span></div>
                      </div>
                      {member.role === 'host' ? <div className="px-3 py-1.5 rounded-full bg-[#881337]/10 border border-[#881337]/30 flex items-center gap-2 shadow-[0_0_15px_rgba(136,19,55,0.1)]"><span className="text-[9px] font-black uppercase text-[#BE123C] tracking-widest">Host</span><span className="text-xs">👑</span></div> : <div className="px-3 py-1.5 rounded-full bg-white/5 border border-white/5"><span className="text-[9px] font-black uppercase text-[#55556A] tracking-widest">Member</span></div>}
                    </div>
                  ))}
                </div>
              </div>

              {/* ZONE 2 — Call Area */}
              <div className="bg-[#0D0D12] backdrop-blur-2xl border border-[#881337]/30 rounded-[22px] flex flex-col items-center justify-center relative overflow-hidden min-h-[340px] shadow-2xl animate-in fade-in duration-500">
                {callStatus === "IDLE" ? (
                  <div className="flex flex-col items-center gap-7 p-10 animate-in slide-in-from-bottom-4 duration-700">
                    <p className="text-[11px] font-black uppercase tracking-[0.5em] text-[#55556A]">No active call</p>
                    <div className="flex items-center gap-4">
                      <button onClick={() => startCall('audio')} className="w-14 h-14 rounded-[12px] bg-[#1A1A1F] border border-[#881337]/40 flex items-center justify-center text-white hover:shadow-[0_0_20px_rgba(136,19,55,0.4)] hover:border-[#881337] transition-all group" title="Audio Call"><svg className="w-6 h-6 group-hover:text-[#BE123C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg></button>
                      <button onClick={() => startCall('video')} className="w-14 h-14 rounded-[12px] bg-[#1A1A1F] border border-[#881337]/40 flex items-center justify-center text-white hover:shadow-[0_0_20px_rgba(136,19,55,0.4)] hover:border-[#881337] transition-all group" title="Video Call"><svg className="w-6 h-6 group-hover:text-[#BE123C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg></button>
                    </div>
                  </div>
                ) : callType === 'audio' ? (
                  <div className="flex flex-col items-center justify-center p-8 w-full animate-in fade-in duration-500">
                    <div className="flex items-center gap-12 mb-10">
                      <div className="flex flex-col items-center gap-4">
                        <div className={`w-24 h-24 rounded-full border-2 p-1.5 transition-all duration-500 ${!isAudioMuted ? "border-[#BE123C] shadow-[0_0_30px_rgba(190,18,60,0.3)]" : "border-white/10"}`}>
                          <div className="w-full h-full rounded-full bg-[#1A1A1F] flex items-center justify-center text-2xl font-bold uppercase text-white/80">You</div>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                          <div className="flex gap-1 h-3 items-end">
                            <div className={`w-1 rounded-full transition-all ${!isAudioMuted ? "bg-[#BE123C] animate-[bounce_0.6s_infinite] shadow-[0_0_8px_#BE123C]" : "bg-[#55556A]"}`}></div>
                            <div className={`w-1 rounded-full transition-all ${!isAudioMuted ? "bg-[#BE123C] animate-[bounce_0.8s_infinite] shadow-[0_0_8px_#BE123C] delay-75" : "bg-[#55556A]"}`}></div>
                            <div className={`w-1 rounded-full transition-all ${!isAudioMuted ? "bg-[#BE123C] animate-[bounce_0.7s_infinite] shadow-[0_0_8px_#BE123C] delay-150" : "bg-[#55556A]"}`}></div>
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-[#8B8B9A]">You</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-4">
                        <div className={`w-24 h-24 rounded-full border-2 p-1.5 transition-all duration-500 ${callStatus === "CONNECTED" ? "border-[#881337] shadow-[0_0_30px_rgba(136,19,55,0.3)]" : "border-white/10 animate-pulse"}`}>
                          <div className="w-full h-full rounded-full bg-[#1A1A1F] flex items-center justify-center text-2xl font-bold uppercase text-[#BE123C]">P</div>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                          <div className="flex gap-1 h-3 items-end">
                            <div className={`w-1 rounded-full transition-all ${callStatus === "CONNECTED" ? "bg-[#881337] animate-[bounce_0.6s_infinite] shadow-[0_0_8px_#881337]" : "bg-[#55556A]"}`}></div>
                            <div className={`w-1 rounded-full transition-all ${callStatus === "CONNECTED" ? "bg-[#881337] animate-[bounce_0.8s_infinite] shadow-[0_0_8px_#881337] delay-75" : "bg-[#55556A]"}`}></div>
                            <div className={`w-1 rounded-full transition-all ${callStatus === "CONNECTED" ? "bg-[#881337] animate-[bounce_0.7s_infinite] shadow-[0_0_8px_#881337] delay-150" : "bg-[#55556A]"}`}></div>
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-[#8B8B9A]">Partner</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <button onClick={toggleMute} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-xl ${isAudioMuted ? "bg-[#881337]/20 text-[#BE123C] border border-[#881337]/40" : "bg-[#1A1A1F] border border-white/10 text-white"}`}><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg></button>
                      <button onClick={() => endCall()} className="w-16 h-16 rounded-full bg-[#881337] flex items-center justify-center text-white shadow-[0_0_30px_rgba(136,19,55,0.5)] hover:scale-110 active:scale-90 transition-all"><svg className="w-7 h-7 rotate-[135deg]" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" /></svg></button>
                      <button className="w-12 h-12 rounded-full bg-[#1A1A1F] border border-white/10 text-white flex items-center justify-center hover:bg-white/10 transition-all shadow-xl"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg></button>
                    </div>
                  </div>
                ) : (
                  /* ZONE 2 C: SYMMETRIC SPLIT VIDEO CALL */
                  <div className="w-full h-full flex flex-col p-2 animate-in fade-in duration-500">
                    <div className="flex gap-2 h-[280px] w-full">
                      {/* Partner Section */}
                      <div className="flex-1 rounded-[18px] bg-black border border-white/5 overflow-hidden relative shadow-2xl">
                        {callStatus === "CONNECTED" ? (
                          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-[#0D0D12]">
                            <div className="w-10 h-10 border-2 border-[#881337]/20 border-t-[#BE123C] rounded-full animate-spin mb-3"></div>
                            <span className="text-[8px] font-black uppercase tracking-widest text-[#881337]/60">Connecting...</span>
                          </div>
                        )}
                        <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center gap-1.5 z-20">
                          <div className={`w-1 h-1 rounded-full ${callStatus === "CONNECTED" ? "bg-green-500" : "bg-yellow-500 animate-pulse"}`}></div>
                          <span className="text-[7px] font-black uppercase text-white tracking-widest">Partner</span>
                        </div>
                      </div>

                      {/* Your Section */}
                      <div className="flex-1 rounded-[18px] bg-black border border-[#BE123C]/20 overflow-hidden relative shadow-2xl transition-all">
                        <video ref={localVideoRef} autoPlay playsInline muted className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-700 ${!isVideoEnabled ? 'opacity-0' : 'opacity-100'}`} />
                        {!isVideoEnabled && (
                          <div className="absolute inset-0 flex items-center justify-center bg-[#0D0D12]">
                            <span className="text-[8px] font-black uppercase text-white/30 tracking-widest">Camera Off</span>
                          </div>
                        )}
                        <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center gap-1.5 z-20">
                          <div className="w-1 h-1 rounded-full bg-green-500"></div>
                          <span className="text-[7px] font-black uppercase text-white tracking-widest">You</span>
                        </div>
                      </div>
                    </div>

                    {/* Controls centered below videos */}
                    <div className="flex items-center justify-center gap-4 mt-4 py-2">
                      <button onClick={toggleMute} className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-xl ${isAudioMuted ? "bg-[#881337]/20 text-[#BE123C] border border-[#881337]/40" : "bg-[#1A1A1F] border border-white/10 text-white hover:bg-white/10"}`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
                      </button>
                      <button onClick={toggleVideo} className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-xl ${!isVideoEnabled ? "bg-[#881337]/20 text-[#BE123C] border border-[#881337]/40" : "bg-[#1A1A1F] border border-white/10 text-white hover:bg-white/10"}`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
                      </button>
                      <button onClick={() => endCall()} className="w-14 h-14 rounded-full bg-[#881337] flex items-center justify-center text-white shadow-[0_0_25px_rgba(136,19,55,0.6)] hover:scale-110 active:scale-90 transition-all">
                        <svg className="w-6 h-6 rotate-[135deg]" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" /></svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ZONE 3 — Chat Box */}
              <div className="flex-1 bg-[#0D0D12] backdrop-blur-2xl border border-[#881337]/10 rounded-[22px] flex flex-col relative overflow-hidden shadow-2xl animate-in slide-in-from-bottom-6 duration-700">
                <div className="p-5 border-b border-white/5 bg-black/40 backdrop-blur-md flex items-center justify-between">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.5em] text-[#8B8B9A] italic">Heartbeat Chat</h3>
                  <div className="flex gap-1.5 px-2"><div className="w-1.5 h-1.5 bg-[#881337] rounded-full animate-pulse shadow-[0_0_8px_#881337]"></div><div className="w-1.5 h-1.5 bg-[#881337] rounded-full animate-pulse [animation-delay:0.2s] shadow-[0_0_8px_#881337]"></div></div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-7 custom-scrollbar bg-black/10">
                  {messages.length === 0 ? <div className="h-full flex flex-col items-center justify-center text-center space-y-5 opacity-10"><span className="text-5xl grayscale">💞</span><p className="text-[10px] font-black uppercase tracking-[0.4em] italic">Start a whisper</p></div> : messages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.user_id === user?.id ? "items-end" : "items-start"}`}>
                      <div className={`px-5 py-3.5 rounded-[18px] text-[13.5px] font-medium leading-relaxed max-w-[85%] shadow-2xl transition-all hover:translate-y-[-2px] ${msg.user_id === user?.id ? "bg-[#881337] text-white rounded-tr-none shadow-[0_15px_30px_rgba(136,19,55,0.25)]" : "bg-[#2A2A2F] text-white/95 rounded-tl-none border border-white/5 shadow-black/40"}`}>{msg.content}</div>
                      <span className="text-[8px] font-black text-[#55556A] mt-2.5 uppercase tracking-widest px-1 opacity-60">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  ))}
                  {typingUsers.length > 0 && <div className="flex items-center gap-3 px-2"><div className="flex gap-1.5"><span className="w-1.5 h-1.5 bg-[#881337] rounded-full animate-bounce"></span><span className="w-1.5 h-1.5 bg-[#881337] rounded-full animate-bounce [animation-delay:0.2s] shadow-[0_0_8px_#881337]"></span></div><p className="text-[9px] text-[#881337]/60 font-black italic">{typingUsers[0]} is whispering...</p></div>}
                  <div ref={chatEndRef} />
                </div>
                <div className="p-5 border-t border-white/5 bg-black/40 backdrop-blur-md">
                  <form onSubmit={handleSendMessage} className="flex items-center gap-3">
                    <input className="flex-1 bg-[#1A1A1F] border border-white/10 rounded-[14px] py-4 px-6 text-[14px] font-medium placeholder:text-[#33334A] focus:border-[#881337]/40 outline-none transition-all shadow-[inset_0_0_30px_rgba(255,255,255,0.01)]" value={newMessage} onChange={e => { setNewMessage(e.target.value); handleTyping(); }} placeholder="Message..." />
                    <div className="flex items-center gap-2.5">
                      <button type="button" onClick={() => { if (callStatus === "IDLE") startCall('audio'); else toggleMute(); }} className={`w-11 h-11 rounded-[12px] bg-[#1A1A1F] border flex items-center justify-center transition-all ${callStatus !== "IDLE" && !isAudioMuted ? "border-[#881337] text-[#BE123C] shadow-[0_0_15px_rgba(136,19,55,0.3)]" : "border-[#881337]/30 text-white/50"}`} title="Mic"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg></button>
                      <button type="button" onClick={() => { if (callStatus === "IDLE") startCall('video'); else toggleVideo(); }} className={`w-11 h-11 rounded-[12px] bg-[#1A1A1F] border flex items-center justify-center transition-all ${callStatus !== "IDLE" && isVideoEnabled ? "border-[#881337] text-[#BE123C] shadow-[0_0_15px_rgba(136,19,55,0.3)]" : "border-[#881337]/30 text-white/50"}`} title="Video"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg></button>
                      <button type="submit" className="w-12 h-12 rounded-full bg-[#881337] flex items-center justify-center text-white shadow-[0_10px_20px_rgba(136,19,55,0.35)] hover:scale-110 active:scale-95 transition-all" title="Send"><span className="text-xl">➜</span></button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-20"></div>
        </div>
      </div>
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
    </div>
  );
}
