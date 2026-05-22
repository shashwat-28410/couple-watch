import { useState, useRef, useEffect } from "react";

export function DraggablePartnerVideo({ remoteStream, callStatus, partnerName }) {
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  
  const dragRef = useRef(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    // Prevent drag trigger when clicking on the control buttons
    if (e.target.closest('button')) return;
    
    setIsDragging(true);
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    offsetRef.current = {
      x: clientX - position.x,
      y: clientY - position.y
    };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const clientX = e.clientX ?? e.touches?.[0]?.clientX;
      const clientY = e.clientY ?? e.touches?.[0]?.clientY;
      if (clientX === undefined) return;

      const newX = clientX - offsetRef.current.x;
      const newY = clientY - offsetRef.current.y;

      // Clamp position within viewport boundaries
      const width = isMinimized ? 40 : 256; // 64 md matches 256px
      const height = isMinimized ? 40 : 176; // 44 md matches 176px
      const maxX = window.innerWidth - width;
      const maxY = window.innerHeight - height;

      setPosition({
        x: Math.max(0, Math.min(maxX, newX)),
        y: Math.max(0, Math.min(maxY, newY))
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("touchmove", handleMouseMove);
      window.addEventListener("touchend", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleMouseMove);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [isDragging, isMinimized]);

  const videoRef = useRef(null);
  
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, callStatus]);

  if (callStatus !== "CONNECTED") return null;

  return (
    <div 
      ref={dragRef}
      className={`draggable-video absolute z-[100] cursor-move select-none pointer-events-auto ${isDragging ? '' : 'transition-all duration-300'} ${
        isMinimized ? 'w-10 h-10' : 'w-48 h-32 md:w-64 md:h-44'
      } rounded-2xl overflow-hidden border border-[#881337]/40 shadow-2xl bg-[#0D0D12] group/overlay`}
      style={{ 
        left: `${position.x}px`, 
        top: `${position.y}px`,
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none'
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleMouseDown}
    >
      {!isMinimized ? (
        <>
          {/* Top handle visual cue */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-white/20 z-30 pointer-events-none" />
          
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className="w-full h-full object-cover pointer-events-none"
          />

          {/* Hover Control Overlay */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/overlay:opacity-100 transition-opacity flex items-center justify-center gap-3 z-20">
            <button 
              onClick={(e) => { e.stopPropagation(); setIsMinimized(true); }}
              className="w-10 h-10 rounded-full bg-black/80 border border-white/10 flex items-center justify-center hover:bg-white/20 transition-all text-white shadow-xl"
              title="Minimize Camera"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 12H6" />
              </svg>
            </button>
          </div>

          {/* Status Badge */}
          <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center gap-1.5 z-10 pointer-events-none">
            <div className="w-1 h-1 rounded-full bg-green-500"></div>
            <span className="text-[7px] font-black uppercase text-white tracking-widest">{partnerName}</span>
          </div>
        </>
      ) : (
        /* Minimized State */
        <div 
          className="w-full h-full flex items-center justify-center bg-[#1A1A1F] cursor-pointer hover:bg-[#2A2A2F] transition-colors"
          onClick={(e) => { e.stopPropagation(); setIsMinimized(false); }}
          title="Expand Camera"
        >
          <svg className="w-5 h-5 text-[#881337] animate-pulse" fill="currentColor" viewBox="0 0 24 24">
            <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
      )}
    </div>
  );
}
