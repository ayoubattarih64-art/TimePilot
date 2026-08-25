import { Bell, Compass, ExternalLink, Focus, Timer } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  formatDayLabel,
  formatRelativeStart,
  formatTimeOfDay,
} from '../../lib/activityFormat'
import { CATEGORY_BG } from '../../lib/categoryColors'
import { categoryOf } from '../../models'
import { Button, SectionHeader } from '../../components/ui'
import { useActivities } from '../../hooks/useActivities'
import { useNow } from '../../hooks/useNow'
import { useSchedule } from '../../hooks/useSchedule'
import { setIntent, type Intent } from '../../services/intent'
import { openInCurrentWindow } from '../../services/sidePanel'

/**
 * Quick-action surface, not a small dashboard.
 *
 * The popup is destroyed on blur, so it reads fresh on every open and holds no
 * state worth keeping. It shows one thing — the next activity — and three ways
 * out: two that create, one that opens the real application. It shares the
 * panel's tokens, icons and interactions so the two read as one product.
 */
export function Popup() {
  const now = useNow(15_000)
  const { activities, loading } = useActivities()
  const { next } = useSchedule(activities, now)

  /**
   * Every action here ends the same way: open the panel and close the popup.
   * The panel owns the editors, so creation requests are parked in session
   * storage for it to pick up — this window is gone by the time it mounts.
   */
  const openPanel = (intent?: Intent) => {
    void (async () => {
      if (intent) await setIntent(intent)
      await openInCurrentWindow()
      window.close()
    })()
  }

  return (
    <div className="flex w-80 flex-col bg-surface">
      <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-3">
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent text-on-accent"
          aria-hidden="true"
        >
          <Compass size={13} strokeWidth={2.25} />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">
          TimePilot
        </p>
        <p className="tabular shrink-0 text-2xs text-muted">
          {formatTimeOfDay(now)}
        </p>
      </header>

      <div className="px-4 pb-3">
        <SectionHeader title="Next" className="mb-2" />
        {next ? (
          <div className="rounded-lg border border-border-subtle bg-surface-raised p-3 shadow-xs">
            <div className="flex items-start gap-2">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  CATEGORY_BG[categoryOf(next.activity).slot]
                }`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-primary">
                  {next.activity.title}
                </p>
                <p className="mt-0.5 text-xs text-secondary">
                  {`${formatDayLabel(next.at, now)} · ${formatTimeOfDay(next.at)}`}
                </p>
              </div>
            </div>
            <p className="tabular mt-2 text-xs font-medium text-accent">
              {formatRelativeStart(next.at, now)}
            </p>
          </div>
        ) : (
          <p className="rounded-lg bg-surface-sunken px-3 py-4 text-center text-xs text-secondary">
            {loading ? 'Loading…' : 'Nothing scheduled.'}
          </p>
        )}
      </div>

      <div className="px-4 pb-3">
        <SectionHeader title="Quick actions" className="mb-2" />
        <div className="grid grid-cols-3 gap-2">
          <QuickAction
            icon={<Bell size={16} strokeWidth={2} />}
            label="Reminder"
            onClick={() =>
              openPanel({ kind: 'new-activity', type: 'reminder' })
            }
          />
          <QuickAction
            icon={<Timer size={16} strokeWidth={2} />}
            label="Timer"
            onClick={() => openPanel({ kind: 'open-timer' })}
          />
          <QuickAction
            icon={<Focus size={16} strokeWidth={2} />}
            label="Focus"
            onClick={() => openPanel({ kind: 'open-focus' })}
          />
        </div>
      </div>

      <div className="border-t border-border-subtle p-3">
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          onClick={() => openPanel()}
          iconLeft={<ExternalLink size={14} strokeWidth={2} aria-hidden="true" />}
        >
          Open TimePilot
        </Button>
      </div>
    </div>
  )
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex min-w-0 flex-col items-center justify-center gap-1 rounded-md ' +
        'border border-border-subtle bg-surface-raised px-1.5 py-2.5 ' +
        'text-secondary shadow-xs transition-colors duration-150 ease-tp ' +
        'hover:border-border hover:bg-surface-hover hover:text-primary ' +
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
      }
    >
      <span aria-hidden="true" className="shrink-0">
        {icon}
      </span>
      <span className="w-full truncate text-center text-2xs font-medium">
        {label}
      </span>
    </button>
  )
}
