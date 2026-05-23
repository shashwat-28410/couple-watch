import { useState, useRef, useEffect, useCallback } from "react";
import Peer from "peerjs";

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

  const peerRef = useRef(null);
  const partnerPeerIdRef = useRef(null);
  const activeCallsRef = useRef({}); // Store active PeerJS call objects
  const localStreamRef = useRef(null);
  const localScreenStreamRef = useRef(null);

  // Initialize PeerJS
  useEffect(() => {
    if (!user?.id) return;

    const peer = new Peer(user.id, {
      debug: 1,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject",
          }
        ]
      }
    });

    peer.on("open", (id) => {
      addLog("PeerJS: Connection opened with ID", id);
      // Broadcast our Peer ID to others in the room
      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "peer-id",
          payload: { peerId: id, userId: user.id }
        });
      }
    });

    peer.on("call", (call) => {
      const type = call.metadata?.type || "video";
      addLog(`PeerJS: Incoming ${type} call from ${call.peer}`);
      
      if (type === "screen") {
        // Automatically accept screen share
        call.answer();
        call.on("stream", (stream) => {
          addLog("PeerJS: Received remote screen stream");
          setRemoteScreenStream(stream);
        });
        activeCallsRef.current["screen"] = call;
      } else {
        // Camera call - requires manual acceptance or state update
        setPendingOffer({ call, incomingType: type });
        setCallStatus("INCOMING");
      }
    });

    peer.on("error", (err) => {
      addLog(`PeerJS Error: ${err.type} - ${err.message}`);
    });

    peerRef.current = peer;

    return () => {
      peer.destroy();
    };
  }, [user?.id, channelRef, addLog]);

  const stopAllTracks = (stream) => {
    if (!stream) return;
    stream.getTracks().forEach(track => track.stop());
  };

  const endCall = useCallback((sendSignal = true) => {
    addLog("PeerJS: Ending call");
    
    // Close active calls
    Object.values(activeCallsRef.current).forEach(call => call.close());
    activeCallsRef.current = {};

    if (localStreamRef.current) {
      stopAllTracks(localStreamRef.current);
      localStreamRef.current = null;
    }

    setLocalStream(null);
    setRemoteStream(null);
    setCallStatus("IDLE");
    setCallType(null);
    setPendingOffer(null);
    setIsAudioMuted(false);
    setIsVideoEnabled(false);

    if (sendSignal && channelRef.current) {
      channelRef.current.send({
        type: "broadcast",
        event: "webrtc-signal",
        payload: { type: "hangup", senderId: user?.id }
      });
    }
  }, [user?.id, channelRef, addLog]);

  const startCall = useCallback(async (type) => {
    if (!partnerPeerIdRef.current) {
      // If we don't have partner ID, request it
      channelRef.current?.send({ type: "broadcast", event: "request-peer-id", payload: {} });
      addLog("PeerJS: No partner ID yet, requesting...");
      return;
    }

    addLog(`PeerJS: Starting ${type} call to ${partnerPeerIdRef.current}`);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === "video"
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      setCallType(type);
      setCallStatus("OUTGOING");
      if (type === "video") setIsVideoEnabled(true);

      const call = peerRef.current.call(partnerPeerIdRef.current, stream, {
        metadata: { type }
      });

      call.on("stream", (remoteStream) => {
        addLog("PeerJS: Received remote camera stream");
        setRemoteStream(remoteStream);
        setCallStatus("CONNECTED");
      });

      call.on("close", () => {
        addLog("PeerJS: Call closed");
        endCall(false);
      });

      activeCallsRef.current["camera"] = call;
    } catch (err) {
      addLog(`PeerJS: Start Call Error: ${err.message}`);
    }
  }, [endCall, channelRef, addLog]);

  const joinIncomingCall = useCallback(async () => {
    if (!pendingOffer) return;
    const { call, incomingType } = pendingOffer;
    setPendingOffer(null);

    addLog("PeerJS: Joining incoming call");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: incomingType === "video"
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      setCallType(incomingType);
      setCallStatus("CONNECTED");
      if (incomingType === "video") setIsVideoEnabled(true);

      call.answer(stream);
      call.on("stream", (remoteStream) => {
        addLog("PeerJS: Received remote camera stream (answering)");
        setRemoteStream(remoteStream);
      });

      call.on("close", () => {
        addLog("PeerJS: Call closed");
        endCall(false);
      });

      activeCallsRef.current["camera"] = call;
    } catch (err) {
      addLog(`PeerJS: Join Call Error: ${err.message}`);
    }
  }, [pendingOffer, endCall, addLog]);

  const stopScreenShare = useCallback(() => {
    addLog("PeerJS: Stopping screen share");
    if (localScreenStreamRef.current) {
      stopAllTracks(localScreenStreamRef.current);
      localScreenStreamRef.current = null;
    }
    setScreenStream(null);
    if (activeCallsRef.current["screen"]) {
      activeCallsRef.current["screen"].close();
      delete activeCallsRef.current["screen"];
    }
    channelRef.current?.send({
      type: "broadcast",
      event: "webrtc-signal",
      payload: { type: "stop-screen", senderId: user?.id }
    });
  }, [user?.id, channelRef, addLog]);

  const startScreenShare = useCallback(async () => {
    if (!partnerPeerIdRef.current || !peerRef.current) return;
    
    addLog("PeerJS: Starting screen share");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      localScreenStreamRef.current = stream;
      setScreenStream(stream);

      const call = peerRef.current.call(partnerPeerIdRef.current, stream, {
        metadata: { type: "screen" }
      });

      activeCallsRef.current["screen"] = call;

      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      addLog(`PeerJS: Screen Share Error: ${err.message}`);
    }
  }, [peerRef, stopScreenShare, addLog]);

  const handleWebRTCSignal = useCallback((payload) => {
    const { type, senderId } = payload;
    if (senderId === user?.id) return;

    if (type === "hangup") {
      addLog("PeerJS: Received hangup signal");
      endCall(false);
    } else if (type === "stop-screen") {
      addLog("PeerJS: Partner stopped screen share");
      setRemoteScreenStream(null);
    }
  }, [user?.id, endCall, addLog]);

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

  // Helper to store partner's peer ID
  const setPartnerPeerId = (id) => {
    if (id && id !== user?.id) {
      partnerPeerIdRef.current = id;
      addLog(`PeerJS: Partner Peer ID set to ${id}`);
    }
  };

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
    stopScreenShare,
    endCall,
    joinIncomingCall,
    handleWebRTCSignal,
    setPartnerPeerId,
    toggleMute,
    toggleVideo
  };
}
