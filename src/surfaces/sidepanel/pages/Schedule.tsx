import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { startOfLocalDay } from '../../../lib/time'
import { formatDayLabel } from '../../../lib/activityFormat'
import type { ScheduledActivity } from '../../../models'
import { IconButton, SectionHeader } from '../../../components/ui'
import {
  ActivityEmptyState,
  TimelineItem,
} from '../../../components/activities'
import { occurrencesOnDay } from '../../../hooks/useSchedule'

export type ScheduleProps = {
  activities: readonly ScheduledActivity[]
  now: number
  onSelect: (activity: ScheduledActivity) => void
}

const DAY_MS = 86_400_000

/** One day at a time, steppable. A month grid does not fit a narrow panel. */
export function Schedule({ activities, now, onSelect }: ScheduleProps) {
  const [offset, setOffset] = useState(0)

  const dayStart = startOfLocalDay(now + offset * DAY_MS)
  const occurrences = occurrencesOnDay(activities, dayStart)
  const fullDate = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(dayStart)

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold text-primary">Schedule</h1>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-raised px-2 py-2">
        <IconButton
          label="Previous day"
          icon={<ChevronLeft size={16} strokeWidth={2} />}
          onClick={() => setOffset((value) => value - 1)}
        />
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold text-primary">
            {formatDayLabel(dayStart, now)}
          </p>
          <p className="truncate text-2xs text-muted">{fullDate}</p>
        </div>
        <IconButton
          label="Next day"
          icon={<ChevronRight size={16} strokeWidth={2} />}
          onClick={() => setOffset((value) => value + 1)}
        />
      </div>

      {offset !== 0 ? (
        <button
          type="button"
          onClick={() => setOffset(0)}
          className={
            'self-center rounded-md px-2 py-1 text-2xs font-medium text-accent ' +
            'transition-colors duration-150 ease-tp hover:bg-accent-subtle ' +
            'focus-visible:outline-2 focus-visible:outline-offset-2 ' +
            'focus-visible:outline-accent'
          }
        >
          Back to today
        </button>
      ) : null}

      <SectionHeader
        title="Timeline"
        trailing={
          occurrences.length > 0 ? `${String(occurrences.length)} planned` : undefined
        }
      />

      {occurrences.length > 0 ? (
        <ul className="flex flex-col">
          {occurrences.map(({ activity, at }) => (
            <li key={`${activity.id}-${String(at)}`}>
              <TimelineItem
                activity={activity}
                at={at}
                past={at < now}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ActivityEmptyState reason="day" size="compact" />
      )}
    </div>
  )
}
