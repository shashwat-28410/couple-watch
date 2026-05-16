import { useEffect } from "react";

/**
 * Floating toast notification.
 * Props:
 *   message  — string or null (null = hidden)
 *   onDismiss — callback to clear the message
 *   duration  — ms before auto-dismiss (default 3000)
 */
export default function Toast({ message, onDismiss, duration = 3000 }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [message, duration, onDismiss]);

  if (!message) return null;

  return (
    <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none">
      <div className="animate-in slide-in-from-top-4 fade-in duration-300">
        <div className="px-6 py-3 rounded-full bg-[#1A1A1F] border border-[#881337]/40 shadow-[0_10px_40px_rgba(0,0,0,0.7)] text-white text-[12px] font-black uppercase tracking-[0.15em] flex items-center gap-3 whitespace-nowrap">
          {message}
        </div>
      </div>
    </div>
  );
}
