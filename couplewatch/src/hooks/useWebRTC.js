import { useState, useRef, useEffect, useCallback } from "react";

export function useWebRTC(user, channelRef) {
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
        console.error("Error stopping track:", e);
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
          console.error("Error closing peer connection:", e);
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
        { urls: "stun:stun4.l.google.com:19302" }
      ],
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require"
    });
    
    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        channelRef.current.send({ 
          type: "broadcast", 
          event: "webrtc-signal", 
          payload: { 
            type: "candidate", 
            candidate: event.candidate, 
            senderId: user.id,
            isScreen
          } 
        });
      }
    };

    pc.ontrack = (event) => { 
      console.log(`${isScreen ? 'Screen' : 'Camera'} track received`);
      const incomingStream = event.streams[0];
      
      const updateStream = (prev) => {
        // Create new stream or use existing
        const stream = prev || new MediaStream();
        const tracks = incomingStream ? incomingStream.getTracks() : [event.track];
        
        tracks.forEach(t => {
          if (!stream.getTracks().find(existing => existing.id === t.id)) {
            stream.addTrack(t);
          }
        });

        if (!isScreen && !prev) setCallStatus("CONNECTED");
        
        // Always return a NEW MediaStream to force React to update the video element srcObject
        const newStream = new MediaStream(stream.getTracks());
        return newStream;
      };

      if (isScreen) setRemoteScreenStream(updateStream);
      else setRemoteStream(updateStream);
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`${isScreen ? 'Screen' : 'Camera'} ICE state:`, pc.iceConnectionState);
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
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
    
    // 1. Prioritize H264 for hardware acceleration smoothness
    const mVideoIndex = lines.findIndex(line => line.startsWith('m=video'));
    if (mVideoIndex !== -1) {
      const parts = lines[mVideoIndex].split(' ');
      const payloadTypes = parts.slice(3);
      const h264Types = [];
      lines.forEach(line => {
        if (line.startsWith('a=rtpmap:') && line.toLowerCase().includes('h264')) {
          const match = line.match(/a=rtpmap:(\d+)/);
          if (match) h264Types.push(match[1]);
        }
      });

      if (h264Types.length > 0) {
        const newPayloadTypes = [...h264Types, ...payloadTypes.filter(t => !h264Types.includes(t))];
        parts.splice(3, payloadTypes.length, ...newPayloadTypes);
        lines[mVideoIndex] = parts.join(' ');
      }
    }

    // 2. Add Bitrate and Quality flags
    let newSdp = lines.join('\r\n');
    if (isScreen) {
      newSdp = newSdp.replace(/b=AS:([0-9]+)/g, 'b=AS:15000');
      newSdp = newSdp.replace(/b=TIAS:([0-9]+)/g, 'b=TIAS:15000000');
      if (!newSdp.includes('b=AS:')) {
        newSdp = newSdp.replace(/a=mid:video/g, 'a=mid:video\r\nb=AS:15000\r\nb=TIAS:15000000');
      }
      // Chrome-specific flags for instant high quality and stability
      newSdp = newSdp.replace(/a=fmtp:(.*)/g, 'a=fmtp:$1;x-google-min-bitrate=8000;x-google-max-bitrate=15000;x-google-start-bitrate=12000;googLowDelayAudio=true;googHighStartBitrate=true');
    }
    
    return newSdp;
  };

  const startCall = useCallback(async (type) => {
    if (!channelRef.current || !user || isStoppingRef.current) return;
    console.log("Starting call:", type);
    try {
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
      console.error("Start Call Error (getUserMedia):", err); 
      alert("Could not access camera/microphone. Please check permissions ❤️");
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

    console.log("Starting screen share");
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
      console.error("Screen Share Error:", err);
      return null;
    }
  }, [user, channelRef, createPeerConnection, stopScreenShare]);

  const joinIncomingCall = useCallback(async () => {
    if (!pendingOffer || !channelRef.current || !user || isStoppingRef.current) return;
    const type = pendingOffer.incomingType;
    const sdpOffer = pendingOffer.sdp;
    setPendingOffer(null); // Clear immediately to avoid loops
    const isScreen = type === 'screen';
    console.log(`Joining incoming ${isScreen ? 'screen' : 'call'}:`, type);
    
    try {
      let stream = null;
      if (!isScreen) {
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
      console.error("Join Call Error:", err); 
      if (!isScreen) {
        alert("Could not access camera/microphone. Please check permissions ❤️");
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

        console.log(`Received ${isScreen ? 'screen' : 'camera'} offer from:`, senderId);
        setPendingOffer({ sdp, incomingType: isScreen ? 'screen' : incomingType }); 
        if (!isScreen) setCallStatus("INCOMING"); 
      } else if (type === "answer") {
        console.log(`Received ${isScreen ? 'screen' : 'camera'} answer from:`, senderId);
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
        if (pcRef.current && pcRef.current.remoteDescription) {
          try {
            await pcRef.current.addIceCandidate(iceCandidate);
          } catch (e) {
            console.warn("ICE candidate error:", e);
          }
        } else {
          queue.current.push(candidate);
        }
      } else if (type === "hangup") {
        console.log("Received hangup from:", senderId);
        endCall(false);
      } else if (type === "stop-screen") {
        console.log("Partner stopped screen share");
        setRemoteScreenStream(null);
        if (peerConnectionScreenRef.current) {
          peerConnectionScreenRef.current.close();
          peerConnectionScreenRef.current = null;
        }
      }
    } catch (err) {
      console.error("Signal Handling Error:", err);
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
        console.log("Re-broadcasting existing stable screen offer");
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
    if (pendingOffer && pendingOffer.incomingType === 'screen') {
      joinIncomingCall();
    }
  }, [pendingOffer, joinIncomingCall]);

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
