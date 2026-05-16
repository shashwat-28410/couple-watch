/** Human-readable relative time string. */
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/** Format seconds into h/m string. */
function formatDuration(seconds) {
  if (!seconds || seconds < 60) return "<1m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * A single watch history card.
 * Props:
 *   entry     — watch_history row from Supabase
 *   onRewatch — callback(entry) when user clicks to re-watch
 */
export default function HistoryCard({ entry, onRewatch }) {
  // Progress: ratio of last_position to estimated total
  // We store total_watched_seconds as the running watch time, not the video duration.
  // Use last_position_seconds as proxy for progress out of a rough estimate.
  const hasProgress = entry.last_position_seconds > 0;
  const isCompleted = !!entry.ended_at;
  const isContinuable = hasProgress && !isCompleted;

  return (
    <div
      className="romantic-card border-white/5 hover:-translate-y-2 hover:scale-[1.02] hover:border-[#881337]/40 hover:shadow-[0_25px_50px_rgba(136,19,55,0.25)] transition-all duration-300 cursor-pointer group"
      onClick={() => onRewatch && onRewatch(entry)}
    >
      {/* Thumbnail area */}
      <div className="h-40 bg-[#0D0D12] rounded-[16px] mb-5 overflow-hidden relative border border-white/[0.04] transition-transform duration-300 group-hover:scale-[1.03]">
        {/* Fallback icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-5xl opacity-10 group-hover:opacity-20 transition-opacity duration-300">
            🎬
          </span>
        </div>

        {/* Progress bar */}
        {hasProgress && (
          <div
            className="absolute bottom-0 left-0 h-[3px] bg-primary-gradient transition-all duration-500"
            style={{
              width: `${Math.min(100, (entry.last_position_seconds / Math.max(entry.last_position_seconds, entry.total_watched_seconds || 1)) * 100)}%`,
            }}
          />
        )}

        {/* Duration badge */}
        {entry.total_watched_seconds > 0 && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-[8px] font-black uppercase tracking-widest text-white/50">
            {formatDuration(entry.total_watched_seconds)}
          </div>
        )}

        {/* Completed badge */}
        {isCompleted && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-green-900/60 backdrop-blur-sm text-[8px] font-black uppercase tracking-widest text-green-400">
            ✓ Watched
          </div>
        )}
      </div>

      {/* Info */}
      <p className="text-[15px] font-black text-white truncate mb-2 leading-tight">
        {entry.video_title || "Untitled Video"}
      </p>
      <p className="text-[10px] font-black text-[#8B8B9A] uppercase tracking-[0.2em]">
        {timeAgo(entry.started_at)}
      </p>

      {/* Continue chip */}
      {isContinuable && (
        <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#881337]/10 border border-[#881337]/25 text-[8px] font-black uppercase tracking-widest text-[#BE123C]">
          ▶ Continue Watching
        </div>
      )}
    </div>
  );
}
