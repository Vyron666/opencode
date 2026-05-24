import { motion, AnimatePresence } from 'framer-motion'

export default function ConfirmDialog({ open, title, message, onConfirm, onCancel, confirmLabel = '确认', cancelLabel = '取消', danger = false }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="w-[380px] max-w-[88vw] rounded-[24px] border border-[var(--line)] bg-[#1c1713] shadow-2xl p-6 grid gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-base font-bold">{title}</h2>
              {message && <p className="text-sm text-[var(--text-dim)] mt-2">{message}</p>}
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={onCancel}
                className="text-sm px-5 py-2.5 rounded-[10px] font-semibold bg-transparent text-[var(--text-dim)] border border-[var(--line-strong)] hover:bg-black/30 transition-colors focus-visible:ring-2 focus-visible:ring-brand"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                autoFocus
                className={`text-sm px-5 py-2.5 rounded-[10px] font-semibold transition-all focus-visible:ring-2 ${
                  danger
                    ? 'bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 focus-visible:ring-danger'
                    : 'bg-brand text-[#14100d] shadow-glow hover:brightness-110'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
