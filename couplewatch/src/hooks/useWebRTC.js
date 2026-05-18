import { useState, useRef, useEffect, useCallback } from "react";

export function useWebRTC(user, channelRef) {
  const [callStatus, setCallStatus] = useState("IDLE");
  const [callType, setCallType] = useState(null);
  const [pendingOffer, setPendingOffer] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);

  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const iceCandidatesQueue = useRef([]);
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

  const endCall = useCallback((sendSignal = true) => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    if (sendSignal && channelRef.current && user) {
      channelRef.current.send({ 
        type: "broadcast", 
        event: "webrtc-signal", 
        payload: { type: "hangup", senderId: user.id } 
      });
    }

    // Stop ALL local tracks from ref only to avoid dependency loops
    if (localStreamRef.current) { 
      stopAllTracks(localStreamRef.current);
      localStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.oniceconnectionstatechange = null;
      peerConnectionRef.current.onsignalingstatechange = null;
      try {
        peerConnectionRef.current.close();
      } catch (e) {
        console.error("Error closing peer connection:", e);
      }
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
    
    setTimeout(() => {
      isStoppingRef.current = false;
    }, 800);
  }, [user, channelRef, stopAllTracks]); // Removed localStream from deps

  // Cleanup on unmount ONLY
  const endCallRef = useRef(endCall);
  useEffect(() => { endCallRef.current = endCall; }, [endCall]);

  useEffect(() => {
    return () => {
      endCallRef.current(false);
    };
  }, []); // Empty deps to only run on unmount

  const createPeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    const pc = new RTCPeerConnection({ 
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" }
      ] 
    });
    
    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        channelRef.current.send({ 
          type: "broadcast", 
          event: "webrtc-signal", 
          payload: { 
            type: "candidate", 
            candidate: event.candidate, 
            senderId: user.id 
          } 
        });
      }
    };

    pc.ontrack = (event) => { 
      console.log("Track received:", event.streams[0]);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]); 
        setCallStatus("CONNECTED"); 
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE state:", pc.iceConnectionState);
      if (pc.iceConnectionState === "disconnected" || 
          pc.iceConnectionState === "failed" || 
          pc.iceConnectionState === "closed") {
        if (!isStoppingRef.current) endCall(false);
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  }, [user, channelRef, endCall]);

  const startCall = async (type) => {
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

      const pc = createPeerConnection();
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
  };

  const joinIncomingCall = async () => {
    if (!pendingOffer || !channelRef.current || !user || isStoppingRef.current) return;
    const type = pendingOffer.incomingType;
    console.log("Joining incoming call:", type);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: type === 'video'
      });
      localStreamRef.current = stream;
      setLocalStream(stream); 
      setCallType(type); 
      setCallStatus("CONNECTED");
      if (type === 'video') setIsVideoEnabled(true);

      const pc = createPeerConnection();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      channelRef.current.send({ 
        type: "broadcast", 
        event: "webrtc-signal", 
        payload: { 
          type: "answer", 
          sdp: answer, 
          senderId: user.id 
        } 
      });

      // Process queued candidates
      while (iceCandidatesQueue.current.length > 0) {
        const cand = iceCandidatesQueue.current.shift();
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn("Error adding queued ICE candidate", e);
        }
      }
    } catch (err) { 
      console.error("Join Call Error (getUserMedia):", err); 
      alert("Could not access camera/microphone. Please check permissions ❤️");
      endCall(false);
    }
  };

  const handleWebRTCSignal = useCallback(async (payload) => {
    const { type, sdp, candidate, senderId, callType: incomingType } = payload;
    if (!user || senderId === user.id) return;

    try {
      if (type === "offer") { 
        console.log("Received offer from:", senderId);
        setPendingOffer({ sdp, incomingType }); 
        setCallStatus("INCOMING"); 
      } else if (type === "answer" && peerConnectionRef.current) {
        console.log("Received answer from:", senderId);
        if (peerConnectionRef.current.signalingState !== "stable") {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
          while (iceCandidatesQueue.current.length > 0) {
            const cand = iceCandidatesQueue.current.shift();
            try {
              await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn("ICE candidate error after answer:", e);
            }
          }
        }
      } else if (type === "candidate") {
        const iceCandidate = new RTCIceCandidate(candidate);
        if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
          try {
            await peerConnectionRef.current.addIceCandidate(iceCandidate);
          } catch (e) {
            console.warn("ICE candidate error:", e);
          }
        } else {
          iceCandidatesQueue.current.push(candidate);
        }
      } else if (type === "hangup") {
        console.log("Received hangup from:", senderId);
        endCall(false);
      }
    } catch (err) {
      console.error("Signal Handling Error:", err);
    }
  }, [user, endCall]);

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

  return {
    callStatus,
    callType,
    remoteStream,
    localStream,
    isAudioMuted,
    isVideoEnabled,
    pendingOffer,
    startCall,
    endCall,
    joinIncomingCall,
    handleWebRTCSignal,
    toggleMute,
    toggleVideo
  };
}
