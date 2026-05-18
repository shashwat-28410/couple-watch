import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";

export function MemoriesTab({ roomId, user }) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!roomId) return;

    const fetchMemories = async () => {
      const { data, error } = await supabase
        .from("room_memories")
        .select("*, profiles(full_name)")
        .eq("room_id", roomId)
        .order("created_at", { ascending: false });

      if (!error) setMemories(data);
      setLoading(false);
    };

    fetchMemories();

    // Subscribe to new memories
    const channel = supabase
      .channel(`room_memories_${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "room_memories", filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", payload.new.user_id)
            .single();
          
          const newMemory = { ...payload.new, profiles: profile };
          setMemories(prev => [newMemory, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center space-y-4 opacity-20">
        <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-[10px] font-black uppercase tracking-widest">Loading Memories...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-black/10">
        {memories.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-5 opacity-10 py-20">
            <span className="text-5xl grayscale">🎞️</span>
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-[0.4em] italic">No memories yet</p>
              <p className="text-[8px] font-bold uppercase tracking-widest leading-relaxed">Save movies you watch together <br /> to create a shared scrapbook ❤️</p>
            </div>
          </div>
        ) : (
          memories.map((memory) => (
            <div key={memory.id} className="group relative bg-[#1A1A1F] border border-white/5 rounded-2xl p-5 transition-all hover:border-rose-500/30 hover:translate-y-[-2px] shadow-xl overflow-hidden">
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-100 transition-opacity">
                 <span className="text-xs">❤️</span>
              </div>
              
              <div className="flex flex-col gap-3 relative z-10">
                <div className="flex items-start justify-between">
                  <h4 className="text-[13px] font-bold text-white/90 line-clamp-2 leading-tight group-hover:text-rose-400 transition-colors">
                    {memory.title || "Untitled Cinema Night"}
                  </h4>
                </div>
                
                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-rose-500/20 flex items-center justify-center text-[8px]">
                      {memory.profiles?.full_name?.charAt(0) || "U"}
                    </div>
                    <span className="text-[9px] font-black text-[#8B8B9A] uppercase tracking-widest">
                      Saved by {memory.profiles?.full_name?.split(' ')[0] || "Partner"}
                    </span>
                  </div>
                  <span className="text-[8px] font-black text-[#55556A] uppercase tracking-widest">
                    {new Date(memory.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </div>

              {/* Glass reflection effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            </div>
          ))
        )}
      </div>
      
      <div className="p-5 border-t border-white/5 bg-black/40 backdrop-blur-md">
        <p className="text-[8px] text-center font-black text-[#55556A] uppercase tracking-[0.3em]">
          Building our shared history, one frame at a time
        </p>
      </div>
    </div>
  );
}
