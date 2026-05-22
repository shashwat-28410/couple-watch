import { useState, useEffect, useRef } from "react";

export function VideoPlayer({ 
  roomState, 
  isHost, 
  playerRef, 
  hasInteracted, 
  setHasInteracted, 
  updateRoomState,
  floatingReactions,
  isFullScreen,
  toggleFullScreen,
  isTheaterMode,
  setIsTheaterMode,
  containerRef,
  screenStream,
  remoteScreenStream,
  children
}) {
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [showAdjustments, setShowAdjustments] = useState(false);
  const [seekFeedback, setSeekFeedback] = useState(null);
  const [videoError, setVideoError] = useState(null);
  
  // ─── Local Fit/Fill/Zoom States (Independent for Host/Partner) ───
  const [viewMode, setViewMode] = useState("fit"); // fit, fill
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const isScreenShare = !!(screenStream || remoteScreenStream);
  const streamToPlay = isHost ? screenStream : remoteScreenStream;

  const streamVideoRef = useRef(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const clickStartPosRef = useRef({ x: 0, y: 0 });
  const lastClickTimeRef = useRef(0);
  const controlsTimeoutRef = useRef(null);
  const seekFeedbackTimeoutRef = useRef(null);

  useEffect(() => {
    if (isScreenShare && streamVideoRef.current && streamToPlay) {
      if (streamVideoRef.current.srcObject !== streamToPlay) {
        streamVideoRef.current.srcObject = streamToPlay;
      }
      if (hasInteracted) {
        streamVideoRef.current.play().catch(e => console.warn("Stream play error:", e));
      }
    }
  }, [isScreenShare, streamToPlay, hasInteracted]);

  // Handle playing when interaction happens
  useEffect(() => {
    if (hasInteracted) {
      if (isScreenShare && streamVideoRef.current) {
        streamVideoRef.current.play().catch(() => {});
      }
      if (!isScreenShare && playerRef.current && roomState?.is_playing) {
        playerRef.current.play().catch(() => {});
      }
    }
  }, [hasInteracted, isScreenShare, roomState?.is_playing]);
  // Reset pan offset if zoom is reset
  useEffect(() => {
    if (zoomLevel <= 1) {
      setPanX(0);
      setPanY(0);
    }
  }, [zoomLevel]);

  // Reveal controls timeout
  useEffect(() => {
    if (showControls && (roomState?.is_playing || isScreenShare)) {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
        setShowAdjustments(false);
      }, 3500);
    }
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [showControls, roomState?.is_playing, isScreenShare]);

  const handleMouseDown = (e) => {
    if (zoomLevel <= 1 || e.target.closest('button') || e.target.closest('input')) return;
    setIsDragging(true);
    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    dragStartRef.current = { x: clientX, y: clientY };
    clickStartPosRef.current = { x: clientX, y: clientY };
  };

  const handleMouseMove = (e) => {
    // Show controls on hover/movement
    setShowControls(true);

    if (!isDragging || zoomLevel <= 1) return;
    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    if (clientX === undefined) return;

    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;
    
    // Smoothly accumulate pan coordinates
    setPanX(prev => Math.max(-1000, Math.min(1000, prev + dx)));
    setPanY(prev => Math.max(-1000, Math.min(1000, prev + dy)));
    dragStartRef.current = { x: clientX, y: clientY };
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleVideoClick = (e) => {
    if (e.target.closest('button') || e.target.closest('.draggable-video') || e.target.closest('input')) return;
    if (!hasInteracted) setHasInteracted(true);

    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    
    // If it was a drag, ignore click handler
    const dist = Math.hypot(clientX - (clickStartPosRef.current?.x || clientX), clientY - (clickStartPosRef.current?.y || clientY));
    if (zoomLevel > 1 && dist > 5) return;

    setShowControls(prev => !prev);
    if (isScreenShare) return;

    const now = Date.now();
    const isDoubleTap = now - lastClickTimeRef.current < 300;
    lastClickTimeRef.current = now;

    if (isDoubleTap && isHost && playerRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = clientX - rect.left;
      const newTime = x < rect.width / 2 
        ? Math.max(0, playerRef.current.currentTime - 5) 
        : Math.min(playerRef.current.duration || Infinity, playerRef.current.currentTime + 5);
      
      playerRef.current.currentTime = newTime;
      updateRoomState({ current_timestamp_seconds: newTime }, true);
      
      setSeekFeedback(x < rect.width / 2 ? "backward" : "forward");
      if (seekFeedbackTimeoutRef.current) clearTimeout(seekFeedbackTimeoutRef.current);
      seekFeedbackTimeoutRef.current = setTimeout(() => setSeekFeedback(null), 800);
    }
  };

  const adjustZoom = (delta) => setZoomLevel(prev => Math.min(3, Math.max(1, prev + delta)));
  const adjustPan = (x, y) => {
    setPanX(prev => prev + x);
    setPanY(prev => prev + y);
  };
  const resetAdjustments = () => {
    setZoomLevel(1);
    setPanX(0);
    setPanY(0);
    setViewMode("fit");
  };

  const videoStyle = {
    transform: `scale(${zoomLevel}) translate(${panX}px, ${panY}px)`,
    transition: isDragging ? 'none' : 'transform 0.2s ease-out',
    cursor: isDragging ? 'grabbing' : zoomLevel > 1 ? 'grab' : 'pointer'
  };

  // Only show the overlay if we are in a special viewing mode
  const isCinemaActive = isFullScreen || isTheaterMode;

  return (
    <div 
      ref={containerRef} 
      className={`romantic-card !p-0 border-white/5 bg-white/[0.02] overflow-hidden shadow-2xl relative select-none ${
        isFullScreen ? 'fixed inset-0 z-[100] rounded-none' : ''
      }`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchStart={handleMouseDown}
      onTouchMove={handleMouseMove}
      onTouchEnd={handleMouseUp}
    >
      <div 
        className={`relative bg-black group cursor-pointer overflow-hidden ${
          isFullScreen ? 'w-full h-full' : 'aspect-video'
        }`} 
        onClick={handleVideoClick}
      >
        {floatingReactions.map(r => (
          <div key={r.id} className="float-reaction" style={{ left: `${r.left}%`, bottom: '20px' }}>{r.emoji}</div>
        ))}

        {isScreenShare ? (
          <video 
            ref={streamVideoRef} 
            autoPlay 
            playsInline 
            className={`absolute inset-0 w-full h-full ${
              viewMode === 'fill' ? 'object-cover' : 'object-contain'
            }`} 
            style={videoStyle}
          />
        ) : roomState?.video_url ? (
          <video 
            ref={playerRef} 
            src={roomState.video_url} 
            className={`absolute inset-0 w-full h-full ${
              viewMode === 'fill' ? 'object-cover' : 'object-contain'
            }`} 
            style={videoStyle}
            playsInline
            onLoadedMetadata={(e) => { setVideoLoading(false); setVideoDuration(e.target.duration); }} 
            onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
            onWaiting={() => setVideoLoading(true)} 
            onPlaying={() => setVideoLoading(false)}
            onPlay={() => isHost && updateRoomState({ is_playing: true, current_timestamp_seconds: playerRef.current?.currentTime || 0 })}
            onPause={() => isHost && updateRoomState({ is_playing: false, current_timestamp_seconds: playerRef.current?.currentTime || 0 })}
            onSeeked={() => isHost && updateRoomState({ current_timestamp_seconds: playerRef.current?.currentTime || 0 }, true)}
            onEnded={() => { if (isHost) updateRoomState({ is_playing: false, current_timestamp_seconds: 0 }, true); }}
            onError={() => { setVideoError("Playback failed."); setVideoLoading(false); }}
          />
        ) : ( 
          <div className="w-full h-full bg-black flex items-center justify-center opacity-20"><span className="text-6xl">🎬</span></div> 
        )}
        
        {/* UI Overlay for Draggable Video Call - Only show in Cinema Modes */}
        {isCinemaActive && (
          <div className="absolute inset-0 pointer-events-none z-[60]">
            {children}
          </div>
        )}

        {seekFeedback && (
          <div className={`absolute inset-y-0 ${seekFeedback === 'backward' ? 'left-0' : 'right-0'} w-1/2 z-50 flex items-center justify-center pointer-events-none`}>
            <div className="w-24 h-24 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center animate-pulse">
              <svg className="w-8 h-8 text-white/60" fill="currentColor" viewBox="0 0 24 24">
                {seekFeedback === 'backward' ? <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/> : <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>}
              </svg>
            </div>
          </div>
        )}
        
        {/* Controls Overlay */}
        {(showControls || (!isScreenShare && !roomState?.video_url)) && hasInteracted && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-between bg-black/40 transition-opacity duration-300 p-6">
            
            <div className="flex-1 flex items-center justify-center">
              {isHost && !isScreenShare && roomState?.video_url && (
                <div className="flex items-center gap-12 md:gap-20">
                  <button onClick={(e) => { e.stopPropagation(); if (playerRef.current) { playerRef.current.currentTime = Math.max(0, playerRef.current.currentTime - 5); updateRoomState({ current_timestamp_seconds: playerRef.current.currentTime }, true); } }} className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all"><span className="text-sm font-black">-5s</span></button>
                  <button onClick={(e) => { e.stopPropagation(); if (roomState.is_playing) updateRoomState({ is_playing: false, current_timestamp_seconds: playerRef.current?.currentTime || 0 }); else updateRoomState({ is_playing: true, current_timestamp_seconds: playerRef.current?.currentTime || 0 }); }} className="w-24 h-24 rounded-full border-2 border-white/30 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all">{roomState.is_playing ? <svg width="40" height="40" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : <svg width="40" height="40" fill="currentColor" viewBox="0 0 24 24" className="ml-2"><path d="M8 5v14l11-7z"/></svg>}</button>
                  <button onClick={(e) => { e.stopPropagation(); if (playerRef.current) { playerRef.current.currentTime = Math.min(playerRef.current.duration, playerRef.current.currentTime + 5); updateRoomState({ current_timestamp_seconds: playerRef.current.currentTime }, true); } }} className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all"><span className="text-sm font-black">+5s</span></button>
                </div>
              )}
            </div>

            {/* Bottom Toolbar: Main Controls */}
            <div className="w-full bg-gradient-to-t from-black/95 via-black/40 to-transparent p-8 -m-8 relative" onClick={(e) => e.stopPropagation()}>
              
              {/* Cinema Adjustment Panel (Triggered by Gear Icon) */}
              {showAdjustments && (
                <div className="adjustments-panel absolute bottom-full right-8 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                  <div className="flex flex-col gap-4 bg-black/80 backdrop-blur-2xl p-5 rounded-[24px] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                    <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-1">
                      <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">Cinema Adjust</span>
                      <button onClick={() => resetAdjustments()} className="text-[9px] font-black uppercase text-rose-500 hover:text-rose-400 transition-colors">Reset All</button>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      {/* Zoom Control */}
                      <div className="flex flex-col gap-3">
                        <span className="text-[8px] font-black uppercase tracking-widest text-white/30">Zoom Level</span>
                        <div className="flex items-center bg-white/5 rounded-xl border border-white/5 overflow-hidden">
                          <button onClick={() => adjustZoom(-0.05)} className="p-3 hover:bg-rose-500/20 text-white/80 transition-colors border-r border-white/5"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12h14"/></svg></button>
                          <span className="text-[11px] font-black text-white min-w-[50px] text-center">{Math.round(zoomLevel * 100)}%</span>
                          <button onClick={() => adjustZoom(0.05)} className="p-3 hover:bg-rose-500/20 text-white/80 transition-colors border-l border-white/5"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 5v14M5 12h14"/></svg></button>
                        </div>
                      </div>

                      {/* View Mode Toggle */}
                      <div className="flex flex-col gap-3">
                        <span className="text-[8px] font-black uppercase tracking-widest text-white/30">View Mode</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewMode(prev => prev === "fit" ? "fill" : "fit");
                          }}
                          className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/5 text-[9px] font-black uppercase tracking-widest text-white/70 hover:bg-white/10 hover:text-white transition-all shadow-md"
                        >
                          {viewMode === "fit" ? "FIT" : "FILL"}
                        </button>
                      </div>

                      {/* Panning Control */}
                      <div className="flex flex-col gap-3">
                        <span className="text-[8px] font-black uppercase tracking-widest text-white/30">Position</span>
                        <div className="grid grid-cols-3 gap-1">
                          <div />
                          <button onClick={() => adjustPan(0, -10)} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/60"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 15l-6-6-6 6"/></svg></button>
                          <div />
                          <button onClick={() => adjustPan(-10, 0)} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/60"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M15 18l-6-6 6-6"/></svg></button>
                          <button onClick={() => resetAdjustments()} className="p-2 bg-rose-500/10 hover:bg-rose-500/20 rounded-lg text-rose-500"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8m0 0V3m0 5h5"/></svg></button>
                          <button onClick={() => adjustPan(10, 0)} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/60"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M9 18l6-6-6-6"/></svg></button>
                          <div />
                          <button onClick={() => adjustPan(0, 10)} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/60"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 9l6 6 6-6"/></svg></button>
                          <div />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="max-w-4xl mx-auto flex flex-col gap-6">
                {isHost && !isScreenShare && (
                  <input type="range" min="0" max={videoDuration || 100} value={currentTime} onChange={(e) => {
                    const newTime = parseFloat(e.target.value);
                    setCurrentTime(newTime);
                    if (playerRef.current) playerRef.current.currentTime = newTime;
                    updateRoomState({ current_timestamp_seconds: newTime }, true);
                  }} className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-rose-600 transition-all" />
                )}
                
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-black text-white/60 uppercase tracking-widest flex items-center gap-4">
                    {!isScreenShare ? (
                      <span>{new Date(currentTime * 1000).toISOString().substr(11, 8)} / {new Date(videoDuration * 1000).toISOString().substr(11, 8)}</span>
                    ) : (
                      <div className="flex items-center gap-2 text-rose-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                        <span>LIVE CINEMA STREAM</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <button onClick={(e) => { e.stopPropagation(); setIsTheaterMode(!isTheaterMode); }} className={`p-2.5 rounded-xl transition-all ${isTheaterMode ? 'bg-rose-600 text-white shadow-[0_0_20px_rgba(225,29,72,0.4)]' : 'bg-white/5 text-white/70 hover:bg-white/10'}`} title="Theater Mode">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16"/></svg>
                    </button>

                    <button onClick={(e) => { e.stopPropagation(); setShowAdjustments(!showAdjustments); }} className={`p-2.5 rounded-xl transition-all ${showAdjustments ? 'bg-white/20 text-white' : 'bg-white/5 text-white/70 hover:bg-white/10'}`} title="Cinema Adjust Settings">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={showAdjustments ? 'rotate-90 transition-transform duration-500' : 'transition-transform duration-500'}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    </button>

                    <button onClick={(e) => { e.stopPropagation(); toggleFullScreen(); }} className="p-2.5 rounded-xl bg-white/5 text-white/70 hover:bg-white/10 transition-all" title="Toggle Fullscreen">
                      {isFullScreen ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {videoLoading && !videoError && ( <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-10"><div className="w-14 h-14 border-4 border-rose-500/20 border-t-rose-500 rounded-full animate-spin"></div></div> )}
        {videoError && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50 p-6 text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <p className="text-rose-500 font-bold mb-2">Video Error</p>
            <button onClick={() => setVideoError(null)} className="mt-6 px-6 py-2 rounded-full bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest">Dismiss</button>
          </div>
        )}
        {!hasInteracted && ( <div onClick={() => setHasInteracted(true)} className="absolute inset-0 bg-[#0A0A0F]/95 flex flex-col items-center justify-center cursor-pointer backdrop-blur-2xl z-20 animate-in fade-in duration-700"><div className="w-24 h-24 bg-primary-gradient rounded-full flex items-center justify-center mb-8 shadow-2xl transition-transform hover:scale-110"><span className="text-4xl text-white ml-2">▶</span></div><p className="text-3xl font-black text-white uppercase italic">Tap to join sync ❤️</p><p className="mt-4 text-[10px] font-black uppercase tracking-[0.3em] text-white/40">Ensures perfect audio & video sync</p></div> )}
      </div>
    </div>
  );
}
