import { useEffect } from 'react'
import { cn } from '../../lib/cn'
import type { Toast, ToastTone } from './useToasts'

const DISMISS_MS = 3200

const tones: Record<ToastTone, string> = {
  neutral: 'border-border bg-surface-raised text-primary',
  good: 'border-good/40 bg-good-subtle text-good',
  critical: 'border-critical/40 bg-critical-subtle text-critical',
}

/** Renders the toasts from `useToasts`. Pin one per surface. */
export function ToastViewport({
  toasts,
  onDismiss,
  className,
}: {
  toasts: readonly Toast[]
  onDismiss: (id: number) => void
  className?: string
}) {
  return (
    // aria-live announces the toast without moving focus.
    <div
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col gap-2',
        className,
      )}
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastRow({
  toast,
  onDismiss,
}: {
  toast: Toast
  onDismiss: (id: number) => void
}) {
  useEffect(() => {
    const handle = setTimeout(() => onDismiss(toast.id), DISMISS_MS)
    return () => clearTimeout(handle)
  }, [toast.id, onDismiss])

  return (
    <div
      className={cn(
        'pointer-events-auto rounded-lg border px-3.5 py-2.5 text-xs shadow-md',
        'motion-safe:animate-toast-in',
        tones[toast.tone],
      )}
    >
      {toast.message}
    </div>
  )
}
