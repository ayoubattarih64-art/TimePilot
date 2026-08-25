import { cn } from '../../lib/cn'
import { formatDuration } from '../../lib/time'

/**
 * A column chart of focus time, drawn with plain divs.
 *
 * No chart library: the data is a handful of numbers and the panel is narrow,
 * so scaled divs with text labels do everything a library would — and stay
 * readable, dark-mode-correct and motion-free by construction. Values are in
 * the accessible label as well as on the axis, so the chart never relies on
 * bar height (or colour) alone to carry meaning.
 */

export type ChartBar = {
  /** Visible axis label. Empty string leaves an unlabelled slot. */
  label: string
  /** What screen readers and tooltips call this bar. */
  name: string
  valueMs: number
}

export type FocusChartProps = {
  bars: readonly ChartBar[]
  /** Noun for the accessible summary, e.g. "Focus time". */
  ariaLabel: string
  className?: string
}

export function FocusChart({ bars, ariaLabel, className }: FocusChartProps) {
  const max = Math.max(1, ...bars.map((bar) => bar.valueMs))
  const summary = bars
    .filter((bar) => bar.valueMs > 0)
    .map((bar) => `${bar.name} ${formatDuration(bar.valueMs)}`)
    .join(', ')

  return (
    <div
      role="img"
      aria-label={
        summary
          ? `${ariaLabel}. ${summary}`
          : `${ariaLabel}. No time recorded.`
      }
      className={cn('flex items-end gap-[3px]', className)}
    >
      {bars.map((bar, index) => {
        const share = bar.valueMs / max
        return (
          <div
            key={index}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            title={`${bar.name}: ${bar.valueMs > 0 ? formatDuration(bar.valueMs) : 'no focus'}`}
          >
            <div className="flex h-24 w-full max-w-3.5 flex-col justify-end self-center rounded-sm bg-surface-sunken">
              <div
                className={cn(
                  'w-full rounded-sm bg-accent',
                  bar.valueMs > 0 && 'min-h-[3px]',
                )}
                style={{
                  height: `${Math.max(share * 100, bar.valueMs > 0 ? 3 : 0)}%`,
                }}
              />
            </div>
            {/* Fixed height whether or not this slot carries a label, so every
                bar sits on the same baseline. */}
            <span className="h-4 text-2xs leading-4 tabular text-muted">
              {bar.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
