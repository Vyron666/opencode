import { AnimatePresence, motion } from 'framer-motion'

export default function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.24)] backdrop-blur-sm"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="w-[400px] max-w-[88vw] rounded-[24px] border border-[var(--line)] bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.16)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <h2 className="text-base font-bold text-[var(--text)]">{title}</h2>
              {message ? <p className="mt-2 text-sm text-[var(--text-dim)]">{message}</p> : null}
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-[10px] border border-[var(--line)] bg-[var(--surface-muted)] px-5 py-2.5 text-sm font-semibold text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-strong)]"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                autoFocus
                className={`rounded-[10px] border px-5 py-2.5 text-sm font-semibold transition-colors ${
                  danger
                    ? 'border-danger bg-danger text-white hover:brightness-95'
                    : 'border-brand bg-brand text-white hover:bg-[var(--brand-strong)]'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
