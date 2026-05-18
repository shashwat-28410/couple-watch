import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Navbar from "../components/Navbar";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";

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
  const [isChangingVideo, setIsChangingVideo] = useState(false);
  const [viewMode, setViewMode] = useState("fit"); // fit, fill
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [overlayPos, setOverlayPos] = useState({ x: 20, y: 20 });
  const [isOverlayMinimized, setIsOverlayMinimized] = useState(false);
  const [isHistoryEnabled, setIsHistoryEnabled] = useState(() => localStorage.getItem("couplewatch_history_enabled") === "true");
  const [videoError, setVideoError] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
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
  const [profile, setProfile] = useState(null);

  // ── Feature 1: Fullscreen Watch Mode ──
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFsChat, setShowFsChat] = useState(false);
  const [fsCursorHidden, setFsCursorHidden] = useState(false);

  // ── Feature 2: Host Transfer ──
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  // ── Feature 3: Invite Link ──
  const [inviteCopied, setInviteCopied] = useState(false);

  // ── Feature 4: Watch History ──
  const watchHistoryIdRef = useRef(null);
  const historyIntervalRef = useRef(null);
  const watchStartTimeRef = useRef(null);

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
  const overlayRemoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const iceCandidatesQueue = useRef([]);
  const isReconnectingRef = useRef(false);
  // Feature 1 refs
  const fullscreenContainerRef = useRef(null);
  const fsMouseTimerRef = useRef(null);
  const inviteTimeoutRef = useRef(null);
  const initialSeekDoneRef = useRef(false);

  // Sync refs with state
  useEffect(() => { roomStateRef.current = roomState; }, [roomState]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // WebRTC Stream Attachments
  useEffect(() => { 
    if (remoteStream && remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream; 
    if (remoteStream && overlayRemoteVideoRef.current) overlayRemoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream, callStatus, isFullscreen]);
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
        try { await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } catch (err) { console.error("ICE Candidate Error:", err); }
      } else iceCandidatesQueue.current.push(candidate);
    } else if (type === "hangup") endCall(false);
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
      // Send request for live sync from host
      if (channelRef.current && connectionStatus === "SUBSCRIBED") {
        channelRef.current.send({ type: "broadcast", event: "request-sync", payload: {} });
      }
      // Immediate fallback to DB state while waiting for broadcast
      const { data } = await supabase.from("room_state").select("*").eq("room_id", room.id).single();
      if (data) {
        setRoomState(data);
        playerRef.current.currentTime = data.current_timestamp_seconds;
        if (data.is_playing) playerRef.current.play().catch(() => {}); else playerRef.current.pause();
      }
    } catch (err) { console.error("Force Sync Error:", err); }
  };

  // ─── Feature 1: Fullscreen ───────────────────────────────
  const toggleFullscreen = useCallback(async () => {
    const el = fullscreenContainerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error("Fullscreen error:", err);
    }
  }, []);

  // Listen for native fullscreen changes (e.g. user pressing ESC)
  useEffect(() => {
    const onFsChange = () => {
      const inFs = !!document.fullscreenElement;
      setIsFullscreen(inFs);
      if (!inFs) {
        setShowFsChat(false);
        setFsCursorHidden(false);
        if (fsMouseTimerRef.current) clearTimeout(fsMouseTimerRef.current);
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Show controls on interaction and auto-hide after 3s if playing
  const triggerInteraction = useCallback(() => {
    setFsCursorHidden(false);
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3500);
    if (fsMouseTimerRef.current) clearTimeout(fsMouseTimerRef.current);
    fsMouseTimerRef.current = setTimeout(() => setFsCursorHidden(true), 3500);
  }, []);

  // ─── Feature 2: Host Transfer ─────────────────────────────
  /** Extract a readable title from a video URL (filename without extension). */
  const extractVideoTitle = (url) => {
    try {
      const pathname = new URL(url).pathname;
      const filename = pathname.split("/").pop() || "";
      return decodeURIComponent(filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")) || "Untitled Video";
    } catch {
      return "Untitled Video";
    }
  };

  const handleTransferHost = async () => {
    if (!room || !user || transferring) return;
    const partner = members.find((m) => m.user_id !== user.id);
    if (!partner) return;
    setTransferring(true);
    try {
      // Update both members' roles in DB
      await Promise.all([
        supabase.from("room_members").update({ role: "member" }).eq("room_id", room.id).eq("user_id", user.id),
        supabase.from("room_members").update({ role: "host" }).eq("room_id", room.id).eq("user_id", partner.user_id),
        supabase.from("rooms").update({ host_id: partner.user_id }).eq("id", room.id),
      ]);
      // Broadcast role change so both clients update immediately
      if (channelRef.current && connectionStatus === "SUBSCRIBED") {
        channelRef.current.send({
          type: "broadcast",
          event: "host-transfer",
          payload: { newHostId: partner.user_id, oldHostId: user.id },
        });
      }
      // Update local state
      setIsHost(false);
      isHostRef.current = false;
      setMembers((prev) =>
        prev.map((m) => ({ ...m, role: m.user_id === partner.user_id ? "host" : "member" }))
      );
      setToastMsg("🔄 Host transferred to your partner");
    } catch (err) {
      console.error("Transfer host error:", err);
      setToastMsg("❌ Transfer failed. Try again.");
    } finally {
      setTransferring(false);
      setShowTransferModal(false);
    }
  };

  // ─── Feature 3: Invite Link ───────────────────────────────
  const copyInviteLink = useCallback(() => {
    const link = `${window.location.origin}/join/${code}`;
    navigator.clipboard.writeText(link).then(() => {
      setInviteCopied(true);
      setToastMsg("🔗 Invite link copied!");
      
      // Fix: properly track and clear timeout
      if (inviteTimeoutRef.current) clearTimeout(inviteTimeoutRef.current);
      inviteTimeoutRef.current = setTimeout(() => {
        setInviteCopied(false);
      }, 2500);
    });
  }, [code]);

  // ─── Feature 4: Watch History ─────────────────────────────
  const startWatchHistory = useCallback(async (videoUrl, roomData, userId, allMembers) => {
    if (!roomData?.id || !userId) return;
    try {
      // End any previous open session
      if (watchHistoryIdRef.current) {
        await supabase
          .from("watch_history")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", watchHistoryIdRef.current);
      }
      if (historyIntervalRef.current) clearInterval(historyIntervalRef.current);

      const participants = allMembers.map((m) => m.user_id);
      if (!participants.includes(userId)) participants.push(userId);

      const { data: row } = await supabase
        .from("watch_history")
        .insert([{
          room_id: roomData.id,
          video_url: videoUrl,
          video_title: extractVideoTitle(videoUrl),
          participants,
          last_position_seconds: 0,
          total_watched_seconds: 0,
        }])
        .select()
        .single();

      if (row) {
        watchHistoryIdRef.current = row.id;
        watchStartTimeRef.current = Date.now();
        // Update position every 30 s
        historyIntervalRef.current = setInterval(async () => {
          if (!playerRef.current || !watchHistoryIdRef.current) return;
          const elapsed = (Date.now() - (watchStartTimeRef.current || Date.now())) / 1000;
          await supabase.from("watch_history").update({
            last_position_seconds: playerRef.current.currentTime,
            total_watched_seconds: elapsed,
          }).eq("id", watchHistoryIdRef.current);
        }, 30000);
      }
    } catch (err) {
      console.error("Watch history start error:", err);
    }
  }, []);

  const endWatchHistory = useCallback(async () => {
    if (!watchHistoryIdRef.current) return;
    if (historyIntervalRef.current) clearInterval(historyIntervalRef.current);
    const elapsed = watchStartTimeRef.current
      ? (Date.now() - watchStartTimeRef.current) / 1000
      : 0;
    try {
      await supabase.from("watch_history").update({
        ended_at: new Date().toISOString(),
        last_position_seconds: playerRef.current?.currentTime || 0,
        total_watched_seconds: elapsed,
      }).eq("id", watchHistoryIdRef.current);
    } catch (err) {
      console.error("Watch history end error:", err);
    } finally {
      watchHistoryIdRef.current = null;
      watchStartTimeRef.current = null;
    }
  }, []);

  // Cleanup history on unmount
  useEffect(() => {
    return () => {
      if (historyIntervalRef.current) clearInterval(historyIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    async function initRoom() {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) { navigate("/", { replace: true }); return; }
        setUser(authUser);
        const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", authUser.id).single();
        if (prof) setProfile(prof);
        const { data: roomData } = await supabase.from("rooms").select("*").eq("room_code", code).single();
        if (!roomData) { navigate("/", { replace: true }); return; }
        setRoom(roomData);
        const { data: existingMember } = await supabase.from("room_members").select("*").eq("room_id", roomData.id).eq("user_id", authUser.id).maybeSingle();
        if (!existingMember) {
          await supabase.from("room_members").insert([{ room_id: roomData.id, user_id: authUser.id, role: roomData.created_by === authUser.id ? "host" : "member" }]);
        }
        const [stateRes, membersRes, messagesRes] = await Promise.all([
          supabase.from("room_state").select("*").eq("room_id", roomData.id).maybeSingle(),
          supabase.from("room_members").select("id, role, user_id, profiles(full_name)").eq("room_id", roomData.id),
          supabase.from("messages").select("id, content, created_at, user_id, profiles(full_name)").eq("room_id", roomData.id).order("created_at", { ascending: true }).limit(50)
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
      } catch (err) { console.error("Init Room Error:", err); navigate("/", { replace: true }); }
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
            setMessages(current => current.some(m => m.id === payload.new.id) ? current : [...current, { ...payload.new, profiles: { full_name: "Partner" } }]);
            supabase.from("profiles").select("full_name").eq("id", payload.new.user_id).single().then(({ data }) => {
              if (data) setMessages(c => c.map(m => m.id === payload.new.id ? { ...m, profiles: data } : m));
            });
          })
          .on("broadcast", { event: "chat-msg" }, ({ payload }) => setMessages(current => current.some(x => x.id === payload.id) ? current : [...current, payload]))
          .on("broadcast", { event: "webrtc-signal" }, ({ payload }) => handleWebRTCSignal(payload))
          .on("broadcast", { event: "sync-event" }, ({ payload }) => {
            setRoomState(payload);
            if (payload.force && playerRef.current && !isHostRef.current) {
              playerRef.current.currentTime = payload.current_timestamp_seconds;
            }
          })
          .on("broadcast", { event: "floating-reaction" }, ({ payload }) => triggerReaction(payload.emoji))
          .on("broadcast", { event: "request-sync" }, () => {
            if (isHostRef.current && playerRef.current && channelRef.current) {
              channelRef.current.send({ type: "broadcast", event: "sync-event", payload: { ...roomStateRef.current, current_timestamp_seconds: playerRef.current.currentTime, force: true } });
            }
          })
          // Feature 2: Host Transfer — update roles on both clients instantly
          .on("broadcast", { event: "host-transfer" }, ({ payload }) => {
            const { newHostId } = payload;
            const amNewHost = user.id === newHostId;
            setIsHost(amNewHost);
            isHostRef.current = amNewHost;
            setMembers((prev) =>
              prev.map((m) => ({ ...m, role: m.user_id === newHostId ? "host" : "member" }))
            );
            setToastMsg(amNewHost ? "👑 You are now the Host!" : "🔄 Host control transferred");
          })
          .on("presence", { event: "sync" }, () => {
            const state = subChannel.presenceState();
            setOnlineUsers(Object.keys(state));
            const typing = [];
            Object.keys(state).forEach(key => {
              if (key === user.id) return;
              const presenceEntries = state[key];
              if (presenceEntries?.some(p => p.is_typing)) typing.push(presenceEntries[0].full_name || "Partner");
            });
            setTypingUsers(typing);
          })
          .subscribe(async (status) => {
            setConnectionStatus(status); isReconnectingRef.current = false;
            if (status === "SUBSCRIBED") {
              const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
              await subChannel.track({ 
                online_at: new Date().toISOString(), 
                is_typing: false, 
                full_name: prof?.full_name || user.email?.split('@')[0]
              });
            }
            if (status === "TIMED_OUT" || status === "CLOSED" || status === "CHANNEL_ERROR") {
              if (reconnectTimeout) clearTimeout(reconnectTimeout);
              reconnectTimeout = setTimeout(setupChannel, 3000);
            }
          });
      } catch (err) { console.error("Setup Channel Error:", err); isReconnectingRef.current = false; }
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
  }, [roomState?.is_playing, roomState?.current_timestamp_seconds, roomState?.video_url, hasInteracted, isHost]);

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

  const handleTyping = async () => {
    if (!channelRef.current || !user || connectionStatus !== "SUBSCRIBED") return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
      channelRef.current.track({ 
        online_at: new Date().toISOString(), 
        is_typing: true, 
        full_name: prof?.full_name || user.email?.split('@')[0]
      });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(async () => {
      isTypingRef.current = false;
      if (channelRef.current) {
        const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
        channelRef.current.track({ 
          online_at: new Date().toISOString(), 
          is_typing: false, 
          full_name: prof?.full_name || user.email?.split('@')[0]
        });
      }
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
    supabase.from("room_state").update(payload).eq("room_id", room.id).then(() => {
      setVideoUrlInput("");
      // Feature 4: Start tracking watch history for this new video if enabled
      if (isHistoryEnabled) {
        startWatchHistory(url, room, user.id, members);
      }
      triggerInteraction();
    });
  };

  const handleSendMessage = async (e) => {
    e.preventDefault(); if (!newMessage.trim() || !user || !room) return;
    const content = newMessage.trim(); setNewMessage("");
    const { data } = await supabase.from("messages").insert([{ room_id: room.id, user_id: user.id, content }]).select().single();
    if (data) {
      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
      const fullMsg = { ...data, profiles: prof || { full_name: user.email?.split('@')[0] } };
      setMessages(current => [...current, fullMsg]);
      if (channelRef.current && connectionStatus === "SUBSCRIBED") channelRef.current.send({ type: "broadcast", event: "chat-msg", payload: fullMsg });
    }
  };

  async function updateRoomState(newValues, forceJump = false) {
    if (!isHost || !room) return;
    setRoomState(prev => {
      const compensatedValues = { ...prev, ...newValues };
      if (channelRef.current && connectionStatus === "SUBSCRIBED") {
        channelRef.current.send({ type: "broadcast", event: "sync-event", payload: { ...compensatedValues, force: forceJump } });
      }
      return compensatedValues;
    });
    await supabase.from("room_state").update(newValues).eq("room_id", room.id);
  }

  useEffect(() => {
    if (zoomLevel <= 1) {
      setPanOffset({ x: 0, y: 0 });
    }
  }, [zoomLevel]);

  const handleMouseDown = (e) => {
    if (zoomLevel <= 1) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    clickStartPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const [isOverlayDragging, setIsOverlayDragging] = useState(false);
  const overlayDragStartRef = useRef({ x: 0, y: 0 });

  const handleOverlayMouseDown = (e) => {
    e.stopPropagation();
    setIsOverlayDragging(true);
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    overlayDragStartRef.current = { x: clientX - overlayPos.x, y: clientY - overlayPos.y };
  };

  const handleMouseMove = (e) => {
    triggerInteraction();
    
    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    if (clientX === undefined) return;

    // Video Pan Logic
    if (isDragging && zoomLevel > 1) {
      const dx = clientX - dragStartRef.current.x;
      const dy = clientY - dragStartRef.current.y;
      setPanOffset(prev => ({
        x: Math.max(-500, Math.min(500, prev.x + dx)),
        y: Math.max(-500, Math.min(500, prev.y + dy))
      }));
      dragStartRef.current = { x: clientX, y: clientY };
    }

    // Overlay Drag Logic
    if (isOverlayDragging) {
      const newX = clientX - overlayDragStartRef.current.x;
      const newY = clientY - overlayDragStartRef.current.y;
      
      // Clamp within screen boundaries
      const maxX = window.innerWidth - (isOverlayMinimized ? 40 : 256);
      const maxY = window.innerHeight - (isOverlayMinimized ? 40 : 176);
      
      setOverlayPos({
        x: Math.max(0, Math.min(maxX, newX)),
        y: Math.max(0, Math.min(maxY, newY))
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setIsOverlayDragging(false);
  };

  const handleVideoClick = (e) => {
    if (e.target.closest('button')) return;
    const dist = Math.hypot(e.clientX - (clickStartPosRef.current?.x || e.clientX), e.clientY - (clickStartPosRef.current?.y || e.clientY));
    if (zoomLevel > 1 && dist > 5) return; // it was a drag
    
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
      triggerInteraction();
    }
  };

  const handleLeaveRoom = async () => {
    // Feature 4: Persist final watch position before leaving if enabled
    if (isHistoryEnabled) {
      await endWatchHistory();
    }

    // Feature 2: Auto-transfer host to partner if host is leaving and partner is online
    if (isHost && members.length > 1) {
      const partner = members.find((m) => m.user_id !== user?.id);
      if (partner && onlineUsers.includes(partner.user_id)) {
        try {
          await Promise.all([
            supabase.from("room_members").update({ role: "member" }).eq("room_id", room.id).eq("user_id", user.id),
            supabase.from("room_members").update({ role: "host" }).eq("room_id", room.id).eq("user_id", partner.user_id),
            supabase.from("rooms").update({ host_id: partner.user_id }).eq("id", room.id),
          ]);
          if (channelRef.current && connectionStatus === "SUBSCRIBED") {
            channelRef.current.send({
              type: "broadcast",
              event: "host-transfer",
              payload: { newHostId: partner.user_id, oldHostId: user.id },
            });
          }
        } catch (e) { console.error("Auto-transfer failed:", e); }
      }
    }

    endCall(true);
    window.location.href = "/";
  };

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
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <p className="text-[#8B8B9A] text-[11px] font-black tracking-[0.3em] uppercase flex items-center gap-3">Room Code: <span className="text-white bg-white/5 px-3 py-1 rounded-md">{code}</span></p>
                {/* Feature 3: Invite link button */}
                <button
                  onClick={copyInviteLink}
                  className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all border ${
                    inviteCopied
                      ? "bg-green-900/30 border-green-500/30 text-green-400"
                      : "bg-white/5 border-white/10 text-[#8B8B9A] hover:border-[#881337]/40 hover:text-white"
                  }`}
                >
                  {inviteCopied ? "✓ Copied!" : "🔗 Invite Partner"}
                </button>
              </div>
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
              {/* Feature 1: fullscreen-container ref wraps the entire video card */}
              <div ref={fullscreenContainerRef} className={`fullscreen-container romantic-card !p-0 border-white/5 bg-white/[0.02] overflow-hidden shadow-2xl relative ${isFullscreen && fsCursorHidden ? 'fs-cursor-hidden' : ''}`}
                onMouseMove={triggerInteraction}
              >
                <div className={`relative bg-black group cursor-pointer overflow-hidden ${isFullscreen ? 'w-full h-screen' : 'aspect-video'}`} onClick={handleVideoClick} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
                  {floatingReactions.map(r => (
                    <div key={r.id} className="float-reaction" style={{ left: `${r.left}%`, bottom: '20px' }}>{r.emoji}</div>
                  ))}
                  {/* Feature 4: Fullscreen Call Overlay */}
                  {isFullscreen && callStatus === "CONNECTED" && remoteStream && (
                    <div 
                      className={`absolute z-[100] ${isOverlayDragging ? '' : 'transition-all duration-300'} ${isOverlayMinimized ? 'w-10 h-10' : 'w-48 h-32 md:w-64 md:h-44'} rounded-2xl overflow-hidden border border-[#881337]/40 shadow-2xl bg-[#0D0D12] group/overlay`}
                      style={{ 
                        left: overlayPos.x, 
                        top: overlayPos.y, 
                        cursor: isOverlayDragging ? 'grabbing' : 'grab',
                        touchAction: 'none'
                      }}
                      onMouseDown={handleOverlayMouseDown}
                      onTouchStart={handleOverlayMouseDown}
                      onMouseMove={handleMouseMove}
                      onTouchMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onTouchEnd={handleMouseUp}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!isOverlayMinimized && (
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-white/20 z-30 pointer-events-none" />
                      )}
                      <video 
                        ref={overlayRemoteVideoRef} 
                        autoPlay 
                        playsInline 
                        className={`w-full h-full object-cover ${isOverlayMinimized ? 'opacity-0' : 'opacity-100'}`} 
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/overlay:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setIsOverlayMinimized(!isOverlayMinimized); }}
                          className="w-10 h-10 rounded-full bg-black/80 border border-white/10 flex items-center justify-center hover:bg-white/20 transition-all text-white shadow-xl"
                          title={isOverlayMinimized ? "Expand Camera" : "Minimize Camera"}
                        >
                          {isOverlayMinimized ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg> : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 12H6" /></svg>}
                        </button>
                      </div>
                      {isOverlayMinimized && (
                        <div 
                          className="absolute inset-0 flex items-center justify-center bg-[#1A1A1F] cursor-pointer hover:bg-[#2A2A2F] transition-colors"
                          onClick={(e) => { e.stopPropagation(); setIsOverlayMinimized(false); }}
                        >
                          <svg className="w-5 h-5 text-[#881337] animate-pulse" fill="currentColor" viewBox="0 0 24 24"><path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
                        </div>
                      )}
                    </div>
                  )}
                  {roomState?.video_url ? (
                    <video ref={playerRef} src={roomState.video_url} className={`absolute inset-0 w-full h-full pointer-events-none ${viewMode === 'fill' ? 'object-cover' : 'object-contain'}`} style={{ transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`, transition: isDragging ? 'none' : 'transform 0.3s ease-out' }} playsInline
                      onLoadedMetadata={(e) => { 
                        setVideoLoading(false); 
                        setVideoDuration(e.target.duration); 
                        if (isHost && !initialSeekDoneRef.current && roomState?.current_timestamp_seconds > 0) {
                          e.target.currentTime = roomState.current_timestamp_seconds;
                          initialSeekDoneRef.current = true;
                        }
                        triggerInteraction();
                      }} 
                      onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
                      onWaiting={() => setVideoLoading(true)} onPlaying={() => setVideoLoading(false)}
                      onPlay={() => isHost && updateRoomState({ is_playing: true, current_timestamp_seconds: playerRef.current?.currentTime || 0 })}
                      onPause={() => isHost && updateRoomState({ is_playing: false, current_timestamp_seconds: playerRef.current?.currentTime || 0 })}
                      onSeeked={() => isHost && updateRoomState({ current_timestamp_seconds: playerRef.current?.currentTime || 0 }, true)}
                      onEnded={() => { if (isHost) updateRoomState({ is_playing: false, current_timestamp_seconds: 0 }, true); }}
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
                  {hasInteracted && roomState?.video_url && (
                    <div className={`absolute inset-0 z-40 flex flex-col items-center justify-end pb-24 bg-gradient-to-t from-black/80 via-black/20 to-transparent transition-opacity duration-500 ${showControls || !roomState?.is_playing ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                      <div className="flex items-center gap-12 md:gap-20 mb-6">
                        <button onClick={(e) => { e.stopPropagation(); if (playerRef.current) { playerRef.current.currentTime = Math.max(0, playerRef.current.currentTime - 5); updateRoomState({ current_timestamp_seconds: playerRef.current.currentTime }, true); } }} className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all"><span className="text-sm font-black">-5s</span></button>
                        <button onClick={(e) => { e.stopPropagation(); if (roomState.is_playing) updateRoomState({ is_playing: false, current_timestamp_seconds: playerRef.current?.currentTime || 0 }); else updateRoomState({ is_playing: true, current_timestamp_seconds: playerRef.current?.currentTime || 0 }); }} className="w-24 h-24 rounded-full border-2 border-white/30 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all">{roomState.is_playing ? <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : <svg className="w-12 h-12 ml-2" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}</button>
                        <button onClick={(e) => { e.stopPropagation(); if (playerRef.current) { playerRef.current.currentTime = Math.min(playerRef.current.duration, playerRef.current.currentTime + 5); updateRoomState({ current_timestamp_seconds: playerRef.current.currentTime }, true); } }} className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all"><span className="text-sm font-black">+5s</span></button>
                      </div>
                      <div className="w-full px-10 flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <input type="range" min="0" max={videoDuration || 100} value={currentTime} onChange={(e) => {
                            const newTime = parseFloat(e.target.value);
                            setCurrentTime(newTime);
                            if (playerRef.current) playerRef.current.currentTime = newTime;
                            updateRoomState({ current_timestamp_seconds: newTime }, true);
                          }} className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#881337] transition-all" />
                        <div className="w-full flex justify-between text-[10px] font-black text-white/60 uppercase tracking-widest">
                          <span>{new Date(currentTime * 1000).toISOString().substr(11, 8)}</span>
                          <span>{new Date(videoDuration * 1000).toISOString().substr(11, 8)}</span>
                        </div>
                      </div>
                      {/* Feature 1: Fullscreen button inside host controls */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                        className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-black/40 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"
                        title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                      >
                        {isFullscreen
                          ? <svg className="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" /></svg>
                          : <svg className="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
                        }
                      </button>
                      {/* Feature 4: View Mode & Zoom Toggle */}
                      <div className="absolute bottom-4 left-4 flex items-center gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewMode(prev => prev === "fit" ? "fill" : "fit");
                          }}
                          className="w-10 h-10 rounded-full bg-black/40 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all text-[9px] font-black uppercase tracking-widest text-white/70"
                          title="Change View Mode"
                        >
                          {viewMode === "fit" ? "FIT" : "FILL"}
                        </button>
                        <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded-full px-2 h-10" onClick={e => e.stopPropagation()}>
                          <button onClick={() => setZoomLevel(z => Math.max(1, z - 0.25))} className="text-white/50 hover:text-white px-2 py-1 transition-colors text-lg leading-none mb-0.5">-</button>
                          <span className="text-[9px] font-black uppercase tracking-widest text-white/70 w-9 text-center">{Math.round(zoomLevel * 100)}%</span>
                          <button onClick={() => setZoomLevel(z => Math.min(2, z + 0.25))} className="text-white/50 hover:text-white px-2 py-1 transition-colors text-base leading-none">+</button>
                        </div>
                      </div>
                    </div>
                  )}
                  {videoLoading && roomState?.video_url && !videoError && ( <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-10"><div className="w-14 h-14 border-4 border-rose-500/20 border-t-rose-500 rounded-full animate-spin mb-4"></div></div> )}
                  {!hasInteracted && roomState?.video_url && ( <div onClick={() => { setHasInteracted(true); triggerInteraction(); }} className="absolute inset-0 bg-[#0A0A0F]/95 flex flex-col items-center justify-center cursor-pointer backdrop-blur-2xl z-20"><div className="w-24 h-24 bg-primary-gradient rounded-full flex items-center justify-center mb-8 shadow-2xl transition-transform hover:scale-110"><span className="text-4xl text-white ml-2">▶</span></div><p className="text-3xl font-black text-white uppercase italic">Tap to join sync ❤️</p></div> )}
                </div>
                {/* Feature 1: Fullscreen chat overlay — slides in when showFsChat is true */}
                {isFullscreen && (
                  <div className={`fs-chat-overlay ${showFsChat ? 'fs-chat-open' : ''}`}>
                    <div className="p-4 border-b border-white/5 bg-black/60 flex items-center justify-between">
                      <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-[#8B8B9A] italic">Heartbeat Chat</h3>
                      <button onClick={() => setShowFsChat(false)} className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-all text-sm">✕</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                      {messages.map((msg) => (
                        <div key={msg.id} className={`flex flex-col ${msg.user_id === user?.id ? 'items-end' : 'items-start'}`}>
                          <div className={`px-4 py-2.5 rounded-[14px] text-[13px] font-medium leading-relaxed max-w-[90%] ${msg.user_id === user?.id ? 'bg-[#881337] text-white rounded-tr-none' : 'bg-[#2A2A2F] text-white/95 rounded-tl-none border border-white/5'}`}>{msg.content}</div>
                          <span className="text-[8px] font-black text-[#55556A] mt-1.5 uppercase tracking-widest opacity-60">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      ))}
                    </div>
                    <div className="p-4 border-t border-white/5 bg-black/40">
                      <form onSubmit={handleSendMessage} className="flex gap-2">
                        <input className="flex-1 bg-[#1A1A1F] border border-white/10 rounded-[12px] py-3 px-4 text-[13px] font-medium placeholder:text-[#33334A] focus:border-[#881337]/40 outline-none" value={newMessage} onChange={e => { setNewMessage(e.target.value); handleTyping(); }} placeholder="Message..." />
                        <button type="submit" className="w-10 h-10 rounded-full bg-[#881337] flex items-center justify-center text-white hover:opacity-90 transition-all"><span className="text-base">➜</span></button>
                      </form>
                    </div>
                  </div>
                )}
                {/* Feature 1: Floating fullscreen toggle — always visible when video is loaded */}
                {roomState?.video_url && !isHost && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                    className="absolute bottom-4 right-4 z-30 w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"
                    title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  >
                    {isFullscreen
                      ? <svg className="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" /></svg>
                      : <svg className="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
                    }
                  </button>
                )}
                {/* Feature 1: Floating chat toggle in fullscreen mode */}
                {isFullscreen && roomState?.video_url && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowFsChat(v => !v); }}
                    className="absolute bottom-4 right-16 z-30 w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"
                    title="Toggle Chat"
                  >
                    <svg className="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
                  </button>
                )}
                {/* Fullscreen Immersion: Hide input field/set video if in fullscreen and inactive/playing */}
                <div className={`p-8 border-t border-white/5 bg-white/[0.01] transition-opacity duration-500 ${isFullscreen && !showControls && roomState?.is_playing ? 'opacity-0 pointer-events-none absolute w-full' : 'opacity-100'}`}>
                  {isHost ? (
                    <div className="space-y-8">
                      {roomState?.video_url && !isChangingVideo ? (
                        <div className="flex justify-center">
                          <button onClick={() => setIsChangingVideo(true)} className="pill-button bg-white/5 border border-white/10 px-8 py-3 text-[10px] text-white/70 hover:bg-white/10 hover:text-white transition-all font-black tracking-[0.2em]">CHANGE VIDEO</button>
                        </div>
                      ) : (
                        <div className="flex flex-col md:flex-row gap-4">
                          <input type="text" value={videoUrlInput} onChange={(e) => setVideoUrlInput(e.target.value)} placeholder="PASTE DIRECT MP4 LINK..." className="romantic-input flex-1 text-center font-bold tracking-[0.1em] placeholder:text-[#33334A] focus:scale-[1.01]" />
                          <button onClick={() => { handleSetVideoUrl(); setIsChangingVideo(false); }} className="pill-button bg-primary-gradient px-12 text-white shadow-[0_10px_20px_rgba(190,18,60,0.2)]">SET VIDEO</button>
                        </div>
                      )}
                      {!showControls && roomState?.video_url && !isChangingVideo && ( <p className="text-center text-[10px] text-[#55556A] font-black uppercase tracking-[0.3em] animate-pulse">Tap video for controls</p> )}
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
                          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-white/10 to-transparent border border-white/10 flex items-center justify-center text-[11px] font-bold text-white shadow-xl group-hover:border-[#881337]/30 transition-all uppercase">
                            {(member.profiles?.full_name || "P")[0]}
                          </div>
                          {onlineUsers.includes(member.user_id) && <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-[3px] border-[#0A0A0F] shadow-[0_0_10px_rgba(34,197,94,0.8)]"></div>}
                        </div>
                        <div className="flex flex-col gap-0.5"><span className="text-[13px] font-bold text-white/90 truncate max-w-[140px] tracking-tight">{member.profiles?.full_name || "Partner"}</span><span className="text-[9px] font-bold text-[#55556A] uppercase tracking-widest">{member.role === 'host' ? 'Master of Sync' : 'Partner'}</span></div>
                      </div>
                      {member.role === 'host' ? <div className="px-3 py-1.5 rounded-full bg-[#881337]/10 border border-[#881337]/30 flex items-center gap-2"><span className="text-[9px] font-black uppercase text-[#BE123C] tracking-widest">Host</span><span className="text-xs">👑</span></div> : <div className="px-3 py-1.5 rounded-full bg-white/5 border border-white/5"><span className="text-[9px] font-black uppercase text-[#55556A] tracking-widest">Member</span></div>}
                    </div>
                  ))}
                </div>
                {/* Feature 2: Transfer Host button — only visible to current host when partner is online */}
                {isHost && members.length > 1 && onlineUsers.length > 1 && (
                  <button
                    onClick={() => setShowTransferModal(true)}
                    className="mt-5 w-full py-2.5 rounded-full border border-[#881337]/30 bg-[#881337]/5 text-[9px] font-black uppercase tracking-widest text-[#BE123C] hover:bg-[#881337]/15 transition-all flex items-center justify-center gap-2"
                  >
                    👑 Transfer Host
                  </button>
                )}
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
                        <div className={`w-24 h-24 rounded-full border-2 p-1.5 transition-all duration-500 ${!isAudioMuted ? "border-[#BE123C] shadow-[0_0_30px_rgba(190,18,60,0.3)]" : "border-white/10"}`}><div className="w-full h-full rounded-full bg-[#1A1A1F] flex items-center justify-center text-2xl font-bold uppercase text-white/80">{(profile?.full_name || user.email?.split('@')[0] || "Y")[0]}</div></div>
                        <div className="flex flex-col items-center gap-2">
                          <div className="flex gap-1 h-3 items-end"><div className={`w-1 rounded-full transition-all ${!isAudioMuted ? "bg-[#BE123C] animate-[bounce_0.6s_infinite] shadow-[0_0_8px_#BE123C]" : "bg-[#55556A]"}`}></div><div className={`w-1 rounded-full transition-all ${!isAudioMuted ? "bg-[#BE123C] animate-[bounce_0.8s_infinite] shadow-[0_0_8px_#BE123C] delay-75" : "bg-[#55556A]"}`}></div><div className={`w-1 rounded-full transition-all ${!isAudioMuted ? "bg-[#BE123C] animate-[bounce_0.7s_infinite] shadow-[0_0_8px_#BE123C] delay-150" : "bg-[#55556A]"}`}></div></div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-[#8B8B9A]">{profile?.full_name || "You"}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-4">
                        <div className={`w-24 h-24 rounded-full border-2 p-1.5 transition-all duration-500 ${callStatus === "CONNECTED" ? "border-[#881337] shadow-[0_0_30px_rgba(136,19,55,0.3)]" : "border-white/10 animate-pulse"}`}><div className="w-full h-full rounded-full bg-[#1A1A1F] flex items-center justify-center text-2xl font-bold uppercase text-[#BE123C]">{(members.find(m => m.user_id !== user.id)?.profiles?.full_name || "P")[0]}</div></div>
                        <div className="flex flex-col items-center gap-2">
                          <div className="flex gap-1 h-3 items-end"><div className={`w-1 rounded-full transition-all ${callStatus === "CONNECTED" ? "bg-[#881337] animate-[bounce_0.6s_infinite] shadow-[0_0_8px_#881337]" : "bg-[#55556A]"}`}></div><div className={`w-1 rounded-full transition-all ${callStatus === "CONNECTED" ? "bg-[#881337] animate-[bounce_0.8s_infinite] shadow-[0_0_8px_#881337] delay-75" : "bg-[#55556A]"}`}></div><div className={`w-1 rounded-full transition-all ${callStatus === "CONNECTED" ? "bg-[#881337] animate-[bounce_0.7s_infinite] shadow-[0_0_8px_#881337] delay-150" : "bg-[#55556A]"}`}></div></div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-[#8B8B9A]">{members.find(m => m.user_id !== user.id)?.profiles?.full_name || "Partner"}</span>
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
                        <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center gap-1.5 z-20"><div className={`w-1 h-1 rounded-full ${callStatus === "CONNECTED" ? "bg-green-500" : "bg-yellow-500 animate-pulse"}`}></div><span className="text-[7px] font-black uppercase text-white tracking-widest">{members.find(m => m.user_id !== user.id)?.profiles?.full_name || "Partner"}</span></div>
                      </div>
                      <div className="flex-1 rounded-[18px] bg-black border border-[#BE123C]/20 overflow-hidden relative shadow-2xl transition-all">
                        <video ref={localVideoRef} autoPlay playsInline muted className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-700 ${!isVideoEnabled ? 'opacity-0' : 'opacity-100'}`} />
                        {!isVideoEnabled && <div className="absolute inset-0 flex items-center justify-center bg-[#0D0D12]"><span className="text-[8px] font-black uppercase text-white/30 tracking-widest">Camera Off</span></div>}
                        <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center gap-1.5 z-20"><div className="w-1 h-1 rounded-full bg-green-500"></div><span className="text-[7px] font-black uppercase text-white tracking-widest">{profile?.full_name || "You"}</span></div>
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

      {/* Feature 1+2+3: Global Toast */}
      <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />

      {/* Feature 2: Host Transfer Confirmation Modal */}
      <ConfirmModal
        isOpen={showTransferModal}
        title="Transfer Host Control"
        description={`Are you sure you want to transfer host control to ${members.find(m => m.user_id !== user?.id)?.profiles?.full_name || 'your partner'}? They will gain full playback control and you will become the partner.`}
        confirmLabel="Transfer"
        onConfirm={handleTransferHost}
        onCancel={() => setShowTransferModal(false)}
        loading={transferring}
      />
    </div>
  );
}
