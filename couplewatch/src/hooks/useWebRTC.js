import { useState, useRef } from "react";

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

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({ 
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }] 
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
      setRemoteStream(event.streams[0]); 
      setCallStatus("CONNECTED"); 
    };

    peerConnectionRef.current = pc;
    return pc;
  };

  const endCall = (sendSignal = true) => {
    if (sendSignal && channelRef.current && user) {
      channelRef.current.send({ 
        type: "broadcast", 
        event: "webrtc-signal", 
        payload: { type: "hangup", senderId: user.id } 
      });
    }

    if (localStreamRef.current) { 
      localStreamRef.current.getTracks().forEach(track => track.stop()); 
      localStreamRef.current = null;
    }
    setLocalStream(null);

    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    setRemoteStream(null); 
    setCallStatus("IDLE"); 
    setCallType(null); 
    setPendingOffer(null);
    iceCandidatesQueue.current = []; 
    setIsAudioMuted(false); 
    setIsVideoEnabled(false);
  };

  const startCall = async (type) => {
    if (!channelRef.current || !user) return;
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
      console.error("Start Call Error:", err); 
    }
  };

  const joinIncomingCall = async () => {
    if (!pendingOffer || !channelRef.current || !user) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: pendingOffer.incomingType === 'video' 
      });
      localStreamRef.current = stream;
      setLocalStream(stream); 
      setCallType(pendingOffer.incomingType); 
      setCallStatus("CONNECTED");
      if (pendingOffer.incomingType === 'video') setIsVideoEnabled(true);

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

      while (iceCandidatesQueue.current.length > 0) {
        const cand = iceCandidatesQueue.current.shift();
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      }
    } catch (err) { 
      console.error("Join Call Error:", err); 
    }
  };

  const handleWebRTCSignal = async (payload) => {
    const { type, sdp, candidate, senderId, callType: incomingType } = payload;
    if (!user || senderId === user.id) return;

    if (type === "offer") { 
      setPendingOffer({ sdp, incomingType }); 
      setCallStatus("INCOMING"); 
    } else if (type === "answer" && peerConnectionRef.current) {
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
      while (iceCandidatesQueue.current.length > 0) {
        const cand = iceCandidatesQueue.current.shift();
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(cand));
      }
    } else if (type === "candidate") {
      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        try { 
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate)); 
        } catch (err) { 
          console.error("ICE Candidate Error:", err); 
        }
      } else {
        iceCandidatesQueue.current.push(candidate);
      }
    } else if (type === "hangup") {
      endCall(false);
    }
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
