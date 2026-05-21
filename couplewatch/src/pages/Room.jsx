import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Navbar from "../components/Navbar";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";

// Hooks
import { useWebRTC } from "../hooks/useWebRTC";
import { useRoomSync } from "../hooks/useRoomSync";
import { useChat } from "../hooks/useChat";

import { formatVideoUrl } from "../lib/utils";

// Components
import { VideoPlayer } from "../components/room/VideoPlayer";
import { ChatSidebar } from "../components/room/ChatSidebar";
import { CallOverlay } from "../components/room/CallOverlay";
import { PresenceList } from "../components/room/PresenceList";
import { DraggablePartnerVideo } from "../components/room/DraggablePartnerVideo";

export default function Room() {
  const { code } = useParams();
  const navigate = useNavigate();
  
  // State
  const [user, setUser] = useState(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [floatingReactions, setFloatingReactions] = useState([]);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isTheaterMode, setIsTheaterMode] = useState(false);

  // ── Feature 2: Host Transfer ──
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  // ── Feature 3: Invite Link ──
  const [inviteCopied, setInviteCopied] = useState(false);

  // ── Feature 4: Watch History ──
  const [isHistoryEnabled] = useState(() => {
    const saved = localStorage.getItem("couplewatch_history_enabled");
    return saved === "true"; // off by default
  });
  const watchHistoryIdRef = useRef(null);
  const historyIntervalRef = useRef(null);
  const watchStartTimeRef = useRef(null);

  // Refs
  const playerRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const containerRef = useRef(null);
  const inviteTimeoutRef = useRef(null);

  const toggleFullScreen = () => {
    if (!containerRef.current) return;
    
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
      setIsFullScreen(true);
    } else {
      document.exitFullscreen();
      setIsFullScreen(false);
    }
  };

  useEffect(() => {
    const handleFullScreenChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullScreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullScreenChange);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
  }, []);

  // Use Custom Hooks
  const roomSync = useRoomSync(user, code, navigate);
  const { room, roomState, connectionStatus, channelRef } = roomSync;

  const chat = useChat(room, user, connectionStatus, channelRef);
  const webrtc = useWebRTC(user, channelRef);

  // We need stable references for the event listener
  const handleWebRTCSignalRef = useRef(webrtc.handleWebRTCSignal);
  const reBroadcastScreenOfferRef = useRef(webrtc.reBroadcastScreenOffer);

  useEffect(() => {
    handleWebRTCSignalRef.current = webrtc.handleWebRTCSignal;
    reBroadcastScreenOfferRef.current = webrtc.reBroadcastScreenOffer;
  }, [webrtc.handleWebRTCSignal, webrtc.reBroadcastScreenOffer]);

  // Audio Stream Attachment (Keep here as it's a global hidden element)
  useEffect(() => { 
    if (webrtc.remoteStream && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = webrtc.remoteStream;
    }
  }, [webrtc.remoteStream]);

  // Floating Reactions Logic
  const triggerReaction = (emoji) => {
    const id = Date.now() + Math.random();
    const left = Math.random() * 80 + 10;
    setFloatingReactions(prev => [...prev, { id, emoji, left }]);
    setTimeout(() => setFloatingReactions(prev => prev.filter(r => r.id !== id)), 2000);
  };

  const sendReaction = (emoji) => {
    triggerReaction(emoji);
    if (channelRef.current && connectionStatus === "SUBSCRIBED") {
      channelRef.current.send({ type: "broadcast", event: "floating-reaction", payload: { emoji } });
    }
  };

  // ─── Feature 4: Watch History Helpers ─────────────────────
  const extractVideoTitle = (url) => {
    try {
      const pathname = new URL(url).pathname;
      const filename = pathname.split("/").pop() || "";
      return decodeURIComponent(filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")) || "Untitled Video";
    } catch {
      return "Untitled Video";
    }
  };

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
        
        // Update position and elapsed time in the database every 30 seconds
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

  useEffect(() => {
    return () => {
      if (historyIntervalRef.current) clearInterval(historyIntervalRef.current);
      if (inviteTimeoutRef.current) clearTimeout(inviteTimeoutRef.current);
    };
  }, []);

  // Channel setup (The glue)
  useEffect(() => {
    if (!room?.id || !user?.id) return;
    
    let subChannel;
    
    const setupChannel = async () => {
      if (subChannel) supabase.removeChannel(subChannel);
      
      subChannel = supabase.channel(`room_${room.id}`, { 
        config: { presence: { key: user.id }, broadcast: { self: false, ack: false } } 
      });
      channelRef.current = subChannel;

      subChannel
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "room_state", filter: `room_id=eq.${room.id}` }, (p) => roomSync.setRoomState(prev => ({ ...prev, ...p.new })))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${room.id}` }, async (payload) => {
          chat.setMessages(current => current.some(m => m.id === payload.new.id) ? current : [...current, { ...payload.new, profiles: { full_name: "Partner" } }]);
          supabase.from("profiles").select("full_name").eq("id", payload.new.user_id).single().then(({ data }) => {
            if (data) chat.setMessages(c => c.map(m => m.id === payload.new.id ? { ...m, profiles: data } : m));
          });
        })
        .on("broadcast", { event: "chat-msg" }, ({ payload }) => chat.setMessages(current => current.some(x => x.id === payload.id) ? current : [...current, payload]))
        .on("broadcast", { event: "webrtc-signal" }, ({ payload }) => handleWebRTCSignalRef.current(payload))
        .on("broadcast", { event: "sync-event" }, ({ payload }) => {
          roomSync.setRoomState(payload);
          if (payload.force && playerRef.current && !roomSync.isHostRef.current) {
            playerRef.current.currentTime = payload.current_timestamp_seconds;
          }
        })
        .on("broadcast", { event: "floating-reaction" }, ({ payload }) => triggerReaction(payload.emoji))
        .on("broadcast", { event: "request-sync" }, () => {
          if (roomSync.isHostRef.current && playerRef.current && channelRef.current) {
            channelRef.current.send({ 
              type: "broadcast", 
              event: "sync-event", 
              payload: { ...roomSync.roomStateRef.current, current_timestamp_seconds: playerRef.current.currentTime, force: true } 
            });
            // Re-offer screen share if active
            reBroadcastScreenOfferRef.current();
          }
        })
        // Feature 2: Host Transfer broadcast listener
        .on("broadcast", { event: "host-transfer" }, ({ payload }) => {
          const { newHostId } = payload;
          const amNewHost = user.id === newHostId;
          
          roomSync.setIsHost(amNewHost);
          roomSync.isHostRef.current = amNewHost;
          roomSync.setMembers((prev) =>
            prev.map((m) => ({ ...m, role: m.user_id === newHostId ? "host" : "member" }))
          );
          setToastMsg(amNewHost ? "👑 You are now the Host!" : "🔄 Host control transferred");
        })
        .on("presence", { event: "sync" }, () => {
          const state = subChannel.presenceState();
          roomSync.setOnlineUsers(Object.keys(state));
          const typing = [];
          Object.keys(state).forEach(key => {
            if (key === user.id) return;
            const presenceEntries = state[key];
            if (presenceEntries?.some(p => p.is_typing)) typing.push(presenceEntries[0].full_name || "Partner");
          });
          roomSync.setTypingUsers(typing);
        })
        .subscribe(async (status) => {
          roomSync.setConnectionStatus(status);
          if (status === "SUBSCRIBED") {
            const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
            await subChannel.track({ 
              online_at: new Date().toISOString(), 
              is_typing: false, 
              full_name: prof?.full_name || user.email?.split('@')[0]
            });
          }
          if (status === "TIMED_OUT" || status === "CLOSED" || status === "CHANNEL_ERROR") {
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(setupChannel, 3000);
          }
        });
    };
    setupChannel();

    return () => {
      if (subChannel) supabase.removeChannel(subChannel);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [room?.id, user?.id]);

  // Stable Syncing effect
  useEffect(() => {
    if (playerRef.current && hasInteracted && roomState) {
      if (roomState.is_playing && playerRef.current.paused) playerRef.current.play().catch(() => {});
      else if (!roomState.is_playing && !playerRef.current.paused) playerRef.current.pause();
      
      if (!roomSync.isHost) {
        const hostTime = roomState.current_timestamp_seconds;
        const myTime = playerRef.current.currentTime;
        const drift = myTime - hostTime;
        if (Math.abs(drift) > 2) {
          playerRef.current.currentTime = hostTime;
          playerRef.current.playbackRate = 1.0;
        } else if (Math.abs(drift) > 0.5) {
          playerRef.current.playbackRate = drift < 0 ? 1.05 : 0.95;
        } else playerRef.current.playbackRate = 1.0;
      }
    }
  }, [roomState?.is_playing, roomState?.current_timestamp_seconds, hasInteracted, roomSync.isHost]);

  // Host Sync Broadcast
  useEffect(() => {
    if (!roomSync.isHost || !roomState?.is_playing || connectionStatus !== "SUBSCRIBED") return;
    const syncInterval = setInterval(() => {
      if (playerRef.current && channelRef.current) {
        channelRef.current.send({ 
          type: "broadcast", 
          event: "sync-event", 
          payload: { ...roomSync.roomStateRef.current, current_timestamp_seconds: playerRef.current.currentTime } 
        });
      }
    }, 2000);
    return () => clearInterval(syncInterval);
  }, [roomSync.isHost, roomState?.is_playing, connectionStatus]);

  const handleForceSync = async () => {
    setHasInteracted(true);
    if (channelRef.current && connectionStatus === "SUBSCRIBED") {
      channelRef.current.send({ type: "broadcast", event: "request-sync", payload: {} });
    }
  };

  const handleSetVideoUrl = () => {
    const formattedUrl = formatVideoUrl(videoUrlInput);
    if (!roomSync.isHost || !room || !formattedUrl) return;
    const payload = { video_url: formattedUrl, current_timestamp_seconds: 0, is_playing: false };
    roomSync.updateRoomState(payload);
    setVideoUrlInput("");
    setHasInteracted(true);

    // Feature 4: Start watch history session if enabled
    if (isHistoryEnabled) {
      startWatchHistory(formattedUrl, room, user.id, roomSync.members);
    }
  };

  // ─── Feature 2: Host Transfer Helper ──────────────────────
  const handleTransferHost = async () => {
    if (!room || !user || transferring) return;
    const partner = roomSync.members.find((m) => m.user_id !== user.id);
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
      roomSync.setIsHost(false);
      roomSync.isHostRef.current = false;
      roomSync.setMembers((prev) =>
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

  // ─── Feature 3: Invite Link Helper ────────────────────────
  const copyInviteLink = useCallback(() => {
    const link = `${window.location.origin}/join/${code}`;
    navigator.clipboard.writeText(link).then(() => {
      setInviteCopied(true);
      setToastMsg("🔗 Invite link copied!");
      
      if (inviteTimeoutRef.current) clearTimeout(inviteTimeoutRef.current);
      inviteTimeoutRef.current = setTimeout(() => {
        setInviteCopied(false);
      }, 2500);
    });
  }, [code]);

  // ─── Feature 2: Leaving Room Auto-Transfer & History Cleanup ─────
  const handleLeaveRoom = async () => {
    // Feature 4: Persist final watch position before leaving if enabled
    if (isHistoryEnabled) {
      await endWatchHistory();
    }

    // Feature 2: Auto-transfer host to partner if host is leaving and partner is online
    if (roomSync.isHost && roomSync.members.length > 1) {
      const partner = roomSync.members.find((m) => m.user_id !== user?.id);
      if (partner && roomSync.onlineUsers.includes(partner.user_id)) {
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
        } catch (e) { 
          console.error("Auto-transfer failed:", e); 
        }
      }
    }

    if (webrtc.screenStream) webrtc.stopScreenShare();
    webrtc.endCall(true);
    navigate("/");
  };

  if (roomSync.isInitializing) {
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

  // Only show sidebar if theater mode is inactive
  const showSidebar = !isTheaterMode;

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex flex-col font-sans overflow-hidden">
      <div className="w-full absolute top-0 z-50"><Navbar user={user} /></div>
      <div className="flex-1 overflow-y-auto custom-scrollbar pt-32 pb-20 px-4 md:px-8">
        <div className="max-width-container mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-12 animate-in fade-in slide-in-from-top-6 duration-700">
            <div>
              <h1 className="text-4xl font-black tracking-tight uppercase italic text-primary-gradient leading-none">Movie Night Room</h1>
              <div className="mt-4 flex items-center gap-3">
                <p className="text-[#8B8B9A] text-[11px] font-black tracking-[0.3em] uppercase flex items-center gap-2">
                  Room Code: <span className="text-white bg-white/5 px-3 py-1 rounded-md">{code}</span>
                </p>
                <button
                  onClick={copyInviteLink}
                  className={`px-3 py-1 text-[9px] font-black uppercase tracking-widest rounded-md border transition-all ${
                    inviteCopied 
                      ? 'bg-green-500/20 border-green-500/40 text-green-400' 
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {inviteCopied ? '✓ Copied' : '🔗 Invite'}
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
            <div className="flex-1 w-full space-y-10 animate-in slide-in-from-left-6 duration-700">
              <VideoPlayer 
                roomState={roomState} 
                isHost={roomSync.isHost} 
                playerRef={playerRef} 
                hasInteracted={hasInteracted} 
                setHasInteracted={setHasInteracted} 
                updateRoomState={roomSync.updateRoomState}
                floatingReactions={floatingReactions}
                isFullScreen={isFullScreen}
                toggleFullScreen={toggleFullScreen}
                isTheaterMode={isTheaterMode}
                setIsTheaterMode={setIsTheaterMode}
                containerRef={containerRef}
                callType={webrtc.callType}
                screenStream={webrtc.screenStream}
                remoteScreenStream={webrtc.remoteScreenStream}
                sendRemoteSignal={channelRef.current?.send}
              >
                {(isFullScreen || isTheaterMode) && (
                  <DraggablePartnerVideo 
                    remoteStream={webrtc.remoteStream}
                    callStatus={webrtc.callStatus}
                    partnerName={roomSync.members.find(m => m.user_id !== user?.id)?.profiles?.full_name || "Partner"}
                  />
                )}
              </VideoPlayer>
              
              <div className="p-8 border-t border-white/5 bg-white/[0.01] rounded-b-[22px]">
                {roomSync.isHost ? (
                  <div className="flex flex-col gap-6">
                    <div className="flex flex-col md:flex-row gap-4">
                      <input type="text" value={videoUrlInput} onChange={(e) => setVideoUrlInput(e.target.value)} placeholder="PASTE DIRECT MP4 LINK..." className="romantic-input flex-1 text-center font-bold tracking-[0.1em] placeholder:text-[#33334A] focus:scale-[1.01]" />
                      <button onClick={handleSetVideoUrl} className="pill-button bg-primary-gradient px-12 text-white">SET VIDEO</button>
                    </div>

                    <div className="flex items-center justify-center gap-4">
                      <div className="h-px bg-white/5 flex-1"></div>
                      <span className="text-[10px] font-black text-[#33334A] uppercase tracking-[0.3em]">OR SCREEN SHARE</span>
                      <div className="h-px bg-white/5 flex-1"></div>
                    </div>

                    <div className="flex justify-center">
                      <button 
                        onClick={() => webrtc.screenStream ? webrtc.stopScreenShare() : webrtc.startScreenShare()} 
                        className={`px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-300 active:scale-95 border ${
                          webrtc.screenStream 
                          ? 'bg-[#881337] text-white border-[#881337]' 
                          : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:border-white/20'
                        }`}
                      >
                        {webrtc.screenStream ? 'STOP SHARING' : 'SHARE A CINEMA TAB'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-8">
                    {webrtc.remoteScreenStream ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex items-center gap-3 px-6 py-2 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-500 text-[10px] font-black uppercase tracking-widest animate-pulse">
                          <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]"></span>
                          Watching Partner's Screen
                        </div>
                        <p className="text-[9px] font-bold text-[#33334A] uppercase tracking-widest">Everything is perfectly synced by magic</p>
                      </div>
                    ) : (
                      <button onClick={handleForceSync} className="pill-button bg-white/5 border border-white/10 px-12 text-[10px] font-black tracking-[0.2em]">🔄 FORCE SYNC</button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {showSidebar && (
              <div className="w-full lg:w-[400px] flex flex-col gap-6 h-[850px] animate-in fade-in slide-in-from-right-10 duration-500">
                <PresenceList 
                  members={roomSync.members} 
                  onlineUsers={roomSync.onlineUsers} 
                  isHost={roomSync.isHost} 
                  onTransfer={() => setShowTransferModal(true)} 
                />
                
                <div className="bg-[#0D0D12] backdrop-blur-2xl border border-[#881337]/30 rounded-[22px] min-h-[340px] shadow-2xl overflow-hidden">
                  <CallOverlay 
                    {...webrtc} 
                    localVideoRef={localVideoRef} 
                    remoteVideoRef={remoteVideoRef} 
                    members={roomSync.members} 
                    user={user} 
                    profile={roomSync.profile} 
                  />
                </div>

                <ChatSidebar 
                  {...chat} 
                  typingUsers={roomSync.typingUsers} 
                  sendReaction={sendReaction} 
                  callStatus={webrtc.callStatus}
                  startCall={webrtc.startCall}
                  toggleMute={webrtc.toggleMute}
                  toggleVideo={webrtc.toggleVideo}
                  isAudioMuted={webrtc.isAudioMuted}
                  isVideoEnabled={webrtc.isVideoEnabled}
                  user={user}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* Global Toast Notification */}
      <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />

      {/* Host Transfer Confirmation Modal */}
      <ConfirmModal
        isOpen={showTransferModal}
        title="Transfer Host Control"
        description={`Are you sure you want to transfer host control to ${
          roomSync.members.find(m => m.user_id !== user?.id)?.profiles?.full_name || 'your partner'
        }? They will gain full playback control and you will become a room member.`}
        confirmLabel="Transfer"
        onConfirm={handleTransferHost}
        onCancel={() => setShowTransferModal(false)}
        loading={transferring}
      />
    </div>
  );
}
