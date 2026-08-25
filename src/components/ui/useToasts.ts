import { useCallback, useMemo, useState } from 'react'

export type ToastTone = 'neutral' | 'good' | 'critical'

export type Toast = {
  id: number
  message: string
  tone: ToastTone
}

/**
 * Toast state as a hook rather than a context provider. Each surface owns one
 * instance and renders one <ToastViewport>; there is no cross-surface toast to
 * share, so a provider would only add a wrapper.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback((message: string, tone: ToastTone = 'neutral') => {
    // Date.now() can repeat within a tick; the random suffix keeps keys unique.
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, message, tone }])
  }, [])

  return useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss])
}
