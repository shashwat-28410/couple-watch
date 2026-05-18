import { useState, useRef, useEffect } from "react";

export function DraggablePartnerVideo({ remoteVideoRef, remoteStream, callStatus, partnerName }) {
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    setIsDragging(true);
    offsetRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      setPosition({
        x: e.clientX - offsetRef.current.x,
        y: e.clientY - offsetRef.current.y
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Use a local ref for the video inside the draggable component
  // to ensure it stays attached when moving between full screen and sidebar
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
      className="draggable-video absolute z-[60] w-48 aspect-video rounded-xl overflow-hidden border-2 border-[#881337] shadow-2xl cursor-move select-none"
      style={{ 
        left: `${position.x}px`, 
        top: `${position.y}px`,
        touchAction: 'none'
      }}
      onMouseDown={handleMouseDown}
    >
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        className="w-full h-full object-cover pointer-events-none"
      />
      <div className="absolute top-2 left-2 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center gap-1.5">
        <div className="w-1 h-1 rounded-full bg-green-500"></div>
      </div>
    </div>
  );
}
