import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type SheetProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
}

/**
 * A bottom sheet for the side panel. Built on native <dialog> for the same
 * reasons as Dialog (focus trap, Escape, top layer), but sized to the panel: it
 * fills the width and rises from the bottom edge, which is the only modal shape
 * that works at ~320–400px without feeling cramped.
 *
 * Use it for editors and multi-field forms; use Dialog for short confirmations.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  /** The control that had focus when the sheet was opened. */
  const openerRef = useRef<HTMLElement | null>(null)

  /**
   * Put focus back where it was before the sheet opened.
   *
   * A native <dialog> does this itself, but only when `close()` runs on a node
   * that is still in the document. Callers that remount the form per open (see
   * ActivityEditor's key) unmount the dialog the instant `open` flips false, so
   * the node is already detached by the time any cleanup runs and the browser
   * has nothing to restore to — focus lands on <body> and keyboard users lose
   * their place in the list. Remembering the opener makes the restore
   * independent of when the node goes away. When the browser did restore focus
   * itself this is a no-op on the same element.
   */
  const restoreFocus = useCallback(() => {
    const opener = openerRef.current
    openerRef.current = null
    if (opener?.isConnected) opener.focus()
  }, [])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) {
      const active = document.activeElement
      openerRef.current = active instanceof HTMLElement ? active : null
      node.showModal()
    }
    if (!open && node.open) node.close()
  }, [open])

  // A sheet may be unmounted while still open (a caller that remounts the form
  // per session does exactly that). Closing it explicitly lets the browser run
  // its close steps, and the explicit restore covers the case where the node is
  // already detached and those steps can no longer reach the opener.
  useEffect(() => {
    const node = ref.current
    return () => {
      if (node?.open) node.close()
      restoreFocus()
    }
  }, [restoreFocus])

  return (
    <dialog
      ref={ref}
      aria-label={typeof title === 'string' ? title : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={() => {
        restoreFocus()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      className={cn(
        // mt-auto pins it to the bottom; max-h keeps the header reachable.
        'mt-auto mb-0 max-h-[92vh] w-full max-w-none',
        'rounded-t-lg border-t border-border bg-surface-raised p-0',
        'text-primary shadow-lg backdrop:bg-black/35',
        'motion-safe:animate-sheet-in',
      )}
    >
      <div
        className="flex max-h-[92vh] flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        {/* The grabber: the affordance that says "this rises from below and
            can be dismissed" without a label or an extra close button. */}
        <div
          aria-hidden="true"
          className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border-strong/60"
        />

        <header className="shrink-0 px-5 pt-3 pb-4">
          <h2 className="text-lg font-semibold text-primary">{title}</h2>
          {description ? (
            <p className="mt-1 text-xs text-secondary">{description}</p>
          ) : null}
        </header>

        {/* Only the body scrolls, so the footer's actions stay visible. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">{children}</div>

        {footer ? (
          <footer className="shrink-0 border-t border-border-subtle px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  )
}
