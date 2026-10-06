import { useState, useRef, useEffect, useCallback } from "react";

const DEFAULT_ICE_SERVERS = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
      "stun:stun3.l.google.com:19302",
      "stun:stun4.l.google.com:19302"
    ]
  },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:relay.metered.ca:80" }
];

const CF_CACHE_KEY = "couplewatch_cf_turn_v1";

const CAMERA_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000
};

const CAMERA_VIDEO_CONSTRAINTS = {
  width: { ideal: 640, max: 1280 },
  height: { ideal: 480, max: 720 },
  frameRate: { ideal: 30, max: 30 },
  facingMode: "user"
};

function getCachedIceServers() {
  try {
    const cached = sessionStorage.getItem(CF_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.expiry > Date.now() && Array.isArray(parsed.servers) && parsed.servers.length > 0) {
        return [...DEFAULT_ICE_SERVERS, ...parsed.servers];
      }
    }
  } catch {}
  return DEFAULT_ICE_SERVERS;
}

export function useWebRTC(user, channelRef, addLog = console.log) {
  const [callStatus, setCallStatus] = useState("IDLE"); // IDLE | OUTGOING | INCOMING | CONNECTED
  const [callType, setCallType] = useState(null); // 'audio' | 'video'
  const [remoteStream, setRemoteStream] = useState(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [pendingOffer, setPendingOffer] = useState(null);
  const [peerStatus] = useState("READY");
  const [iceServers, setIceServers] = useState(() => getCachedIceServers());
  const iceServersRef = useRef(iceServers);

  useEffect(() => {
    iceServersRef.current = iceServers;
  }, [iceServers]);

  useEffect(() => {
    // 1. Cloudflare Calls TURN (1,000 GB / 1 TB Free per month)
    const cfKeyId = import.meta.env.VITE_CLOUDFLARE_TURN_KEY_ID || "e8e9d1d82f230033986e60f2cc9ccece";
    const cfToken = import.meta.env.VITE_CLOUDFLARE_TURN_TOKEN || "f6cba962222de9db8c4404664bc42002d5e6e6866ea781c24e8e3ba6ff26ff55";

    if (cfKeyId && cfToken) {
      fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${cfKeyId}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cfToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ttl: 86400 })
      })
        .then((res) => res.json())
        .then((data) => {
          if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
            addLog("✅ Loaded Cloudflare Calls TURN relay (1,000 GB Free Tier active)");
            setIceServers([...DEFAULT_ICE_SERVERS, ...data.iceServers]);
            try {
              sessionStorage.setItem(CF_CACHE_KEY, JSON.stringify({
                expiry: Date.now() + 80000 * 1000,
                servers: data.iceServers
              }));
            } catch {}
          } else {
            addLog("⚠️ Cloudflare TURN response did not contain valid iceServers");
          }
        })
        .catch((err) => {
          addLog(`❌ Failed to load Cloudflare TURN: ${err.message}`);
        });
      return;
    }

    // 2. Custom Static TURN Credentials (e.g. self-hosted coTURN, Twilio, etc.)
    const staticTurnUrl = import.meta.env.VITE_TURN_URL;
    const staticUsername = import.meta.env.VITE_TURN_USERNAME;
    const staticCredential = import.meta.env.VITE_TURN_CREDENTIAL;

    if (staticTurnUrl && staticUsername && staticCredential) {
      const urls = staticTurnUrl.split(",").map((u) => u.trim());
      addLog(`✅ Loaded custom static TURN servers (${urls.length})`);
      setIceServers([
        ...DEFAULT_ICE_SERVERS,
        { urls, username: staticUsername, credential: staticCredential }
      ]);
      return;
    }

    // 3. Metered Video credentials (fallback)
    let meteredEndpoint = import.meta.env.VITE_METERED_ENDPOINT;
    const appName = import.meta.env.VITE_METERED_APP_NAME;
    const apiKey = import.meta.env.VITE_METERED_API_KEY;

    if (!meteredEndpoint && appName && apiKey) {
      meteredEndpoint = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`;
    }

    if (meteredEndpoint) {
      fetch(meteredEndpoint)
        .then((res) => res.json())
        .then((servers) => {
          if (Array.isArray(servers) && servers.length > 0) {
            addLog(`✅ Loaded ${servers.length} verified TURN relay servers from Metered Video`);
            setIceServers([...DEFAULT_ICE_SERVERS, ...servers]);
          } else {
            addLog("⚠️ Metered API returned empty or invalid server list");
          }
        })
        .catch((err) => {
          addLog(`❌ Could not load Metered TURN credentials: ${err.message}`);
        });
      return;
    }

    addLog("ℹ️ Running in STUN-only mode. For campus or strict Wi-Fi, configure Cloudflare Calls (1 TB free) in .env");
  }, [addLog]);

  const pcRef = useRef(null);
  const pcScreenRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  
  const iceQueue = useRef([]);
  const iceScreenQueue = useRef([]);
  const isMountedRef = useRef(true);

  const safeSetState = useCallback((setter, value) => {
    if (isMountedRef.current) {
      setter(value);
    }
  }, []);

  const optimizeSDP = useCallback((sdp, isScreen = false) => {
    if (!sdp || typeof sdp !== "string") return sdp;
    let modified = sdp;
    const lines = modified.split("\r\n");
    const opusLine = lines.find(l => l.includes("a=rtpmap:") && l.toLowerCase().includes("opus/48000"));
    if (opusLine) {
      const match = opusLine.match(/a=rtpmap:(\d+)/);
      if (match) {
        const pt = match[1];
        modified = lines.map(line => {
          if (line.startsWith(`a=fmtp:${pt}`)) {
            const cleanLine = line
              .replace(/;?stereo=\d+/g, "")
              .replace(/;?sprop-stereo=\d+/g, "")
              .replace(/;?maxaveragebitrate=\d+/g, "");
            return `${cleanLine};stereo=1;sprop-stereo=1;maxaveragebitrate=64000;useinbandfec=1`;
          }
          return line;
        }).join("\r\n");
      }
    }

    if (!isScreen) {
      if (!modified.includes("b=AS:") && !modified.includes("b=TIAS:")) {
        modified = modified.replace(/(m=video[^\r\n]*\r\n)/, "$1b=AS:1000\r\n");
      }
    } else {
      if (!modified.includes("b=AS:") && !modified.includes("b=TIAS:")) {
        modified = modified.replace(/(m=video[^\r\n]*\r\n)/, "$1b=AS:2500\r\n");
      }
    }
    return modified;
  }, []);

  const configureSenders = useCallback((pc, isScreen = false) => {
    if (!pc) return;
    try {
      pc.getSenders().forEach((sender) => {
        if (sender.track?.kind === "video") {
          try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
              params.encodings = [{}];
            }
            if (isScreen) {
              params.encodings[0].maxBitrate = 2500000;
              params.encodings[0].maxFramerate = 30;
              params.encodings[0].priority = "high";
              params.encodings[0].networkPriority = "high";
              params.degradationPreference = "maintain-resolution";
            } else {
              // CAMERA VIDEO: Prioritize framerate to eliminate stutter and lagging
              params.encodings[0].maxBitrate = 850000; // 850 kbps
              params.encodings[0].maxFramerate = 30;
              params.encodings[0].priority = "high";
              params.encodings[0].networkPriority = "high";
              params.degradationPreference = "maintain-framerate";
            }
            sender.setParameters(params).catch(() => {});
          } catch {}
        } else if (sender.track?.kind === "audio") {
          try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
              params.encodings = [{}];
            }
            params.encodings[0].maxBitrate = 64000;
            params.encodings[0].priority = "high";
            sender.setParameters(params).catch(() => {});
          } catch {}
        }
      });
    } catch {}
  }, []);

  const setHardwareCodecPreferences = useCallback((pc) => {
    if (!pc || !window.RTCRtpReceiver?.getCapabilities) return;
    try {
      const transceivers = pc.getTransceivers();
      transceivers.forEach((t) => {
        if (t.sender.track?.kind === "video" && typeof t.setCodecPreferences === "function") {
          const capabilities = RTCRtpReceiver.getCapabilities("video");
          if (capabilities && Array.isArray(capabilities.codecs)) {
            const h264 = capabilities.codecs.filter(c => c.mimeType.toLowerCase() === "video/h264");
            const others = capabilities.codecs.filter(c => c.mimeType.toLowerCase() !== "video/h264");
            if (h264.length > 0) {
              t.setCodecPreferences([...h264, ...others]);
            }
          }
        }
      });
    } catch {}
  }, []);

  const cleanupPC = useCallback((pc, isScreen = false) => {
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.oniceconnectionstatechange = null;
        pc.onnegotiationneeded = null;
        pc.close();
      } catch (e) {
        addLog(`Error closing ${isScreen ? 'screen' : 'media'} PC: ${e.message}`);
      }
    }
    if (isScreen) {
      pcScreenRef.current = null;
      safeSetState(setRemoteScreenStream, null);
    } else {
      pcRef.current = null;
      safeSetState(setRemoteStream, null);
      safeSetState(setCallStatus, "IDLE");
      safeSetState(setCallType, null);
    }
  }, [safeSetState, addLog]);

  const fullReset = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    cleanupPC(pcRef.current, false);
    cleanupPC(pcScreenRef.current, true);
    safeSetState(setLocalStream, null);
    safeSetState(setScreenStream, null);
    safeSetState(setPendingOffer, null);
    safeSetState(setIsVideoEnabled, false);
    safeSetState(setIsAudioMuted, false);
    iceQueue.current = [];
    iceScreenQueue.current = [];
  }, [cleanupPC, safeSetState]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      fullReset();
    };
  }, []); // Run on unmount only

  const createPeerConnection = useCallback((isScreen = false) => {
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require"
    });
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addLog(`${isScreen ? 'Screen' : 'Media'} ICE candidate: ${event.candidate.type || 'unknown'} (${event.candidate.protocol || 'udp'})`);
        if (channelRef.current && user) {
          const candJson = event.candidate.toJSON ? event.candidate.toJSON() : {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            usernameFragment: event.candidate.usernameFragment
          };
          channelRef.current.send({
            type: "broadcast",
            event: "webrtc-signal",
            payload: {
              type: "candidate",
              candidate: candJson,
              senderId: user.id,
              isScreen
            }
          });
        }
      }
    };

    pc.ontrack = (event) => {
      addLog(`${isScreen ? 'Screen' : 'Media'} track received: ${event.track.kind}`);
      
      // Minimize jitter buffer target delay for zero-lag real-time rendering
      if (event.receiver && 'jitterBufferTarget' in event.receiver) {
        try {
          event.receiver.jitterBufferTarget = 0.04;
        } catch {}
      }

      const stream = event.streams[0] || new MediaStream([event.track]);
      if (isScreen) {
        safeSetState(setRemoteScreenStream, stream);
      } else {
        safeSetState(setRemoteStream, stream);
        safeSetState(setCallStatus, "CONNECTED");
      }
    };

    let disconnectTimer = null;
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      addLog(`${isScreen ? 'Screen' : 'Media'} ICE state: ${state}`);

      if (state === "connected" || state === "completed") {
        if (disconnectTimer) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
      } else if (state === "disconnected") {
        if (!disconnectTimer) {
          disconnectTimer = setTimeout(() => {
            if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
              addLog(`${isScreen ? 'Screen' : 'Media'} ICE disconnected timeout`);
              if (!isScreen) fullReset();
              else safeSetState(setRemoteScreenStream, null);
            }
          }, 6000);
        }
      } else if (state === "failed") {
        addLog(`${isScreen ? 'Screen' : 'Media'} ICE failed: attempting recovery...`);
        if (typeof pc.restartIce === "function") {
          try {
            pc.restartIce();
          } catch (e) {
            addLog(`ICE restart error: ${e.message}`);
          }
        }
        if (!disconnectTimer) {
          disconnectTimer = setTimeout(() => {
            if (pc.iceConnectionState === "failed") {
              if (!isScreen) fullReset();
              else safeSetState(setRemoteScreenStream, null);
            }
          }, 5000);
        }
      } else if (state === "closed") {
        if (!isScreen) fullReset();
        else safeSetState(setRemoteScreenStream, null);
      }
    };

    if (isScreen) pcScreenRef.current = pc;
    else pcRef.current = pc;

    return pc;
  }, [user, channelRef, addLog, fullReset, safeSetState]);

  const startCall = useCallback(async (type) => {
    if (!channelRef.current || !user) {
      addLog("Cannot start call: Supabase channel not connected or user missing");
      return;
    }
    fullReset();
    
    addLog(`Starting low-latency ${type} call...`);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: CAMERA_AUDIO_CONSTRAINTS,
        video: type === 'video' ? CAMERA_VIDEO_CONSTRAINTS : false
      });
      localStreamRef.current = stream;
      safeSetState(setLocalStream, stream);
      safeSetState(setCallType, type);
      safeSetState(setCallStatus, "OUTGOING");
      safeSetState(setIsVideoEnabled, type === 'video');

      const pc = createPeerConnection(false);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      setHardwareCodecPreferences(pc);
      configureSenders(pc, false);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      configureSenders(pc, false);

      const boostedSdp = optimizeSDP(offer.sdp, false);
      channelRef.current.send({
        type: "broadcast",
        event: "webrtc-signal",
        payload: {
          type: "offer",
          sdp: { type: "offer", sdp: boostedSdp },
          senderId: user.id,
          callType: type,
          isScreen: false
        }
      });
      addLog(`Offer broadcasted for ${type} call`);
    } catch (err) {
      addLog(`Start Call Error: ${err.message}`);
      fullReset();
    }
  }, [user, channelRef, createPeerConnection, addLog, fullReset, safeSetState, optimizeSDP, setHardwareCodecPreferences, configureSenders]);

  const stopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    safeSetState(setScreenStream, null);
    cleanupPC(pcScreenRef.current, true);
    channelRef.current?.send({
      type: "broadcast",
      event: "webrtc-signal",
      payload: { type: "stop-screen", senderId: user?.id, isScreen: true }
    });
  }, [user, channelRef, cleanupPC, safeSetState]);

  const startScreenShare = useCallback(async () => {
    if (!channelRef.current || !user) {
      addLog("Cannot start screen share: Supabase channel not connected");
      return;
    }
    addLog("Starting HD screen share (30fps, 2.5Mbps)...");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, displaySurface: 'browser' },
        audio: { sampleRate: 48000, channelCount: 2 }
      });
      screenStreamRef.current = stream;
      safeSetState(setScreenStream, stream);

      const pc = createPeerConnection(true);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      setHardwareCodecPreferences(pc);
      configureSenders(pc, true);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      configureSenders(pc, true);

      const boostedSdp = optimizeSDP(offer.sdp, true);
      channelRef.current.send({
        type: "broadcast",
        event: "webrtc-signal",
        payload: {
          type: "offer",
          sdp: { type: "offer", sdp: boostedSdp },
          senderId: user.id,
          callType: 'screen',
          isScreen: true
        }
      });

      stream.getVideoTracks()[0].onended = () => stopScreenShare();
      addLog("Screen share offer broadcasted successfully");
    } catch (err) {
      addLog(`Screen Share Error: ${err.message}`);
      cleanupPC(pcScreenRef.current, true);
    }
  }, [user, channelRef, createPeerConnection, addLog, cleanupPC, safeSetState, stopScreenShare, optimizeSDP, setHardwareCodecPreferences, configureSenders]);

  const joinIncomingCall = useCallback(async () => {
    if (!pendingOffer || !channelRef.current || !user) return;
    const { sdp, incomingType, isScreen } = pendingOffer;
    safeSetState(setPendingOffer, null);

    try {
      let pc = isScreen ? pcScreenRef.current : pcRef.current;
      if (!pc) pc = createPeerConnection(isScreen);
      
      if (!isScreen) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: CAMERA_AUDIO_CONSTRAINTS,
          video: incomingType === 'video' ? CAMERA_VIDEO_CONSTRAINTS : false
        });
        localStreamRef.current = stream;
        safeSetState(setLocalStream, stream);
        safeSetState(setCallType, incomingType);
        safeSetState(setCallStatus, "CONNECTED");
        safeSetState(setIsVideoEnabled, incomingType === 'video');
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
      }

      setHardwareCodecPreferences(pc);
      configureSenders(pc, isScreen);

      const rawSdp = typeof sdp === 'string' ? sdp : sdp?.sdp;
      if (!rawSdp) throw new Error("Empty SDP in offer");
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: rawSdp }));

      // Drain queued candidates immediately after remote description is ready
      const queue = isScreen ? iceScreenQueue : iceQueue;
      while (queue.current.length > 0) {
        const cand = queue.current.shift();
        if (cand && cand.candidate) try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch { /* ignore */ }
      }
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      configureSenders(pc, isScreen);

      const boostedAnswer = optimizeSDP(answer.sdp, isScreen);
      channelRef.current.send({
        type: "broadcast",
        event: "webrtc-signal",
        payload: {
          type: "answer",
          sdp: { type: "answer", sdp: boostedAnswer },
          senderId: user.id,
          isScreen
        }
      });
    } catch (err) {
      addLog(`Join Call Error: ${err.message}`);
      if (!isScreen) fullReset();
    }
  }, [pendingOffer, user, channelRef, createPeerConnection, addLog, fullReset, safeSetState, optimizeSDP, setHardwareCodecPreferences, configureSenders]);

  const handleWebRTCSignal = useCallback(async (payload) => {
    const { type, sdp, candidate, senderId, callType: incomingType, isScreen } = payload;
    if (!user || senderId === user.id) return;

    const pc = isScreen ? pcScreenRef.current : pcRef.current;
    const queue = isScreen ? iceScreenQueue : iceQueue;

    try {
      if (type === "offer") {
        const rawSdp = typeof sdp === 'string' ? sdp : sdp?.sdp;
        if (!rawSdp) return;
        if (isScreen) {
          safeSetState(setPendingOffer, { sdp: rawSdp, incomingType: 'screen', isScreen: true });
        } else {
          safeSetState(setCallType, incomingType || 'video');
          safeSetState(setPendingOffer, { sdp: rawSdp, incomingType: incomingType || 'video', isScreen: false });
          safeSetState(setCallStatus, "INCOMING");
        }
      } else if (type === "answer") {
        if (pc) {
          const rawSdp = typeof sdp === 'string' ? sdp : sdp?.sdp;
          if (!rawSdp) return;
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: rawSdp }));
          if (!isScreen) {
            safeSetState(setCallStatus, "CONNECTED");
          }
          configureSenders(pc, isScreen);
          while (queue.current.length > 0) {
            const cand = queue.current.shift();
            if (cand && cand.candidate) try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch { /* ignore */ }
          }
        }
      } else if (type === "candidate") {
        if (!candidate || !candidate.candidate) return;
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            addLog(`Add Candidate Error: ${e.message}`);
          }
        } else {
          queue.current.push(candidate);
        }
      } else if (type === "hangup") {
        if (isScreen) cleanupPC(pcScreenRef.current, true);
        else fullReset();
      } else if (type === "stop-screen") {
        cleanupPC(pcScreenRef.current, true);
      }
    } catch (err) {
      addLog(`Signal Error [${type}]: ${err.message}`);
    }
  }, [user, fullReset, cleanupPC, addLog, safeSetState, configureSenders]);

  const endCall = useCallback((notify = true) => {
    if (notify && channelRef.current && user) {
      channelRef.current.send({
        type: "broadcast",
        event: "webrtc-signal",
        payload: { type: "hangup", senderId: user.id, isScreen: false }
      });
    }
    fullReset();
  }, [user, channelRef, fullReset]);

  useEffect(() => {
    if (pendingOffer && pendingOffer.isScreen) joinIncomingCall();
  }, [pendingOffer, joinIncomingCall]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        safeSetState(setIsAudioMuted, !audioTrack.enabled);
      }
    }
  }, [safeSetState]);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        safeSetState(setIsVideoEnabled, videoTrack.enabled);
      }
    }
  }, [safeSetState]);

  return {
    callStatus,
    callType,
    remoteStream,
    remoteScreenStream,
    localStream,
    screenStream,
    isAudioMuted,
    isVideoEnabled,
    peerStatus,
    startCall,
    startScreenShare,
    stopScreenShare,
    endCall,
    joinIncomingCall,
    handleWebRTCSignal,
    toggleMute,
    toggleVideo
  };
}
