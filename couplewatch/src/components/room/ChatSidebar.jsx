import { useRef, useEffect } from "react";

export function ChatSidebar({ 
  messages, 
  user, 
  typingUsers, 
  newMessage, 
  setNewMessage, 
  handleSendMessage, 
  handleTyping,
  sendReaction,
  callStatus,
  startCall,
  toggleMute,
  toggleVideo,
  isAudioMuted,
  isVideoEnabled
}) {
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 bg-[#0D0D12] backdrop-blur-2xl border border-[#881337]/10 rounded-[22px] flex flex-col relative overflow-hidden shadow-2xl animate-in slide-in-from-bottom-6 duration-700">
      <div className="p-5 border-b border-white/5 bg-black/40 backdrop-blur-md flex items-center justify-between">
        <h3 className="text-[10px] font-black uppercase tracking-[0.5em] text-[#8B8B9A] italic">Heartbeat Chat</h3>
        <div className="flex gap-1.5 px-2">
          <div className="w-1.5 h-1.5 bg-[#881337] rounded-full animate-pulse shadow-[0_0_8px_#881337]"></div>
          <div className="w-1.5 h-1.5 bg-[#881337] rounded-full animate-pulse [animation-delay:0.2s] shadow-[0_0_8px_#881337]"></div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6 space-y-7 custom-scrollbar bg-black/10">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-5 opacity-10">
            <span className="text-5xl grayscale">💞</span>
            <p className="text-[10px] font-black uppercase tracking-[0.4em] italic">Start a whisper</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col ${msg.user_id === user?.id ? "items-end" : "items-start"}`}>
              <div className={`px-5 py-3.5 rounded-[18px] text-[13.5px] font-medium leading-relaxed max-w-[85%] shadow-2xl transition-all hover:translate-y-[-2px] ${msg.user_id === user?.id ? "bg-[#881337] text-white rounded-tr-none shadow-[0_15px_30px_rgba(136,19,55,0.25)]" : "bg-[#2A2A2F] text-white/95 rounded-tl-none border border-white/5 shadow-black/40"}`}>
                {msg.content}
              </div>
              <span className="text-[8px] font-black text-[#55556A] mt-2.5 uppercase tracking-widest px-1 opacity-60">
                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))
        )}
        {typingUsers.length > 0 && (
          <div className="flex items-center gap-3 px-2">
            <div className="flex gap-1.5">
              <span className="w-1.5 h-1.5 bg-[#881337] rounded-full animate-bounce"></span>
              <span className="w-1.5 h-1.5 bg-[#881337] rounded-full animate-bounce [animation-delay:0.2s] shadow-[0_0_8px_#881337]"></span>
            </div>
            <p className="text-[9px] text-[#881337]/60 font-black italic">{typingUsers[0]} is whispering...</p>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-5 border-t border-white/5 bg-black/40 backdrop-blur-md">
        <div className="flex items-center gap-2 mb-4 px-1 overflow-x-auto custom-scrollbar pb-2">
          {["❤️", "💖", "😘", "😂", "😭", "😮", "😡", "🔥", "🍿"].map((emoji) => (
            <button 
              key={emoji} 
              type="button"
              onClick={() => sendReaction(emoji)}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-rose-500/20 hover:scale-110 transition-all text-sm border border-white/5"
            >
              {emoji}
            </button>
          ))}
        </div>
        <form onSubmit={handleSendMessage} className="flex items-center gap-3">
          <input 
            className="flex-1 bg-[#1A1A1F] border border-white/10 rounded-[14px] py-4 px-6 text-[14px] font-medium placeholder:text-[#33334A] focus:border-[#881337]/40 outline-none transition-all shadow-[inset_0_0_30px_rgba(255,255,255,0.01)]" 
            value={newMessage} 
            onChange={e => { setNewMessage(e.target.value); handleTyping(); }} 
            placeholder="Message..." 
          />
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={() => { if (callStatus === "IDLE") startCall('audio'); else toggleMute(); }} className={`w-11 h-11 rounded-[12px] bg-[#1A1A1F] border flex items-center justify-center transition-all ${callStatus !== "IDLE" && !isAudioMuted ? "border-[#881337] text-[#BE123C] shadow-[0_0_15px_rgba(136,19,55,0.3)]" : "border-[#881337]/30 text-white/50"}`} title="Mic">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
            </button>
            <button type="button" onClick={() => { if (callStatus === "IDLE") startCall('video'); else toggleVideo(); }} className={`w-11 h-11 rounded-[12px] bg-[#1A1A1F] border flex items-center justify-center transition-all ${callStatus !== "IDLE" && isVideoEnabled ? "border-[#881337] text-[#BE123C] shadow-[0_0_15px_rgba(136,19,55,0.3)]" : "border-[#881337]/30 text-white/50"}`} title="Video">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
            </button>
            <button type="submit" className="w-12 h-12 rounded-full bg-[#881337] flex items-center justify-center text-white shadow-[0_10px_20px_rgba(136,19,55,0.35)] hover:scale-110 active:scale-95 transition-all" title="Send">
              <span className="text-xl">➜</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
