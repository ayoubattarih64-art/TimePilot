import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type TabItem<T extends string = string> = {
  value: T
  label: ReactNode
  /** Optional trailing count, e.g. a number of activities. */
  count?: number
}

export type TabsProps<T extends string = string> = {
  items: ReadonlyArray<TabItem<T>>
  value: T
  onChange: (next: T) => void
  className?: string
}

/**
 * Segmented control following the WAI-ARIA tabs pattern: arrow keys move
 * between tabs, only the active tab is in the tab sequence.
 *
 * A contained track with a raised active pill rather than an underline — at
 * panel widths an underline fights with the page's own hairlines, and the
 * pill keeps the selected state obvious without colour alone (position plus
 * the raised surface carry it too).
 */
export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  className,
}: TabsProps<T>) {
  const baseId = useId()

  const move = (delta: number) => {
    const index = items.findIndex((item) => item.value === value)
    if (index === -1) return
    const next = items[(index + delta + items.length) % items.length]
    onChange(next.value)
    document.getElementById(`${baseId}-${next.value}`)?.focus()
  }

  return (
    <div
      role="tablist"
      className={cn(
        'flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5',
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          move(1)
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          move(-1)
        }
      }}
    >
      {items.map((item) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            id={`${baseId}-${item.value}`}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              'min-w-0 flex-1 rounded-md px-2 py-1.5 text-xs font-medium',
              'transition-colors duration-150 ease-tp',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
              selected
                ? 'bg-surface-raised text-primary shadow-xs'
                : 'text-secondary hover:text-primary',
            )}
          >
            <span className="truncate">{item.label}</span>
            {typeof item.count === 'number' ? (
              <span className="tabular ml-1.5 text-2xs text-muted">
                {item.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
