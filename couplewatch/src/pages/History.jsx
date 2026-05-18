import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Navbar from "../components/Navbar";
import HistoryCard from "../components/HistoryCard";
import HistorySkeleton from "../components/HistorySkeleton";
import ConfirmModal from "../components/ConfirmModal";

export default function History() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [continueWatching, setContinueWatching] = useState([]);
  const [recentHistory, setRecentHistory] = useState([]);
  const [stats, setStats] = useState({ totalSessions: 0, totalHours: 0, totalMinutes: 0 });
  const [isHistoryEnabled, setIsHistoryEnabled] = useState(() => localStorage.getItem("couplewatch_history_enabled") === "true");
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [deletingEntry, setDeletingEntry] = useState(null);

  const toggleHistory = () => {
    const newVal = !isHistoryEnabled;
    setIsHistoryEnabled(newVal);
    localStorage.setItem("couplewatch_history_enabled", newVal.toString());
  };

  useEffect(() => {
    async function load() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) { navigate("/"); return; }
      setUser(authUser);

      const { data: history, error } = await supabase
        .from("watch_history")
        .select("*")
        .contains("participants", [authUser.id])
        .order("started_at", { ascending: false })
        .limit(60);

      if (!error && history) {
        // Continue watching: active sessions with meaningful progress
        const continueList = history.filter(
          (h) => !h.ended_at && h.last_position_seconds > 10
        );
        // Recent completed or long-enough sessions
        const recentList = history.filter(
          (h) => h.ended_at || h.total_watched_seconds >= 60
        );

        setContinueWatching(continueList.slice(0, 6));
        setRecentHistory(recentList.slice(0, 16));

        // Compute stats
        const totalSecs = history.reduce((acc, h) => acc + (h.total_watched_seconds || 0), 0);
        const totalHours = Math.floor(totalSecs / 3600);
        const totalMinutes = Math.floor((totalSecs % 3600) / 60);
        setStats({ totalSessions: history.length, totalHours, totalMinutes });
      }
      setLoading(false);
    }
    load();
  }, [navigate]);

  const handleRewatch = async (entry) => {
    setLoading(true);
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) { navigate("/"); return; }

    const generateRoomCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();
    const code = generateRoomCode();
    
    // Create new room and set state directly with the video URL and position
    const { data: room } = await supabase.from("rooms").insert([{ room_code: code, created_by: authUser.id }]).select().single();
    await supabase.from("room_members").insert([{ room_id: room.id, user_id: authUser.id, role: "host" }]);
    await supabase.from("room_state").insert([{ 
      room_id: room.id, 
      is_playing: false, 
      current_timestamp_seconds: entry.last_position_seconds || 0,
      video_url: entry.video_url || null
    }]);

    navigate(`/room/${code}`);
  };

  const handleDeleteEntry = async () => {
    if (!deletingEntry || !user) return;
    const { error } = await supabase.from("watch_history").delete().eq("id", deletingEntry.id);
    if (!error) {
      setContinueWatching(prev => prev.filter(h => h.id !== deletingEntry.id));
      setRecentHistory(prev => prev.filter(h => h.id !== deletingEntry.id));
    }
    setDeletingEntry(null);
  };

  const handleClearHistory = async () => {
    if (!user) return;
    const { error } = await supabase.from("watch_history").delete().contains("participants", [user.id]);
    if (!error) {
      setContinueWatching([]);
      setRecentHistory([]);
      setStats({ totalSessions: 0, totalHours: 0, totalMinutes: 0 });
    }
    setShowConfirmClear(false);
  };

  const statCards = [
    { label: "Sessions Together", value: stats.totalSessions, icon: (
      <svg className="w-8 h-8 text-[#BE123C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
    )},
    {
      label: "Hours Watched",
      value: stats.totalHours > 0 ? `${stats.totalHours}h ${stats.totalMinutes}m` : `${stats.totalMinutes}m`,
      icon: (
        <svg className="w-8 h-8 text-[#BE123C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex flex-col font-sans">
      <div className="w-full absolute top-0 z-50">
        <Navbar user={user} />
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar pt-32 pb-20 px-4 md:px-8">
        <div className="max-width-container mx-auto">

          {/* Header */}
          <div className="mb-12 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <h1 className="text-4xl font-black tracking-tight uppercase italic text-primary-gradient leading-none mb-3">
                Watch History
              </h1>
              <p className="text-[#8B8B9A] text-sm">Your shared moments together ❤️</p>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={toggleHistory}
                className={`px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-2 ${isHistoryEnabled ? 'bg-green-900/20 border-green-500/30 text-green-400' : 'bg-white/5 border-white/10 text-[#55556A] hover:text-white'}`}
              >
                <div className={`w-2 h-2 rounded-full ${isHistoryEnabled ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-[#33334A]'}`}></div>
                History: {isHistoryEnabled ? 'Enabled' : 'Disabled'}
              </button>
              {(recentHistory.length > 0 || continueWatching.length > 0) && (
                <button
                  onClick={() => setShowConfirmClear(true)}
                  className="px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-white/5 border border-white/10 text-[#55556A] hover:bg-rose-900/20 hover:border-rose-500/30 hover:text-rose-400 transition-all"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-6 mb-16">
            {statCards.map((s) => (
              <div
                key={s.label}
                className="romantic-card border-white/5 flex flex-col items-center text-center py-7 bg-white/[0.015]"
              >
                <span className="text-3xl mb-3">{s.icon}</span>
                <span className="text-2xl md:text-3xl font-black text-white mb-1">
                  {loading ? (
                    <span className="inline-block w-12 h-7 bg-white/5 rounded-full animate-pulse" />
                  ) : (
                    s.value
                  )}
                </span>
                <span className="text-[8px] font-black uppercase tracking-[0.35em] text-[#55556A]">
                  {s.label}
                </span>
              </div>
            ))}
          </div>

          {/* Continue Watching */}
          {(loading || continueWatching.length > 0) && (
            <section className="mb-14">
              <h2 className="text-[10px] font-black uppercase tracking-[0.45em] text-[#8B8B9A] mb-6 flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#881337] shadow-[0_0_8px_#881337] animate-pulse" />
                Continue Watching
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading
                  ? Array(3).fill(0).map((_, i) => <HistorySkeleton key={i} />)
                  : continueWatching.map((entry) => (
                      <HistoryCard key={entry.id} entry={entry} onRewatch={handleRewatch} onDelete={setDeletingEntry} />
                    ))}
              </div>
            </section>
          )}

          {/* Recently Watched Together */}
          <section>
            <h2 className="text-[10px] font-black uppercase tracking-[0.45em] text-[#8B8B9A] mb-6 flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[#881337] shadow-[0_0_8px_#881337]" />
              Recently Watched Together
            </h2>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {Array(8).fill(0).map((_, i) => <HistorySkeleton key={i} />)}
              </div>
            ) : recentHistory.length === 0 && continueWatching.length === 0 ? (
              /* Empty state */
              <div className="romantic-card border-white/5 flex flex-col items-center justify-center py-32 text-center mt-4">
                <span className="text-[80px] mb-8 opacity-20 transition-transform hover:scale-110">📽️</span>
                <p className="text-[11px] font-black uppercase tracking-[0.4em] text-[#55556A] mb-2">
                  No watch history yet
                </p>
                <p className="text-[#33334A] text-sm">
                  Start watching together to see your shared history here ❤️
                </p>
                <button
                  onClick={() => navigate("/")}
                  className="mt-10 pill-button bg-primary-gradient text-white px-12 shadow-[0_10px_25px_rgba(136,19,55,0.25)]"
                >
                  Start Watching
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {recentHistory.map((entry) => (
                  <HistoryCard key={entry.id} entry={entry} onRewatch={handleRewatch} onDelete={setDeletingEntry} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <ConfirmModal 
        isOpen={!!deletingEntry} 
        onCancel={() => setDeletingEntry(null)} 
        onConfirm={handleDeleteEntry} 
        title="Delete Session?"
        description="Are you sure you want to remove this memory? This cannot be undone."
      />

      <ConfirmModal 
        isOpen={showConfirmClear} 
        onCancel={() => setShowConfirmClear(false)} 
        onConfirm={handleClearHistory} 
        title="Clear All History?"
        description="This will permanently delete your entire shared watch history. Proceed?"
      />
    </div>
  );
}
