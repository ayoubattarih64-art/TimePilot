import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type DialogProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** Width cap. Extension surfaces are narrow, so `sm` is the default. */
  size?: 'sm' | 'md'
}

/**
 * Built on the native <dialog> element, which gives focus trapping, Escape
 * handling, inert background content, and the top-layer backdrop for free —
 * all things a hand-rolled modal has to reimplement and usually gets wrong.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'sm',
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      // Fires on Escape and on close(); keeps React state in sync with the DOM.
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={onClose}
      // Clicks land on the dialog itself only when they hit the backdrop area.
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-lg border border-border bg-surface-raised p-0',
        'text-primary shadow-lg backdrop:bg-black/35',
        'motion-safe:animate-dialog-in',
        size === 'sm' ? 'max-w-sm' : 'max-w-lg',
      )}
    >
      {/* Inner wrapper so backdrop clicks are distinguishable from content clicks. */}
      <div className="p-6" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-lg font-semibold text-primary">{title}</h2>
        {description ? (
          <p className="mt-1.5 text-sm text-secondary">{description}</p>
        ) : null}
        {children ? <div className="mt-5">{children}</div> : null}
        {footer ? (
          <div className="mt-6 flex items-center justify-end gap-2">{footer}</div>
        ) : null}
      </div>
    </dialog>
  )
}
