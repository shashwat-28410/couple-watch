import { useState, useRef, useEffect, useCallback } from "react";

export function useWebRTC(user, channelRef, addLog = console.log) {
  const [callStatus, setCallStatus] = useState("IDLE");
  const [callType, setCallType] = useState(null);
  const [pendingOffer, setPendingOffer] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);

  const peerConnectionRef = useRef(null);
  const peerConnectionScreenRef = useRef(null);
  const localStreamRef = useRef(null);
  const localScreenStreamRef = useRef(null);
  const iceCandidatesQueue = useRef([]);
  const iceCandidatesScreenQueue = useRef([]);
  const isStoppingRef = useRef(false);

  const stopAllTracks = useCallback((stream) => {
    if (!stream) return;
    stream.getTracks().forEach(track => {
      try {
        track.stop();
        track.enabled = false;
      } catch (e) {
        addLog("Error stopping track:", e);
      }
    });
  }, []);

  const fullReset = useCallback(() => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    // Stop ALL local tracks
    [localStreamRef, localScreenStreamRef].forEach(ref => {
      if (ref.current) {
        stopAllTracks(ref.current);
        ref.current = null;
      }
    });

    // Close ALL peer connections
    [peerConnectionRef, peerConnectionScreenRef].forEach(ref => {
      if (ref.current) {
        ref.current.onicecandidate = null;
        ref.current.ontrack = null;
        ref.current.oniceconnectionstatechange = null;
        ref.current.onsignalingstatechange = null;
        try {
          ref.current.close();
        } catch (e) {
          addLog("Error closing peer connection:", e);
        }
        ref.current = null;
      }
    });

    // Reset ALL state
    setLocalStream(null);
    setRemoteStream(null); 
    setScreenStream(null);
    setRemoteScreenStream(null);
    setCallStatus("IDLE"); 
    setCallType(null); 
    setPendingOffer(null);
    iceCandidatesQueue.current = []; 
    iceCandidatesScreenQueue.current = [];
    setIsAudioMuted(false); 
    setIsVideoEnabled(false);
    
    setTimeout(() => {
      isStoppingRef.current = false;
    }, 500);
  }, [stopAllTracks]);

  const endCall = useCallback((sendSignal = true) => {
    if (isStoppingRef.current) return;
    
    if (sendSignal && channelRef.current && user) {
      channelRef.current.send({ 
        type: "broadcast", 
        event: "webrtc-signal", 
        payload: { type: "hangup", senderId: user.id } 
      });
    }

    // Manual endCall only resets the primary webcam call
    if (localStreamRef.current) { 
      stopAllTracks(localStreamRef.current);
      localStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    setLocalStream(null);
    setRemoteStream(null); 
    setCallStatus("IDLE"); 
    setCallType(null); 
    setPendingOffer(null);
    iceCandidatesQueue.current = []; 
    setIsAudioMuted(false); 
    setIsVideoEnabled(false);
  }, [user, channelRef, stopAllTracks]);

  // Cleanup on unmount ONLY
  const fullResetRef = useRef(fullReset);
  useEffect(() => { fullResetRef.current = fullReset; }, [fullReset]);

  useEffect(() => {
    return () => {
      fullResetRef.current();
    };
  }, []);

  const createPeerConnection = useCallback((isScreen = false) => {
    const pcRef = isScreen ? peerConnectionScreenRef : peerConnectionRef;
    
    // Re-use existing stable connection if possible
    if (pcRef.current && pcRef.current.signalingState !== 'closed' && pcRef.current.signalingState !== 'failed') {
      return pcRef.current;
    }

    const pc = new RTCPeerConnection({ 
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        // Use multiple free TURN server providers for redundancy
        {
          urls: [
            "turn:openrelay.metered.ca:443",
            "turn:openrelay.metered.ca:443?transport=tcp",
            "turn:openrelay.metered.ca:80",
            "turn:openrelay.metered.ca:80?transport=tcp",
          ],
          username: "openrelayproject",
          credential: "openrelayproject",
        },
        {
          urls: [
            "turn:global.turn.metered.ca:80",
            "turn:global.turn.metered.ca:80?transport=tcp",
            "turn:global.turn.metered.ca:443",
            "turn:global.turn.metered.ca:443?transport=tcp",
          ],
          username: "openrelayproject",
          credential: "openrelayproject",
        }
      ],
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceCandidatePoolSize: 10
    });

    // Queue for local candidates until local description is set
    pc.localCandidatesQueue = [];
    
    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        const cand = event.candidate.candidate;
        let type = "unknown";
        if (cand.includes("host")) type = "HOST";
        else if (cand.includes("srflx")) type = "STUN";
        else if (cand.includes("relay")) type = "TURN";
        
        addLog(`Gathered ${isScreen ? 'screen' : 'camera'} ICE candidate (${type}): ${event.candidate.candidate}`);

        const signal = { 
          type: "candidate", 
          candidate: event.candidate, 
          senderId: user.id,
          isScreen
        };

        if (pc.localDescription && pc.localDescription.type) {
          channelRef.current.send({ type: "broadcast", event: "webrtc-signal", payload: signal });
        } else {
          pc.localCandidatesQueue.push(signal);
        }
      }
    };

    pc.ontrack = (event) => { 
      addLog(`${isScreen ? 'Screen' : 'Camera'} track received: ${event.track.kind}`);
      
      // Ensure call status is updated regardless of which track (audio/video) arrives first
      if (!isScreen) {
        setCallStatus("CONNECTED");
      }

      const incomingStream = event.streams[0];
      const updateStream = (prev) => {
        const stream = prev || new MediaStream();
        const tracks = incomingStream ? incomingStream.getTracks() : [event.track];
        
        tracks.forEach(t => {
          if (!stream.getTracks().find(existing => existing.id === t.id)) {
            stream.addTrack(t);
          }
        });
        
        return new MediaStream(stream.getTracks());
      };

      if (isScreen) setRemoteScreenStream(updateStream);
      else setRemoteStream(updateStream);
    };

    const restartCall = async () => {
      addLog(`Attempting to restart ${isScreen ? 'screen' : 'camera'} call...`);
      if (isScreen) {
        if (localScreenStreamRef.current) await startScreenShare();
      } else {
        if (localStreamRef.current) await startCall(callType);
      }
    };

    pc.oniceconnectionstatechange = () => {
      addLog(`${isScreen ? 'Screen' : 'Camera'} ICE state: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === "failed") {
        restartCall();
      } else if (pc.iceConnectionState === "disconnected") {
        // Disconnected might be temporary, but if it stays, we might want to restart
        setTimeout(() => {
          if (pc.iceConnectionState === "disconnected") restartCall();
        }, 5000);
      } else if (pc.iceConnectionState === "closed") {
        if (!isStoppingRef.current && !isScreen) endCall(false);
        else if (isScreen) {
          setRemoteScreenStream(null);
          if (peerConnectionScreenRef.current === pc) peerConnectionScreenRef.current = null;
        }
      }
    };

    pcRef.current = pc;
    return pc;
  }, [user, channelRef, endCall]);

  const optimizeSDP = (sdp, isScreen = false) => {
    let lines = sdp.split('\r\n');
    
    // 1. Prioritize Opus for Audio
    const mAudioIndex = lines.findIndex(line => line.startsWith('m=audio'));
    if (mAudioIndex !== -1) {
      const parts = lines[mAudioIndex].split(' ');
      const opusType = lines.find(l => l.includes('a=rtpmap:') && l.toLowerCase().includes('opus'))?.match(/a=rtpmap:(\d+)/)?.[1];
      if (opusType) {
        const payloadTypes = parts.slice(3);
        const newPayloadTypes = [opusType, ...payloadTypes.filter(t => t !== opusType)];
        parts.splice(3, payloadTypes.length, ...newPayloadTypes);
        lines[mAudioIndex] = parts.join(' ');
      }
    }

    // 2. Prioritize H264 for Video
    const mVideoIndex = lines.findIndex(line => line.startsWith('m=video'));
    if (mVideoIndex !== -1) {
      const parts = lines[mVideoIndex].split(' ');
      const h264Types = lines.filter(l => l.includes('a=rtpmap:') && l.toLowerCase().includes('h264'))
                            .map(l => l.match(/a=rtpmap:(\d+)/)?.[1])
                            .filter(Boolean);

      if (h264Types.length > 0) {
        const payloadTypes = parts.slice(3);
        const newPayloadTypes = [...h264Types, ...payloadTypes.filter(t => !h264Types.includes(t))];
        parts.splice(3, payloadTypes.length, ...newPayloadTypes);
        lines[mVideoIndex] = parts.join(' ');
      }
    }

    let newSdp = lines.join('\r\n');
    
    // 3. Add Bitrate flags for Screen Share or High Quality Video
    if (!newSdp.includes('b=AS:')) {
      const bitrate = isScreen ? '5000' : '2000';
      newSdp = newSdp.replace(/a=mid:video/g, `a=mid:video\r\nb=AS:${bitrate}\r\nb=TIAS:${bitrate}000`);
    }
    
    return newSdp;
  };

  const startCall = useCallback(async (type) => {
    if (!channelRef.current || !user || isStoppingRef.current) return;
    addLog(`Starting call: ${type}`);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Your browser does not support camera/microphone access. Please ensure you are on HTTPS.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: type === 'video'
      });
      localStreamRef.current = stream;
      setLocalStream(stream); 
      setCallType(type); 
      setCallStatus("OUTGOING");
      if (type === 'video') setIsVideoEnabled(true);

      const pc = createPeerConnection(false);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Flush queued candidates
      if (pc.localCandidatesQueue) {
        pc.localCandidatesQueue.forEach(sig => {
          channelRef.current.send({ type: "broadcast", event: "webrtc-signal", payload: sig });
        });
        pc.localCandidatesQueue = [];
      }

      channelRef.current.send({ 
        type: "broadcast", 
        event: "webrtc-signal", 
        payload: { 
          type: "offer", 
          sdp: offer, 
          senderId: user.id, 
          callType: type 
        } 
      });
    } catch (err) { 
      addLog(`Start Call Error: ${err.message}`);
 
      alert(err.name === 'NotAllowedError' 
        ? "Camera/Microphone permission was denied. Please allow access in your browser settings ❤️" 
        : `Error: ${err.message}`
      );
      endCall(false);
    }
  }, [user, channelRef, createPeerConnection, endCall]);

  const stopScreenShare = useCallback(() => {
    if (localScreenStreamRef.current) {
      stopAllTracks(localScreenStreamRef.current);
      localScreenStreamRef.current = null;
    }
    setScreenStream(null);
    if (peerConnectionScreenRef.current) {
      peerConnectionScreenRef.current.close();
      peerConnectionScreenRef.current = null;
    }
    channelRef.current?.send({ 
      type: "broadcast", 
      event: "webrtc-signal", 
      payload: { type: "stop-screen", senderId: user.id } 
    });
  }, [user, channelRef, stopAllTracks]);

  const startScreenShare = useCallback(async () => {
    if (!channelRef.current || !user || isStoppingRef.current) return;
    
    // If already sharing, just return the existing stream
    if (localScreenStreamRef.current) return localScreenStreamRef.current;

    addLog("Starting screen share");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { 
          cursor: "always",
          displaySurface: "browser",
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 60, max: 60 }
        },
        audio: {
          echoCancellation: false, // Better movie audio quality
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2
        }
      });

      // Optimize for motion (smooth frame rate for movies)
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && 'contentHint' in videoTrack) {
        videoTrack.contentHint = 'motion';
      }

      localScreenStreamRef.current = stream;
      setScreenStream(stream);
      
      const pc = createPeerConnection(true);
      
      // Add tracks and set sender parameters for max quality
      for (const track of stream.getTracks()) {
        const sender = pc.addTrack(track, stream);
        if (track.kind === 'video') {
          try {
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 15000000; // 15 Mbps
            params.encodings[0].maxFramerate = 60;
            params.encodings[0].networkPriority = 'high';
            sender.setParameters(params);
            
            if ('degradationPreference' in sender) {
              sender.degradationPreference = 'maintain-framerate'; // Prioritize smoothness
            }
          } catch (e) {
            console.warn("Could not set sender parameters:", e);
          }
        }
      }

      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });

      const sdp = optimizeSDP(offer.sdp, true);
      const finalizedOffer = { type: 'offer', sdp };
      await pc.setLocalDescription(finalizedOffer);

      // Flush queued candidates
      if (pc.localCandidatesQueue) {
        pc.localCandidatesQueue.forEach(sig => {
          channelRef.current.send({ type: "broadcast", event: "webrtc-signal", payload: sig });
        });
        pc.localCandidatesQueue = [];
      }

      channelRef.current.send({ 
        type: "broadcast", 
        event: "webrtc-signal", 
        payload: { 
          type: "offer", 
          sdp: finalizedOffer, 
          senderId: user.id, 
          callType: 'screen' 
        } 
      });

      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
      
      return stream;
    } catch (err) {
      addLog("Screen Share Error:", err);
      return null;
    }
  }, [user, channelRef, createPeerConnection, stopScreenShare]);

  const joinIncomingCall = useCallback(async () => {
    if (!pendingOffer || !channelRef.current || !user || isStoppingRef.current) return;
    const type = pendingOffer.incomingType;
    const sdpOffer = pendingOffer.sdp;
    setPendingOffer(null); // Clear immediately to avoid loops
    const isScreen = type === 'screen';
    addLog(`Joining incoming ${isScreen ? 'screen' : 'call'}: ${type}`);
    try {
      let stream = null;
      if (!isScreen) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Your browser does not support camera/microphone access. Please ensure you are on HTTPS.");
        }
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: true, 
          video: type === 'video'
        });
        localStreamRef.current = stream;
        setLocalStream(stream); 
        setCallType(type); 
        setCallStatus("CONNECTED");
        if (type === 'video') setIsVideoEnabled(true);
      }

      const pc = createPeerConnection(isScreen);
      if (stream) {
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdpOffer));
      const answer = await pc.createAnswer();
      
      const sdp = optimizeSDP(answer.sdp, isScreen);
      const finalizedAnswer = { type: 'answer', sdp };
      await pc.setLocalDescription(finalizedAnswer);

      // Flush queued candidates
      if (pc.localCandidatesQueue) {
        pc.localCandidatesQueue.forEach(sig => {
          channelRef.current.send({ type: "broadcast", event: "webrtc-signal", payload: sig });
        });
        pc.localCandidatesQueue = [];
      }

      channelRef.current.send({ 
        type: "broadcast", 
        event: "webrtc-signal", 
        payload: { 
          type: "answer", 
          sdp: finalizedAnswer, 
          senderId: user.id,
          isScreen
        } 
      });

      const queue = isScreen ? iceCandidatesScreenQueue : iceCandidatesQueue;
      while (queue.current.length > 0) {
        const cand = queue.current.shift();
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn("Error adding queued ICE candidate", e);
        }
      }
    } catch (err) { 
      addLog(`Join Call Error: ${err.message}`);
 
      if (!isScreen) {
        alert(err.name === 'NotAllowedError' 
          ? "Camera/Microphone permission was denied. Please allow access in your browser settings ❤️" 
          : `Error: ${err.message}`
        );
        endCall(false);
      }
    }
  }, [pendingOffer, channelRef, user, createPeerConnection, endCall]);

  const handleWebRTCSignal = useCallback(async (payload) => {
    const { type, sdp, candidate, senderId, callType: incomingType, isScreen: isSignalScreen } = payload;
    if (!user || senderId === user.id) return;

    // Determine if this signal belongs to a screen share
    const isScreen = incomingType === 'screen' || isSignalScreen === true;
    const pcRef = isScreen ? peerConnectionScreenRef : peerConnectionRef;
    const queue = isScreen ? iceCandidatesScreenQueue : iceCandidatesQueue;

    try {
      if (type === "offer") { 
        // CRITICAL: If already connected to this stream, ignore redundant offers
        const hasStream = isScreen ? !!remoteScreenStream : !!remoteStream;
        if (hasStream && pcRef.current?.signalingState === 'stable') {
          return;
        }

        addLog(`Received ${isScreen ? 'screen' : 'camera'} offer from: ${senderId}`);
        setPendingOffer({ sdp, incomingType: isScreen ? 'screen' : incomingType }); 
        if (!isScreen) setCallStatus("INCOMING"); 
      } else if (type === "answer") {
        addLog(`Received ${isScreen ? 'screen' : 'camera'} answer from: ${senderId}`);
        if (pcRef.current) {
          if (pcRef.current.signalingState !== "stable") {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
            while (queue.current.length > 0) {
              const cand = queue.current.shift();
              try {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
              } catch (e) {
                console.warn("ICE candidate error after answer:", e);
              }
            }
          }
        }
      } else if (type === "candidate") {
        const iceCandidate = new RTCIceCandidate(candidate);
        // Ensure we route to correct PC based on signal
        const targetPc = isSignalScreen ? peerConnectionScreenRef.current : peerConnectionRef.current;
        const targetQueue = isSignalScreen ? iceCandidatesScreenQueue : iceCandidatesQueue;

        if (targetPc && targetPc.remoteDescription) {
          try {
            await targetPc.addIceCandidate(iceCandidate);
          } catch (e) {
            console.warn(`ICE candidate error (${isSignalScreen ? 'screen' : 'camera'}):`, e);
          }
        } else {
          targetQueue.current.push(candidate);
        }
      } else if (type === "hangup") {
        addLog(`Received hangup from: ${senderId}`);
        endCall(false);
      } else if (type === "stop-screen") {
        addLog("Partner stopped screen share");
        setRemoteScreenStream(null);
        if (peerConnectionScreenRef.current) {
          peerConnectionScreenRef.current.close();
          peerConnectionScreenRef.current = null;
        }
      }
    } catch (err) {
      addLog("Signal Handling Error:", err);
    }
  }, [user, endCall, remoteStream, remoteScreenStream]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const reBroadcastScreenOffer = useCallback(async () => {
    if (localScreenStreamRef.current && channelRef.current && user) {
      const pc = peerConnectionScreenRef.current;
      
      // If we already have a stable connection and a local description, just re-send it
      // to avoid resetting the stream for existing viewers.
      if (pc && pc.signalingState === 'stable' && pc.localDescription) {
        addLog("Re-broadcasting existing stable screen offer");
        channelRef.current.send({ 
          type: "broadcast", 
          event: "webrtc-signal", 
          payload: { 
            type: "offer", 
            sdp: pc.localDescription, 
            senderId: user.id, 
            callType: 'screen' 
          } 
        });
        return;
      }

      // ONLY if we don't have a stable connection, create a new one
      const newPc = createPeerConnection(true);
      
      // Add tracks (only if they aren't already there)
      const currentTracks = newPc.getSenders().map(s => s.track);
      for (const track of localScreenStreamRef.current.getTracks()) {
        if (!currentTracks.includes(track)) {
          newPc.addTrack(track, localScreenStreamRef.current);
        }
      }

      const offer = await newPc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });

      const sdp = optimizeSDP(offer.sdp, true);
      const finalizedOffer = { type: 'offer', sdp };
      await newPc.setLocalDescription(finalizedOffer);

      // Flush queued candidates
      if (newPc.localCandidatesQueue) {
        newPc.localCandidatesQueue.forEach(sig => {
          channelRef.current.send({ type: "broadcast", event: "webrtc-signal", payload: sig });
        });
        newPc.localCandidatesQueue = [];
      }

      channelRef.current.send({ 
        type: "broadcast", 
        event: "webrtc-signal", 
        payload: { 
          type: "offer", 
          sdp: finalizedOffer, 
          senderId: user.id, 
          callType: 'screen' 
        } 
      });
    }
  }, [user, channelRef, createPeerConnection]);

  // Auto-join screen share offers when they arrive
  useEffect(() => {
    if (pendingOffer && pendingOffer.incomingType === 'screen' && !remoteScreenStream) {
      joinIncomingCall();
    }
  }, [pendingOffer, joinIncomingCall, remoteScreenStream]);

  return {
    callStatus,
    callType,
    remoteStream,
    remoteScreenStream,
    localStream,
    screenStream,
    isAudioMuted,
    isVideoEnabled,
    pendingOffer,
    startCall,
    startScreenShare,
    reBroadcastScreenOffer,
    stopScreenShare,
    endCall,
    joinIncomingCall,
    handleWebRTCSignal,
    fullReset,
    toggleMute,
    toggleVideo
  };
}
