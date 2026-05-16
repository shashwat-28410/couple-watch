/**
 * Confirmation modal using the existing CoupleWatch design language.
 * Props:
 *   isOpen       — boolean
 *   title        — string
 *   description  — string
 *   confirmLabel — string (default "Confirm")
 *   onConfirm    — callback
 *   onCancel     — callback
 *   loading      — boolean (shows spinner on confirm button)
 *   danger       — boolean (red confirm button instead of rose gradient)
 */
export default function ConfirmModal({
  isOpen,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
  loading = false,
  danger = false,
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal card */}
      <div className="relative z-10 romantic-card max-w-md w-full shadow-[0_30px_80px_rgba(0,0,0,0.85)] border-[#881337]/30 animate-in zoom-in-95 fade-in duration-200">
        <h3 className="text-base font-black uppercase tracking-[0.25em] text-white mb-3">
          {title}
        </h3>
        <p className="text-[#8B8B9A] text-sm leading-relaxed mb-8">
          {description}
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-3 rounded-full border border-white/10 text-white/60 text-[10px] font-black uppercase tracking-widest hover:bg-white/5 transition-all disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-3 rounded-full text-white text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
              danger
                ? "bg-red-700 hover:bg-red-600 shadow-[0_0_20px_rgba(185,28,28,0.3)]"
                : "bg-primary-gradient hover:opacity-90 shadow-[0_0_20px_rgba(136,19,55,0.25)]"
            }`}
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
