import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type NavigationItem<T extends string = string> = {
  value: T
  label: string
  icon: ReactNode
}

export type NavigationBarProps<T extends string = string> = {
  items: ReadonlyArray<NavigationItem<T>>
  /** null when the active view is reached from outside the bar (e.g. Settings). */
  value: T | null
  onChange: (next: T) => void
  ariaLabel?: string
  className?: string
}

/**
 * The side panel's primary navigation: a row of icon targets pinned to the
 * bottom edge.
 *
 * Icons only, not icon+label: labelled items at 320px leave ~45px per target
 * once the labels are in, which reads as a toolbar from 2005 — the label row
 * buys nothing a tooltip cannot. Each button keeps its full accessible name,
 * a `title` tooltip for sighted pointer users, a 44px hit height, and an
 * active state carried by a tinted pill (position and tint, never colour
 * alone). Arrow keys walk the bar.
 */
export function NavigationBar<T extends string = string>({
  items,
  value,
  onChange,
  ariaLabel = 'Sections',
  className,
}: NavigationBarProps<T>) {
  /**
   * Move selection one step and take focus with it.
   *
   * Focus has to follow, or the bar cannot be walked: the handler reads the
   * pressed button's own value, so leaving focus behind would make every
   * further press start from the same button and never reach the third item.
   */
  const move = (from: T, delta: number, bar: HTMLElement) => {
    const index = items.findIndex((item) => item.value === from)
    if (index === -1) return
    const next = items[(index + delta + items.length) % items.length]
    if (!next) return
    onChange(next.value)
    bar
      .querySelector<HTMLButtonElement>(
        `[data-nav-value="${CSS.escape(next.value)}"]`,
      )
      ?.focus()
  }

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        'flex shrink-0 items-stretch justify-around gap-0.5',
        'border-t border-border-subtle bg-surface-raised px-2 py-1.5',
        className,
      )}
      onKeyDown={(event) => {
        const current = event.target as HTMLElement
        const pressed = current?.dataset?.navValue as T | undefined
        if (pressed === undefined) return
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          move(pressed, 1, event.currentTarget)
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          move(pressed, -1, event.currentTarget)
        }
      }}
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            data-nav-value={item.value}
            aria-current={active ? 'page' : undefined}
            aria-label={item.label}
            title={item.label}
            onClick={() => onChange(item.value)}
            className={cn(
              'grid h-11 min-w-10 flex-1 place-items-center rounded-md',
              'transition-colors duration-150 ease-tp',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
              active
                ? 'bg-accent-subtle text-accent'
                : 'text-muted hover:bg-surface-hover hover:text-primary',
            )}
          >
            <span aria-hidden="true" className="shrink-0">
              {item.icon}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
