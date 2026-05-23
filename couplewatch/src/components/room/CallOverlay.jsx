import { useEffect, useRef } from "react";

export function CallOverlay({ 
  callStatus, 
  callType, 
  localVideoRef: externalLocalVideoRef, 
  remoteVideoRef: externalRemoteVideoRef, 
  remoteStream,
  localStream,
  isAudioMuted, 
  isVideoEnabled, 
  toggleMute, 
  toggleVideo, 
  endCall, 
  startCall, 
  joinIncomingCall,
  members,
  user,
  profile,
  peerStatus,
  partnerPeerId
}) {
  const remoteMember = members.find(m => m.user_id !== user?.id);
  
  const localVidRef = useRef(null);
  const remoteVidRef = useRef(null);

  // Sync with external refs if provided (for room-level logic)
  useEffect(() => {
    if (externalLocalVideoRef) externalLocalVideoRef.current = localVidRef.current;
    if (externalRemoteVideoRef) externalRemoteVideoRef.current = remoteVidRef.current;
  });

  // Handle stream assignment
  useEffect(() => {
    const vid = localVidRef.current;
    if (vid && localStream) {
      if (vid.srcObject !== localStream) {
        vid.srcObject = localStream;
      }
      vid.play().catch(e => console.warn("Local video play error:", e));
    } else if (vid && !localStream) {
      vid.srcObject = null;
    }
  }, [localStream, isVideoEnabled, callStatus]);

  useEffect(() => {
    const vid = remoteVidRef.current;
    if (vid && remoteStream) {
      if (vid.srcObject !== remoteStream) {
        vid.srcObject = remoteStream;
      }
      vid.play().catch(e => console.warn("Remote video play error:", e));
    } else if (vid && !remoteStream) {
      vid.srcObject = null;
    }
  }, [remoteStream, callStatus]);

  const StatusBadge = () => {
    if (peerStatus === "READY") {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20">
          <div className="w-1 h-1 rounded-full bg-green-500 animate-pulse"></div>
          <span className="text-[7px] font-black uppercase tracking-widest text-green-500">Peer Ready</span>
          {partnerPeerId && (
            <>
              <div className="w-px h-2 bg-green-500/20 mx-1"></div>
              <span className="text-[7px] font-black uppercase tracking-widest text-green-500">Partner Found</span>
            </>
          )}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/20">
        <div className="w-1 h-1 rounded-full bg-yellow-500 animate-spin"></div>
        <span className="text-[7px] font-black uppercase tracking-widest text-yellow-500">Initializing...</span>
      </div>
    );
  };

  if (callStatus === "IDLE") {
    return (
      <div className="flex flex-col items-center gap-7 p-10 animate-in slide-in-from-bottom-4 duration-700">
        <StatusBadge />
        <p className="text-[11px] font-black uppercase tracking-[0.5em] text-[#55556A]">No active call</p>
        <div className="flex items-center gap-4">
          <button onClick={() => startCall('audio')} className="w-14 h-14 rounded-[12px] bg-[#1A1A1F] border border-[#881337]/40 flex items-center justify-center text-white hover:shadow-[0_0_20px_rgba(136,19,55,0.4)] hover:border-[#881337] transition-all group" title="Audio Call">
            <svg className="w-6 h-6 group-hover:text-[#BE123C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
          </button>
          <button onClick={() => startCall('video')} className="w-14 h-14 rounded-[12px] bg-[#1A1A1F] border border-[#881337]/40 flex items-center justify-center text-white hover:shadow-[0_0_20px_rgba(136,19,55,0.4)] hover:border-[#881337] transition-all group" title="Video Call">
            <svg className="w-6 h-6 group-hover:text-[#BE123C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
          </button>
        </div>
      </div>
    );
  }

  if (callStatus === "INCOMING") {
    return (
      <div className="flex flex-col items-center justify-center p-10 animate-in zoom-in duration-500">
        <div className="w-24 h-24 rounded-full bg-[#881337]/20 border border-[#881337] flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(136,19,55,0.4)] animate-pulse">
          <svg className="w-10 h-10 text-[#BE123C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
        </div>
        <p className="text-[12px] font-black uppercase tracking-[0.3em] mb-8 text-white/90">Incoming Call</p>
        <div className="flex items-center gap-4">
          <button onClick={joinIncomingCall} className="px-8 py-3 rounded-full bg-green-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-green-500 shadow-lg transition-all">Accept</button>
          <button onClick={() => endCall()} className="px-8 py-3 rounded-full bg-red-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-red-500 shadow-lg transition-all">Decline</button>
        </div>
      </div>
    );
  }

  if (callType === 'audio') {
    return (
      <div className="flex flex-col items-center justify-center p-8 w-full animate-in fade-in duration-500">
        <div className="flex items-center gap-12 mb-10">
          <div className="flex flex-col items-center gap-4">
            <div className={`w-24 h-24 rounded-full border-2 p-1.5 transition-all duration-500 ${!isAudioMuted ? "border-[#BE123C] shadow-[0_0_30px_rgba(190,18,60,0.3)]" : "border-white/10"}`}>
              <div className="w-full h-full rounded-full bg-[#1A1A1F] flex items-center justify-center text-2xl font-bold uppercase text-white/80">
                {(profile?.full_name || user?.email?.split('@')[0] || "Y")[0]}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center gap-4">
            <div className={`w-24 h-24 rounded-full border-2 p-1.5 transition-all duration-500 ${callStatus === "CONNECTED" ? "border-[#881337] shadow-[0_0_30px_rgba(136,19,55,0.3)]" : "border-white/10 animate-pulse"}`}>
              <div className="w-full h-full rounded-full bg-[#1A1A1F] flex items-center justify-center text-2xl font-bold uppercase text-[#BE123C]">
                {(remoteMember?.profiles?.full_name || "P")[0]}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <button onClick={toggleMute} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-xl ${isAudioMuted ? "bg-[#881337]/20 text-[#BE123C] border border-[#881337]/40" : "bg-[#1A1A1F] border border-white/10 text-white"}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
          </button>
          <button onClick={() => endCall()} className="w-16 h-16 rounded-full bg-[#881337] flex items-center justify-center text-white shadow-[0_0_30px_rgba(136,19,55,0.5)] hover:scale-110 active:scale-90 transition-all">
            <svg className="w-7 h-7 rotate-[135deg]" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" /></svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col p-2 animate-in fade-in duration-500">
      <div className="flex gap-2 h-[280px] w-full">
        <div className="flex-1 rounded-[18px] bg-black border border-white/5 overflow-hidden relative shadow-2xl">
          <video ref={remoteVidRef} autoPlay playsInline className={`w-full h-full object-cover transition-opacity duration-700 ${remoteStream ? 'opacity-100' : 'opacity-0'}`} />
          {!remoteStream && (<div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0D0D12]"><div className="w-10 h-10 border-2 border-[#881337]/20 border-t-[#BE123C] rounded-full animate-spin mb-3"></div><span className="text-[8px] font-black uppercase tracking-widest text-[#881337]/60">{callStatus === "CONNECTED" ? "Buffering..." : "Connecting..."}</span></div>)}
          <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center gap-1.5 z-20">
            <div className={`w-1 h-1 rounded-full ${callStatus === "CONNECTED" ? "bg-green-500" : "bg-yellow-500 animate-pulse"}`}></div>
          </div>
        </div>
        <div className="flex-1 rounded-[18px] bg-black border border-[#BE123C]/20 overflow-hidden relative shadow-2xl transition-all">
          <video ref={localVidRef} autoPlay playsInline muted className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-700 ${!isVideoEnabled ? 'opacity-0' : 'opacity-100'}`} />
          {!isVideoEnabled && <div className="absolute inset-0 flex items-center justify-center bg-[#0D0D12]"><span className="text-[8px] font-black uppercase text-white/30 tracking-widest">Camera Off</span></div>}
          <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center gap-1.5 z-20">
            <div className="w-1 h-1 rounded-full bg-green-500"></div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center gap-4 mt-4 py-2">
        <button onClick={toggleMute} className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-xl ${isAudioMuted ? "bg-[#881337] border-[#881337] text-white shadow-[0_0_15px_rgba(136,19,55,0.5)]" : "bg-black/60 border-white/10 text-white hover:bg-black/80"}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
        </button>
        <button onClick={toggleVideo} className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-3xl border transition-all ${!isVideoEnabled ? "bg-[#881337] border-[#881337] text-white shadow-[0_0_15px_rgba(136,19,55,0.5)]" : "bg-black/60 border-white/10 text-white hover:bg-black/80"}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
        </button>
        <button onClick={() => endCall()} className="w-14 h-14 rounded-full bg-[#881337] flex items-center justify-center text-white border border-[#881337]/50 shadow-[0_0_25px_rgba(136,19,55,0.6)] hover:scale-110 active:scale-90 transition-all">
          <svg className="w-7 h-7 rotate-[135deg]" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" /></svg>
        </button>
      </div>
    </div>
  );
}
