import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Navbar from "../components/Navbar";

export default function Room() {
  const { code } = useParams();
  const navigate = useNavigate();
  
  // State
  const [user, setUser] = useState(null);
  const [room, setRoom] = useState(null);
  const [roomState, setRoomState] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState("JOINING");
  const [isHost, setIsHost] = useState(false);
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [videoError, setVideoError] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [seekFeedback, setSeekFeedback] = useState(null);
  const [members, setMembers] = useState([]);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [callStatus, setCallStatus] = useState("IDLE");
  const [callType, setCallType] = useState(null);
  const [pendingOffer, setPendingOffer] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [floatingReactions, setFloatingReactions] = useState([]);

  // Refs
  const playerRef = useRef(null);
  const channelRef = useRef(null);
  const chatEndRef = useRef(null);
  const isHostRef = useRef(false);
  const roomStateRef = useRef(null);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef(null);
  const lastClickTimeRef = useRef(0);
  const controlsTimeoutRef = useRef(null);
  const seekFeedbackTimeoutRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const iceCandidatesQueue = useRef([]);
  const isReconnectingRef = useRef(false);

  // Sync refs with state
  useEffect(() => { roomStateRef.current = roomState; }, [roomState]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // WebRTC Stream Attachments
  useEffect(() => { if (remoteStream && remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream; }, [remoteStream, callStatus]);
  useEffect(() => { if (localStream && localVideoRef.current) localVideoRef.current.srcObject = localStream; }, [localStream, isVideoEnabled]);
  useEffect(() => { if (remoteStream && remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream; }, [remoteStream]);

  // WebRTC Logic
  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        channelRef.current.send({ type: "broadcast", event: "webrtc-signal", payload: { type: "candidate", candidate: event.candidate, senderId: user.id } });
      }
    };
    pc.ontrack = (event) => { setRemoteStream(event.streams[0]); setCallStatus("CONNECTED"); };
    peerConnectionRef.current = pc;
  };

  const endCall = (sendSignal = true) => {
    if (sendSignal && channelRef.current && user) {
      channelRef.current.send({ type: "broadcast", event: "webrtc-signal", payload: { type: "hangup", senderId: user.id } });
    }
    if (localStream) { localStream.getTracks().forEach(track => track.stop()); setLocalStream(null); }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setRemoteStream(null); setCallStatus("IDLE"); setCallType(null); setPendingOffer(null);
    iceCandidatesQueue.current = []; setIsAudioMuted(false); setIsVideoEnabled(false);
  };

  const startCall = async (type) => {
    if (!channelRef.current || !user || !room) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      setLocalStream(stream); setCallType(type); setCallStatus("OUTGOING");
      if (type === 'video') setIsVideoEnabled(true);
      createPeerConnection();
      stream.getTracks().forEach(track => peerConnectionRef.current.addTrack(track, stream));
      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);
      channelRef.current.send({ type: "broadcast", event: "webrtc-signal", payload: { type: "offer", sdp: offer, senderId: user.id, callType: type } });
    } catch (err) { console.error(err); }
  };

  const joinIncomingCall = async () => {
    if (!pendingOffer || !channelRef.current || !user) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: pendingOffer.incomingType === 'video' });
      setLocalStream(stream); setCallType(pendingOffer.incomingType); setCallStatus("CONNECTED");
      if (pendingOffer.incomingType === 'video') setIsVideoEnabled(true);
      createPeerConnection();
      stream.getTracks().forEach(track => peerConnectionRef.current.addTrack(track, stream));
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(pendingOffer.sdp));
      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);
      channelRef.current.send({ type: "broadcast", event: "webrtc-signal", payload: { type: "answer", sdp: answer, senderId: user.id } });
      while (iceCandidatesQueue.current.length > 0) {
        const cand = iceCandidatesQueue.current.shift();
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(cand));
      }
    } catch (err) { console.error(err); }
  };

  const handleWebRTCSignal = async (payload) => {
    const { type, sdp, candidate, senderId, callType: incomingType } = payload;
    if (senderId === user.id) return;
    if (type === "offer") { setPendingOffer({ sdp, incomingType }); setCallStatus("INCOMING"); }
    else if (type === "answer" && peerConnectionRef.current) {
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
      while (iceCandidatesQueue.current.length > 0) {
        const cand = iceCandidatesQueue.current.shift();
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(cand));
      }
    } else if (type === "candidate") {
      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        try { await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
      } else iceCandidatesQueue.current.push(candidate);
    } else if (type === "hangup") endCall(false);
  };

  const triggerReaction = (emoji) => {
    const id = Date.now() + Math.random();
    const left = Math.random() * 80 + 10;
    setFloatingReactions(prev => [...prev, { id, emoji, left }]);
    setTimeout(() => {
      setFloatingReactions(prev => prev.filter(r => r.id !== id));
    }, 2000);
  };

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
    } catch (err) { console.error(err); }
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
        if (stateRes.data) {
          setRoomState(stateRes.data);
          if (stateRes.data.video_url) setVideoUrlInput(stateRes.data.video_url);
        }
        let hostStatus = false;
        if (membersRes.data) {
          setMembers(membersRes.data);
          const current = membersRes.data.find(m => m.user_id === authUser.id);
          if (current) hostStatus = current.role === "host";
        }
        if (!hostStatus && roomData.created_by === authUser.id) hostStatus = true;
        setIsHost(hostStatus); isHostRef.current = hostStatus;
        if (messagesRes.data) setMessages(messagesRes.data);
        setIsInitializing(false);
      } catch (err) { navigate("/", { replace: true }); }
    }
    initRoom();
  }, [code, navigate]);

  useEffect(() => {
    if (!room?.id || !user?.id) return;
    let subChannel;
    let reconnectTimeout;

    const setupChannel = async () => {
      if (isReconnectingRef.current) return;
      isReconnectingRef.current = true;
      try {
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
          .on("broadcast", { event: "floating-reaction" }, ({ payload }) => triggerReaction(payload.emoji))
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
            setConnectionStatus(status); isReconnectingRef.current = false;
            if (status === "SUBSCRIBED") await subChannel.track({ online_at: new Date().toISOString(), is_typing: false, email: user.email });
            if (status === "TIMED_OUT" || status === "CLOSED" || status === "CHANNEL_ERROR") {
              if (reconnectTimeout) clearTimeout(reconnectTimeout);
              reconnectTimeout = setTimeout(setupChannel, 3000);
            }
          });
      } catch (err) { isReconnectingRef.current = false; }
    };
    setupChannel();

    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible") {
        setTimeout(async () => {
          if (isHostRef.current) {
            if (playerRef.current && channelRef.current) {
              channelRef.current.send({ type: "broadcast", event: "sync-event", payload: { ...roomStateRef.current, current_timestamp_seconds: playerRef.current.currentTime } });
            }
          } else handleForceSync();
        }, 1500);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => { 
      if (reconnectTimeout) clearTimeout(reconnectTimeout); 
      if (subChannel) supabase.removeChannel(subChannel); 
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [room?.id, user?.id]);

  useEffect(() => {
    if (playerRef.current && hasInteracted && roomState) {
      if (roomState.is_playing && playerRef.current.paused) playerRef.current.play().catch(() => {});
      else if (!roomState.is_playing && !playerRef.current.paused) playerRef.current.pause();
      if (!isHost) {
        const hostTime = roomState.current_timestamp_seconds;
        const myTime = playerRef.current.currentTime;
        const drift = myTime - hostTime;
        if (Math.abs(drift) > 2) {
          playerRef.current.currentTime = hostTime; playerRef.current.playbackRate = 1.0;
        } else if (Math.abs(drift) > 0.5) playerRef.current.playbackRate = drift < 0 ? 1.05 : 0.95;
        else playerRef.current.playbackRate = 1.0;
      } else playerRef.current.playbackRate = 1.0;
    }
  }, [roomState?.is_playing, roomState?.current_timestamp_seconds, hasInteracted, isHost]);

  useEffect(() => {
    if (!isHost || !roomState?.is_playing || connectionStatus !== "SUBSCRIBED") return;
    const syncInterval = setInterval(() => {
      if (playerRef.current && channelRef.current) {
        channelRef.current.send({ type: "broadcast", event: "sync-event", payload: { ...roomStateRef.current, current_timestamp_seconds: playerRef.current.currentTime } });
      }
    }, 2000);
    const dbInterval = setInterval(() => {
      if (playerRef.current && room?.id) {
        supabase.from("room_state").update({ current_timestamp_seconds: playerRef.current.currentTime }).eq("room_id", room.id);
      }
    }, 10000);
    return () => { clearInterval(syncInterval); clearInterval(dbInterval); };
  }, [isHost, roomState?.is_playing, connectionStatus, room?.id]);

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

  const formatVideoUrl = (url) => {
    if (!url) return url;
    let formatted = url.trim();
    if (formatted.startsWith("http://")) formatted = formatted.replace("http://", "https://");
    if (formatted.includes("dropbox.com")) {
      formatted = formatted.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace("?dl=0", "").replace("?dl=1", "");
      if (!formatted.includes("?")) formatted += "?raw=1"; else if (!formatted.includes("raw=1")) formatted += "&raw=1";
    }
    if (formatted.includes("drive.google.com") || formatted.includes("docs.google.com")) {
      const match = formatted.match(/[-\w]{25,}/);
      if (match) formatted = `https://docs.google.com/uc?export=download&id=${match[0]}`;
    }
    return formatted;
  };

  const handleSetVideoUrl = () => {
    const url = formatVideoUrl(videoUrlInput);
    if (!isHost || !room || !url.trim()) return;
    const payload = { video_url: url, current_timestamp_seconds: 0, is_playing: false };
    setVideoError(null); setVideoLoading(true); setRoomState(prev => ({ ...prev, ...payload }));
    setHasInteracted(true);
    if (channelRef.current && connectionStatus === "SUBSCRIBED") channelRef.current.send({ type: "broadcast", event: "sync-event", payload });
    supabase.from("room_state").update(payload).eq("room_id", room.id).then(() => setVideoUrlInput(""));
  };

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

  const handleVideoClick = (e) => {
    if (e.target.closest('button')) return;
    const now = Date.now();
    const isDoubleTap = now - lastClickTimeRef.current < 300;
    lastClickTimeRef.current = now;
    if (isDoubleTap) {
      if (!isHost) return;
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

  const handleLeaveRoom = () => { endCall(true); window.location.href = "/"; };

  const sendReaction = (emoji) => {
    triggerReaction(emoji);
    if (channelRef.current && connectionStatus === "SUBSCRIBED") {
      channelRef.current.send({ type: "broadcast", event: "floating-reaction", payload: { emoji } });
    }
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex flex-col items-center justify-center">
        <div className="relative w-24 h-24 mb-8">
          <div className="absolute inset-0 border-4 border-rose-500/10 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-t-rose-500 rounded-full animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center text-2xl">🎬</div>
        </div>
        <h2 className="text-xl font-black uppercase italic tracking-widest text-primary-gradient animate-pulse">Entering the Room...</h2>
      </div>
    );
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
              <div className="px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-black text-white border border-white/10 shadow-xl shadow-black flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full shadow-[0_0_8px_currentColor] ${
                  connectionStatus === "SUBSCRIBED" ? "bg-green-500 animate-pulse text-green-500" : 
                  connectionStatus === "JOINING" ? "bg-yellow-500 animate-bounce text-yellow-500" : 
                  "bg-red-500 animate-ping text-red-500"
                }`}></span>
                <span>{ connectionStatus === "SUBSCRIBED" ? "Connected" : connectionStatus === "JOINING" ? "Connecting..." : "Reconnecting..." }</span>
              </div>
              <button onClick={handleLeaveRoom} className="px-8 py-3.5 rounded-full bg-[#881337] border border-[#BE123C]/20 text-white text-[10px] font-black uppercase tracking-[0.2em] hover:brightness-125 transition-all">Leave Room</button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-10 items-start">
            <div className="flex-1 w-full space-y-10">
              <div className="romantic-card !p-0 border-white/5 bg-white/[0.02] overflow-hidden shadow-2xl relative">
                <div className="relative aspect-video bg-black group cursor-pointer" onClick={handleVideoClick}>
                  {floatingReactions.map(r => (
                    <div key={r.id} className="float-reaction" style={{ left: `${r.left}%`, bottom: '20px' }}>{r.emoji}</div>
                  ))}
                  {roomState?.video_url ? (
                    <video key={roomState.video_url} ref={playerRef} src={roomState.video_url} className="absolute inset-0 w-full h-full object-contain" playsInline
                      onLoadedMetadata={() => setVideoLoading(false)} onWaiting={() => setVideoLoading(true)} onPlaying={() => setVideoLoading(false)}
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
                        <svg className="w-8 h-8 text-white/60" fill="currentColor" viewBox="0 0 24 24">{seekFeedback === 'backward' ? <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/> : <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>}</svg>
                        <span className="text-white/60 text-[10px] font-black mt-1">5S</span>
                      </div>
                    </div>
                  )}
                  {isHost && hasInteracted && roomState?.video_url && showControls && (
                    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40">
                      <div className="flex items-center gap-12 md:gap-20">
                        <button onClick={(e) => { e.stopPropagation(); if (playerRef.current) { playerRef.current.currentTime = Math.max(0, playerRef.current.currentTime - 5); updateRoomState({ current_timestamp_seconds: playerRef.current.currentTime }); } }} className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all"><span className="text-sm font-black">-5s</span></button>
                        <button onClick={(e) => { e.stopPropagation(); if (roomState.is_playing) updateRoomState({ is_playing: false, current_timestamp_seconds: playerRef.current?.currentTime || 0 }); else updateRoomState({ is_playing: true, current_timestamp_seconds: playerRef.current?.currentTime || 0 }); }} className="w-24 h-24 rounded-full border-2 border-white/30 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all">{roomState.is_playing ? <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : <svg className="w-12 h-12 ml-2" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}</button>
                        <button onClick={(e) => { e.stopPropagation(); if (playerRef.current) { playerRef.current.currentTime = Math.min(playerRef.current.duration, playerRef.current.currentTime + 5); updateRoomState({ current_timestamp_seconds: playerRef.current.currentTime }); } }} className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all"><span className="text-sm font-black">+5s</span></button>
                      </div>
                    </div>
                  )}
                  {videoLoading && roomState?.video_url && !videoError && ( <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-10"><div className="w-14 h-14 border-4 border-rose-500/20 border-t-rose-500 rounded-full animate-spin mb-4"></div></div> )}
                  {!hasInteracted && roomState?.video_url && ( <div onClick={() => setHasInteracted(true)} className="absolute inset-0 bg-[#0A0A0F]/95 flex flex-col items-center justify-center cursor-pointer backdrop-blur-2xl z-20"><div className="w-24 h-24 bg-primary-gradient rounded-full flex items-center justify-center mb-8 shadow-2xl transition-transform hover:scale-110"><span className="text-4xl text-white ml-2">▶</span></div><p className="text-3xl font-black text-white uppercase italic">Tap to join sync ❤️</p></div> )}
                </div>
                <div className="p-8 border-t border-white/5 bg-white/[0.01]">
                  {isHost ? (
                    <div className="space-y-8">
                      <div className="flex flex-col md:flex-row gap-4">
                        <input type="text" value={videoUrlInput} onChange={(e) => setVideoUrlInput(e.target.value)} placeholder="PASTE DIRECT MP4 LINK..." className="romantic-input flex-1 text-center font-bold tracking-[0.1em] placeholder:text-[#33334A] focus:scale-[1.01]" />
                        <button onClick={handleSetVideoUrl} className="pill-button bg-primary-gradient px-12 text-white shadow-[0_10px_20px_rgba(190,18,60,0.2)]">SET VIDEO</button>
                      </div>
                      {!showControls && roomState?.video_url && ( <p className="text-center text-[10px] text-[#55556A] font-black uppercase tracking-[0.3em] animate-pulse">Tap video for controls</p> )}
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
            <div className="w-full lg:w-[400px] flex flex-col gap-6 h-[850px]">
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
                      {member.role === 'host' ? <div className="px-3 py-1.5 rounded-full bg-[#881337]/10 border border-[#881337]/30 flex items-center gap-2 shadow-[0_0_15px_rgba(136,197,55,0.1)]"><span className="text-[9px] font-black uppercase text-[#BE123C] tracking-widest">Host</span><span className="text-xs">👑</span></div> : <div className="px-3 py-1.5 rounded-full bg-white/5 border border-white/5"><span className="text-[9px] font-black uppercase text-[#55556A] tracking-widest">Member</span></div>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-[#0D0D12] backdrop-blur-2xl border border-[#881337]/30 rounded-[22px] flex flex-col items-center justify-center relative overflow-hidden min-h-[340px] shadow-2xl animate-in fade-in duration-500">
                {callStatus === "IDLE" ? (
                  <div className="flex flex-col items-center gap-7 p-10 animate-in slide-in-from-bottom-4 duration-700">
                    <p className="text-[11px] font-black uppercase tracking-[0.5em] text-[#55556A]">No active call</p>
                    <div className="flex items-center gap-4">
                      <button onClick={() => startCall('audio')} className="w-14 h-14 rounded-[12px] bg-[#1A1A1F] border border-[#881337]/40 flex items-center justify-center text-white hover:shadow-[0_0_20px_rgba(136,19,55,0.4)] hover:border-[#881337] transition-all group" title="Audio Call"><svg className="w-6 h-6 group-hover:text-[#BE123C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg></button>
                      <button onClick={() => startCall('video')} className="w-14 h-14 rounded-[12px] bg-[#1A1A1F] border border-[#881337]/40 flex items-center justify-center text-white hover:shadow-[0_0_20px_rgba(136,19,55,0.4)] hover:border-[#881337] transition-all group" title="Video Call"><svg className="w-6 h-6 group-hover:text-[#BE123C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg></button>
                    </div>
                  </div>
                ) : callStatus === "INCOMING" ? (
                  <div className="flex flex-col items-center justify-center p-10 animate-in zoom-in duration-500">
                    <div className="w-24 h-24 rounded-full bg-[#881337]/20 border border-[#881337] flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(136,19,55,0.4)] animate-pulse"><svg className="w-10 h-10 text-[#BE123C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg></div>
                    <p className="text-[12px] font-black uppercase tracking-[0.3em] mb-8 text-white/90">Incoming Call</p>
                    <div className="flex items-center gap-4">
                      <button onClick={joinIncomingCall} className="px-8 py-3 rounded-full bg-green-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-green-500 shadow-lg transition-all">Accept</button>
                      <button onClick={() => endCall()} className="px-8 py-3 rounded-full bg-red-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-red-500 shadow-lg transition-all">Decline</button>
                    </div>
                  </div>
                ) : callType === 'audio' ? (
                  <div className="flex flex-col items-center justify-center p-8 w-full animate-in fade-in duration-500">
                    <div className="flex items-center gap-12 mb-10">
                      <div className="flex flex-col items-center gap-4">
                        <div className={`w-24 h-24 rounded-full border-2 p-1.5 transition-all duration-500 ${!isAudioMuted ? "border-[#BE123C] shadow-[0_0_30px_rgba(190,18,60,0.3)]" : "border-white/10"}`}><div className="w-full h-full rounded-full bg-[#1A1A1F] flex items-center justify-center text-2xl font-bold uppercase text-white/80">You</div></div>
                        <div className="flex flex-col items-center gap-2">
                          <div className="flex gap-1 h-3 items-end"><div className={`w-1 rounded-full transition-all ${!isAudioMuted ? "bg-[#BE123C] animate-[bounce_0.6s_infinite] shadow-[0_0_8px_#BE123C]" : "bg-[#55556A]"}`}></div><div className={`w-1 rounded-full transition-all ${!isAudioMuted ? "bg-[#BE123C] animate-[bounce_0.8s_infinite] shadow-[0_0_8px_#BE123C] delay-75" : "bg-[#55556A]"}`}></div><div className={`w-1 rounded-full transition-all ${!isAudioMuted ? "bg-[#BE123C] animate-[bounce_0.7s_infinite] shadow-[0_0_8px_#BE123C] delay-150" : "bg-[#55556A]"}`}></div></div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-[#8B8B9A]">You</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-4">
                        <div className={`w-24 h-24 rounded-full border-2 p-1.5 transition-all duration-500 ${callStatus === "CONNECTED" ? "border-[#881337] shadow-[0_0_30px_rgba(136,19,55,0.3)]" : "border-white/10 animate-pulse"}`}><div className="w-full h-full rounded-full bg-[#1A1A1F] flex items-center justify-center text-2xl font-bold uppercase text-[#BE123C]">P</div></div>
                        <div className="flex flex-col items-center gap-2">
                          <div className="flex gap-1 h-3 items-end"><div className={`w-1 rounded-full transition-all ${callStatus === "CONNECTED" ? "bg-[#881337] animate-[bounce_0.6s_infinite] shadow-[0_0_8px_#881337]" : "bg-[#55556A]"}`}></div><div className={`w-1 rounded-full transition-all ${callStatus === "CONNECTED" ? "bg-[#881337] animate-[bounce_0.8s_infinite] shadow-[0_0_8px_#881337] delay-75" : "bg-[#55556A]"}`}></div><div className={`w-1 rounded-full transition-all ${callStatus === "CONNECTED" ? "bg-[#881337] animate-[bounce_0.7s_infinite] shadow-[0_0_8px_#881337] delay-150" : "bg-[#55556A]"}`}></div></div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-[#8B8B9A]">Partner</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <button onClick={toggleMute} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-xl ${isAudioMuted ? "bg-[#881337]/20 text-[#BE123C] border border-[#881337]/40" : "bg-[#1A1A1F] border border-white/10 text-white"}`}><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg></button>
                      <button onClick={() => endCall()} className="w-16 h-16 rounded-full bg-[#881337] flex items-center justify-center text-white shadow-[0_0_30px_rgba(136,19,55,0.5)] hover:scale-110 active:scale-90 transition-all"><svg className="w-7 h-7 rotate-[135deg]" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" /></svg></button>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col p-2 animate-in fade-in duration-500">
                    <div className="flex gap-2 h-[280px] w-full">
                      <div className="flex-1 rounded-[18px] bg-black border border-white/5 overflow-hidden relative shadow-2xl">
                        <video ref={remoteVideoRef} autoPlay playsInline className={`w-full h-full object-cover transition-opacity duration-700 ${callStatus === "CONNECTED" ? 'opacity-100' : 'opacity-0'}`} />
                        {callStatus !== "CONNECTED" && (<div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0D0D12]"><div className="w-10 h-10 border-2 border-[#881337]/20 border-t-[#BE123C] rounded-full animate-spin mb-3"></div><span className="text-[8px] font-black uppercase tracking-widest text-[#881337]/60">Connecting...</span></div>)}
                        <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center gap-1.5 z-20"><div className={`w-1 h-1 rounded-full ${callStatus === "CONNECTED" ? "bg-green-500" : "bg-yellow-500 animate-pulse"}`}></div><span className="text-[7px] font-black uppercase text-white tracking-widest">Partner</span></div>
                      </div>
                      <div className="flex-1 rounded-[18px] bg-black border border-[#BE123C]/20 overflow-hidden relative shadow-2xl transition-all">
                        <video ref={localVideoRef} autoPlay playsInline muted className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-700 ${!isVideoEnabled ? 'opacity-0' : 'opacity-100'}`} />
                        {!isVideoEnabled && <div className="absolute inset-0 flex items-center justify-center bg-[#0D0D12]"><span className="text-[8px] font-black uppercase text-white/30 tracking-widest">Camera Off</span></div>}
                        <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center gap-1.5 z-20"><div className="w-1 h-1 rounded-full bg-green-500"></div><span className="text-[7px] font-black uppercase text-white tracking-widest">You</span></div>
                      </div>
                    </div>
                    <div className="flex items-center justify-center gap-4 mt-4 py-2">
                      <button onClick={toggleMute} className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-xl ${isAudioMuted ? "bg-[#881337] border-[#881337] text-white shadow-[0_0_15px_rgba(136,19,55,0.5)]" : "bg-black/60 border-white/10 text-white hover:bg-black/80"}`}><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg></button>
                      <button onClick={toggleVideo} className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-3xl border transition-all ${!isVideoEnabled ? "bg-[#881337] border-[#881337] text-white shadow-[0_0_15px_rgba(136,19,55,0.5)]" : "bg-black/60 border-white/10 text-white hover:bg-black/80"}`}><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg></button>
                      <button onClick={() => endCall()} className="w-14 h-14 rounded-full bg-[#881337] flex items-center justify-center text-white border border-[#881337]/50 shadow-[0_0_25px_rgba(136,19,55,0.6)] hover:scale-110 active:scale-90 transition-all"><svg className="w-7 h-7 rotate-[135deg]" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" /></svg></button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex-1 bg-[#0D0D12] backdrop-blur-2xl border border-[#881337]/10 rounded-[22px] flex flex-col relative overflow-hidden shadow-2xl animate-in slide-in-from-bottom-6 duration-700">
                <div className="p-5 border-b border-white/5 bg-black/40 backdrop-blur-md flex items-center justify-between"><h3 className="text-[10px] font-black uppercase tracking-[0.5em] text-[#8B8B9A] italic">Heartbeat Chat</h3><div className="flex gap-1.5 px-2"><div className="w-1.5 h-1.5 bg-[#881337] rounded-full animate-pulse shadow-[0_0_8px_#881337]"></div><div className="w-1.5 h-1.5 bg-[#881337] rounded-full animate-pulse [animation-delay:0.2s] shadow-[0_0_8px_#881337]"></div></div></div>
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
                  <div className="flex items-center gap-2 mb-4 px-1 overflow-x-auto custom-scrollbar pb-2">
                    {["❤️", "💖", "😘", "😂", "😭", "😮", "😡", "🔥", "🍿"].map((emoji) => (
                      <button 
                        key={emoji} 
                        type="button"
                        onClick={() => sendReaction(emoji)}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-rose-500/20 hover:scale-110 transition-all text-sm border border-white/5"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
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
