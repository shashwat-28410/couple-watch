/** Animated pulse skeleton matching the HistoryCard layout. */
export default function HistorySkeleton() {
  return (
    <div className="romantic-card border-white/5 animate-pulse">
      {/* Thumbnail placeholder */}
      <div className="aspect-video bg-white/[0.04] rounded-[16px] mb-4" />
      {/* Title placeholder */}
      <div className="h-3.5 bg-white/[0.04] rounded-full w-3/4 mb-2" />
      {/* Date placeholder */}
      <div className="h-2.5 bg-white/[0.03] rounded-full w-1/2" />
    </div>
  );
}
