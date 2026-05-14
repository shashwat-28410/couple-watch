export function PresenceList({ members, onlineUsers }) {
  return (
    <div className="bg-white/[0.02] backdrop-blur-xl border border-[#881337]/30 rounded-[22px] p-5 shadow-[inset_0_0_20px_rgba(136,19,55,0.05),0_10px_40px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between mb-5 px-1">
        <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-[#8B8B9A] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#881337] shadow-[0_0_8px_#881337]"></span>
          Presence
        </h3>
        <div className="px-2 py-0.5 rounded-md bg-white/5 border border-white/5 text-[9px] font-black text-[#55556A] uppercase tracking-widest">
          {onlineUsers.length} Online
        </div>
      </div>
      <div className="space-y-4">
        {members.map((member) => (
          <div key={member.id} className="flex items-center justify-between group px-1">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-white/10 to-transparent border border-white/10 flex items-center justify-center text-[11px] font-bold text-white shadow-xl group-hover:border-[#881337]/30 transition-all uppercase">
                  {(member.profiles?.full_name || "P")[0]}
                </div>
                {onlineUsers.includes(member.user_id) && (
                  <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-[3px] border-[#0A0A0F] shadow-[0_0_10px_rgba(34,197,94,0.8)]"></div>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-bold text-white/90 truncate max-w-[140px] tracking-tight">
                  {member.profiles?.full_name || "Partner"}
                </span>
                <span className="text-[9px] font-bold text-[#55556A] uppercase tracking-widest">
                  {member.role === 'host' ? 'Master of Sync' : 'Partner'}
                </span>
              </div>
            </div>
            {member.role === 'host' ? (
              <div className="px-3 py-1.5 rounded-full bg-[#881337]/10 border border-[#881337]/30 flex items-center gap-2 shadow-[0_0_15px_rgba(136,197,55,0.1)]">
                <span className="text-[9px] font-black uppercase text-[#BE123C] tracking-widest">Host</span>
                <span className="text-xs">👑</span>
              </div>
            ) : (
              <div className="px-3 py-1.5 rounded-full bg-white/5 border border-white/5">
                <span className="text-[9px] font-black uppercase text-[#55556A] tracking-widest">Member</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
