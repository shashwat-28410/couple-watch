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
  containerRef,
  children 
}) {
  const [showControls, setShowControls] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState(null);
  const [seekFeedback, setSeekFeedback] = useState(null);

  // ─── Local Fit/Fill/Zoom States (Independent for Host/Partner) ───
  const [viewMode, setViewMode] = useState("fit"); // fit, fill
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const clickStartPosRef = useRef({ x: 0, y: 0 });
  const lastClickTimeRef = useRef(0);
  
  const controlsTimeoutRef = useRef(null);
  const seekFeedbackTimeoutRef = useRef(null);

  // Auto-hide controls timer
  useEffect(() => {
    if (showControls && roomState?.is_playing) {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3500);
    }
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [showControls, roomState?.is_playing]);

  // Reset pan offset if zoom is reset
  useEffect(() => {
    if (zoomLevel <= 1) {
      setPanOffset({ x: 0, y: 0 });
    }
  }, [zoomLevel]);

  const handleMouseDown = (e) => {
    if (zoomLevel <= 1 || e.target.closest('button')) return;
    setIsDragging(true);
    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    dragStartRef.current = { x: clientX, y: clientY };
    clickStartPosRef.current = { x: clientX, y: clientY };
  };

  const handleMouseMove = (e) => {
    // Reveal controls on hover/movement
    setShowControls(true);

    if (!isDragging || zoomLevel <= 1) return;
    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    if (clientX === undefined) return;

    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;
    
    // Clamp panning to prevent dragging completely off screen
    setPanOffset(prev => ({
      x: Math.max(-500, Math.min(500, prev.x + dx)),
      y: Math.max(-500, Math.min(500, prev.y + dy))
    }));
    dragStartRef.current = { x: clientX, y: clientY };
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleVideoClick = (e) => {
    if (e.target.closest('button')) return;

    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    
    // If it was a drag, do not trigger play/pause seek logic
    const dist = Math.hypot(clientX - (clickStartPosRef.current?.x || clientX), clientY - (clickStartPosRef.current?.y || clientY));
    if (zoomLevel > 1 && dist > 5) return;

    const now = Date.now();
    const isDoubleTap = now - lastClickTimeRef.current < 300;
    lastClickTimeRef.current = now;
    
    if (isDoubleTap) {
      if (!isHost) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = clientX - rect.left;
      if (playerRef.current) {
        const newTime = x < rect.width / 2 
          ? Math.max(0, playerRef.current.currentTime - 5) 
          : Math.min(playerRef.current.duration || Infinity, playerRef.current.currentTime + 5);
        
        playerRef.current.currentTime = newTime;
        updateRoomState({ current_timestamp_seconds: newTime }, true);
        
        setSeekFeedback(x < rect.width / 2 ? 'backward' : 'forward');
        if (seekFeedbackTimeoutRef.current) clearTimeout(seekFeedbackTimeoutRef.current);
        seekFeedbackTimeoutRef.current = setTimeout(() => setSeekFeedback(null), 800);
      }
    } else {
      setShowControls(prev => !prev);
    }
  };

  return (
    <div 
      className="romantic-card p-2 bg-black border border-white/5 rounded-[24px] shadow-2xl relative select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchStart={handleMouseDown}
      onTouchMove={handleMouseMove}
      onTouchEnd={handleMouseUp}
    >
      <div 
        className={`relative bg-black group cursor-pointer overflow-hidden rounded-[20px] ${
          isFullScreen ? 'w-full h-full' : 'aspect-video'
        }`} 
        onClick={handleVideoClick}
      >
        {floatingReactions.map(r => (
          <div key={r.id} className="float-reaction" style={{ left: `${r.left}%`, bottom: '20px' }}>{r.emoji}</div>
        ))}
        {roomState?.video_url ? (
          <video 
            ref={playerRef} 
            src={roomState.video_url} 
            className={`absolute inset-0 w-full h-full ${
              viewMode === 'fill' ? 'object-cover' : 'object-contain'
            }`} 
            style={{ 
              transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`, 
              transition: isDragging ? 'none' : 'transform 0.3s ease-out',
              cursor: isDragging ? 'grabbing' : zoomLevel > 1 ? 'grab' : 'pointer'
            }}
            playsInline
            onLoadedMetadata={(e) => { setVideoLoading(false); setVideoDuration(e.target.duration); }} 
            onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
            onWaiting={() => setVideoLoading(true)} 
            onPlaying={() => setVideoLoading(false)}
            onPlay={() => isHost && updateRoomState({ is_playing: true, current_timestamp_seconds: playerRef.current?.currentTime || 0 })}
            onPause={() => isHost && updateRoomState({ is_playing: false, current_timestamp_seconds: playerRef.current?.currentTime || 0 })}
            onSeeked={() => isHost && updateRoomState({ current_timestamp_seconds: playerRef.current?.currentTime || 0 }, true)}
            onEnded={() => { if (isHost) updateRoomState({ is_playing: false, current_timestamp_seconds: 0 }, true); }}
            onError={() => { setVideoError("Playback failed. Ensure it's a direct MP4 URL."); setVideoLoading(false); }}
          />
        ) : ( <div className="w-full h-full bg-black flex items-center justify-center opacity-20"><span className="text-6xl">🎬</span></div> )}
        
        {/* Full Screen Overlay Children (Draggable PIP Video) */}
        {children}

        {seekFeedback && (
          <div className={`absolute inset-y-0 ${seekFeedback === 'backward' ? 'left-0' : 'right-0'} w-1/2 z-50 flex items-center justify-center pointer-events-none`}>
            <div className="w-24 h-24 rounded-full bg-white/10 backdrop-blur-md flex flex-col items-center justify-center animate-pulse">
              <svg className="w-8 h-8 text-white/60" fill="currentColor" viewBox="0 0 24 24">{seekFeedback === 'backward' ? <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/> : <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>}</svg>
              <span className="text-white/60 text-[10px] font-black mt-1">5S</span>
            </div>
          </div>
        )}
        
        {/* Controls Overlay */}
        {(showControls || !roomState?.video_url) && roomState?.video_url && hasInteracted && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/40 transition-opacity duration-300">
            {isHost && (
              <div className="flex items-center gap-12 md:gap-20 mb-8">
                <button onClick={(e) => { e.stopPropagation(); if (playerRef.current) { playerRef.current.currentTime = Math.max(0, playerRef.current.currentTime - 5); updateRoomState({ current_timestamp_seconds: playerRef.current.currentTime }, true); } }} className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all"><span className="text-sm font-black">-5s</span></button>
                <button onClick={(e) => { e.stopPropagation(); if (roomState.is_playing) updateRoomState({ is_playing: false, current_timestamp_seconds: playerRef.current?.currentTime || 0 }); else updateRoomState({ is_playing: true, current_timestamp_seconds: playerRef.current?.currentTime || 0 }); }} className="w-24 h-24 rounded-full border-2 border-white/30 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all">{roomState.is_playing ? <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : <svg className="w-12 h-12 ml-2" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}</button>
                <button onClick={(e) => { e.stopPropagation(); if (playerRef.current) { playerRef.current.currentTime = Math.min(playerRef.current.duration, playerRef.current.currentTime + 5); updateRoomState({ current_timestamp_seconds: playerRef.current.currentTime }, true); } }} className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all"><span className="text-sm font-black">+5s</span></button>
              </div>
            )}
            
            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-col gap-4">
                {isHost && (
                  <input type="range" min="0" max={videoDuration || 100} value={currentTime} onChange={(e) => {
                    const newTime = parseFloat(e.target.value);
                    setCurrentTime(newTime);
                    if (playerRef.current) playerRef.current.currentTime = newTime;
                    updateRoomState({ current_timestamp_seconds: newTime }, true);
                  }} className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#881337] transition-all" />
                )}
                
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-black text-white/60 uppercase tracking-widest flex items-center gap-4">
                    <span>{new Date(currentTime * 1000).toISOString().substr(11, 8)} / {new Date(videoDuration * 1000).toISOString().substr(11, 8)}</span>
                  </div>

                  {/* Left Controls: Fit/Fill Mode & Zoom Toggles */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewMode(prev => prev === "fit" ? "fill" : "fit");
                      }}
                      className="w-10 h-10 rounded-full bg-black/40 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all text-[9px] font-black uppercase tracking-widest text-white/70 shadow-lg"
                      title="Change View Mode"
                    >
                      {viewMode === "fit" ? "FIT" : "FILL"}
                    </button>
                    <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded-full px-2 h-10 shadow-lg" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setZoomLevel(z => Math.max(1, z - 0.25))} className="text-white/50 hover:text-white px-2 py-1 transition-colors text-lg leading-none mb-0.5">-</button>
                      <span className="text-[9px] font-black uppercase tracking-widest text-white/70 w-9 text-center">{Math.round(zoomLevel * 100)}%</span>
                      <button onClick={() => setZoomLevel(z => Math.min(2.5, z + 0.25))} className="text-white/50 hover:text-white px-2 py-1 transition-colors text-base leading-none">+</button>
                    </div>
                  </div>
                  
                  <button onClick={(e) => { e.stopPropagation(); toggleFullScreen(); }} className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/80 shadow-lg" title="Toggle Fullscreen">
                    {isFullScreen ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {videoLoading && roomState?.video_url && !videoError && ( <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-10"><div className="w-14 h-14 border-4 border-rose-500/20 border-t-rose-500 rounded-full animate-spin mb-4"></div></div> )}
        {videoError && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50 p-6 text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <p className="text-rose-500 font-bold mb-2">Video Error</p>
            <p className="text-[#8B8B9A] text-xs">{videoError}</p>
            <button onClick={() => setVideoError(null)} className="mt-6 px-6 py-2 rounded-full bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest">Dismiss</button>
          </div>
        )}
        {!hasInteracted && roomState?.video_url && ( <div onClick={() => setHasInteracted(true)} className="absolute inset-0 bg-[#0A0A0F]/95 flex flex-col items-center justify-center cursor-pointer backdrop-blur-2xl z-20"><div className="w-24 h-24 bg-primary-gradient rounded-full flex items-center justify-center mb-8 shadow-2xl transition-transform hover:scale-110"><span className="text-4xl text-white ml-2">▶</span></div><p className="text-3xl font-black text-white uppercase italic">Tap to join sync ❤️</p></div> )}
      </div>
    </div>
  );
}
