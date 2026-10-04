import { useState, useRef, useEffect, useCallback } from "react";

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

  const [iceServers] = useState([
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "stun:openrelay.metered.ca:80" },
    {
      urls: "turns:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:80?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ]);

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

  const boostAudioInSDP = useCallback((sdp) => {
    if (!sdp || typeof sdp !== "string") return sdp;
    if (sdp.includes("maxaveragebitrate=128000")) return sdp;
    const lines = sdp.split("\r\n");
    const opusLine = lines.find(l => l.includes("a=rtpmap:") && l.toLowerCase().includes("opus/48000"));
    if (!opusLine) return sdp;
    const match = opusLine.match(/a=rtpmap:(\d+)/);
    if (!match) return sdp;
    const pt = match[1];
    return lines.map(line => {
      if (line.startsWith(`a=fmtp:${pt}`)) {
        const cleanLine = line
          .replace(/;?stereo=\d+/g, "")
          .replace(/;?sprop-stereo=\d+/g, "")
          .replace(/;?maxaveragebitrate=\d+/g, "");
        return `${cleanLine};stereo=1;sprop-stereo=1;maxaveragebitrate=128000;useinbandfec=1`;
      }
      return line;
    }).join("\r\n");
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
      iceServers: iceServers,
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceCandidatePoolSize: 2
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
      const stream = event.streams[0] || new MediaStream([event.track]);
      if (isScreen) {
        safeSetState(setRemoteScreenStream, stream);
      } else {
        safeSetState(setRemoteStream, stream);
        safeSetState(setCallStatus, "CONNECTED");
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      addLog(`${isScreen ? 'Screen' : 'Media'} ICE state: ${state}`);
      if (state === "failed" || state === "closed") {
        if (!isScreen) fullReset();
        else safeSetState(setRemoteScreenStream, null);
      }
    };

    if (isScreen) pcScreenRef.current = pc;
    else pcRef.current = pc;

    return pc;
  }, [user, channelRef, addLog, fullReset, safeSetState, iceServers]);

  const startCall = useCallback(async (type) => {
    if (!channelRef.current || !user) {
      addLog("Cannot start call: Supabase channel not connected or user missing");
      return;
    }
    fullReset();
    
    addLog(`Starting low-latency ${type} call...`);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : false
      });
      localStreamRef.current = stream;
      safeSetState(setLocalStream, stream);
      safeSetState(setCallType, type);
      safeSetState(setCallStatus, "OUTGOING");
      safeSetState(setIsVideoEnabled, type === 'video');

      const pc = createPeerConnection(false);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const boostedSdp = boostAudioInSDP(offer.sdp);
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
  }, [user, channelRef, createPeerConnection, addLog, fullReset, safeSetState, boostAudioInSDP]);

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

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Set bitrate limits on negotiated sender
      pc.getSenders().forEach(sender => {
        if (sender.track?.kind === 'video') {
          try {
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 2500000;
            params.encodings[0].priority = "high";
            params.degradationPreference = 'maintain-resolution';
            sender.setParameters(params).catch(() => {});
          } catch {}
        } else if (sender.track?.kind === 'audio') {
          try {
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 128000;
            sender.setParameters(params).catch(() => {});
          } catch {}
        }
      });

      const boostedSdp = boostAudioInSDP(offer.sdp);
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
  }, [user, channelRef, createPeerConnection, addLog, cleanupPC, safeSetState, stopScreenShare, boostAudioInSDP]);

  const joinIncomingCall = useCallback(async () => {
    if (!pendingOffer || !channelRef.current || !user) return;
    const { sdp, incomingType, isScreen } = pendingOffer;
    safeSetState(setPendingOffer, null);

    try {
      let pc = isScreen ? pcScreenRef.current : pcRef.current;
      if (!pc) pc = createPeerConnection(isScreen);
      
      if (!isScreen) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: incomingType === 'video' });
        localStreamRef.current = stream;
        safeSetState(setLocalStream, stream);
        safeSetState(setCallType, incomingType);
        safeSetState(setCallStatus, "CONNECTED");
        safeSetState(setIsVideoEnabled, incomingType === 'video');
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
      }

      const rawSdp = typeof sdp === 'string' ? sdp : sdp?.sdp;
      if (!rawSdp) throw new Error("Empty SDP in offer");
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: rawSdp }));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      const boostedAnswer = boostAudioInSDP(answer.sdp);
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

      const queue = isScreen ? iceScreenQueue : iceQueue;
      while (queue.current.length > 0) {
        const cand = queue.current.shift();
        if (cand && cand.candidate) try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch { /* ignore */ }
      }
    } catch (err) {
      addLog(`Join Call Error: ${err.message}`);
      if (!isScreen) fullReset();
    }
  }, [pendingOffer, user, channelRef, createPeerConnection, addLog, fullReset, safeSetState, boostAudioInSDP]);

  const handleWebRTCSignal = useCallback(async (payload) => {
    const { type, sdp, candidate, senderId, callType: incomingType, isScreen } = payload;
    if (!user || senderId === user.id) return;

    const pc = isScreen ? pcScreenRef.current : pcRef.current;
    const queue = isScreen ? iceScreenQueue : iceQueue;

    try {
      if (type === "offer") {
        queue.current = [];
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
  }, [user, fullReset, cleanupPC, addLog, safeSetState]);

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
