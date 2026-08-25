import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_TYPES,
  CUSTOM_CATEGORY_ID,
  nextOccurrenceOf,
  type ScheduledActivity,
} from '../../../models'
import { Button, SectionHeader, Select } from '../../../components/ui'
import {
  ActivityCard,
  ActivityEmptyState,
} from '../../../components/activities'

export type ActivitiesProps = {
  activities: readonly ScheduledActivity[]
  /** Fire time per activity id, from chrome.alarms. Absent = no alarm. */
  scheduledTimes: Readonly<Record<string, number>>
  now: number
  loading: boolean
  onCreate: () => void
  onEdit: (activity: ScheduledActivity) => void
  onDelete: (activity: ScheduledActivity) => void
  onToggleEnabled: (activity: ScheduledActivity, enabled: boolean) => void
  onComplete: (activity: ScheduledActivity) => void
  onSnooze: (activity: ScheduledActivity, minutes: number) => void
}

const TYPE_FILTER = [
  { value: 'all', label: 'All types' },
  ...ACTIVITY_TYPES.map((type) => ({
    value: type,
    label: type === 'reminder' ? 'Reminders' : 'Timers',
  })),
]

const CATEGORY_FILTER = [
  { value: 'all', label: 'All categories' },
  ...ACTIVITY_CATEGORIES.map((category) => ({
    value: category.id,
    label: category.name,
  })),
  { value: CUSTOM_CATEGORY_ID, label: 'Custom' },
]

/** Every activity the user has, filterable, newest occurrence first. */
export function Activities({
  activities,
  scheduledTimes,
  now,
  loading,
  onCreate,
  onEdit,
  onDelete,
  onToggleEnabled,
  onComplete,
  onSnooze,
}: ActivitiesProps) {
  const [type, setType] = useState('all')
  const [category, setCategory] = useState('all')

  const visible = useMemo(() => {
    const filtered = activities.filter(
      (activity) =>
        (type === 'all' || activity.type === type) &&
        (category === 'all' || activity.categoryId === category),
    )
    // Upcoming first; anything with no future occurrence sinks to the bottom.
    return [...filtered].sort((a, b) => {
      const aNext = nextOccurrenceOf(a, now)
      const bNext = nextOccurrenceOf(b, now)
      if (aNext === null && bNext === null) return a.createdAt - b.createdAt
      if (aNext === null) return 1
      if (bNext === null) return -1
      return aNext - bNext
    })
  }, [activities, type, category, now])

  const filtering = type !== 'all' || category !== 'all'

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-primary">Activities</h1>
        <Button
          variant="primary"
          size="sm"
          onClick={onCreate}
          iconLeft={<Plus size={14} strokeWidth={2.5} aria-hidden="true" />}
        >
          New
        </Button>
      </div>

      {/* Filters in one row above the list; both shrink rather than overflow. */}
      <div className="grid grid-cols-2 gap-2">
        <Select
          selectSize="sm"
          options={TYPE_FILTER}
          value={type}
          aria-label="Filter by type"
          onChange={(event) => setType(event.target.value)}
        />
        <Select
          selectSize="sm"
          options={CATEGORY_FILTER}
          value={category}
          aria-label="Filter by category"
          onChange={(event) => setCategory(event.target.value)}
        />
      </div>

      <SectionHeader
        title="All activities"
        trailing={
          loading ? 'Loading…' : `${String(visible.length)} of ${String(activities.length)}`
        }
      />

      {/* One surface, hairline-divided rows — the list reads as a list rather
          than a stack of boxes. overflow-hidden keeps row hover backgrounds
          inside the container's corners. */}
      {visible.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">
          {visible.map((activity) => (
            <li key={activity.id}>
              <ActivityCard
                activity={activity}
                now={now}
                scheduledAt={scheduledTimes[activity.id]}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggleEnabled={onToggleEnabled}
                onComplete={onComplete}
                onSnooze={onSnooze}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ActivityEmptyState
          reason={filtering ? 'filtered' : 'none'}
          onCreate={onCreate}
        />
      )}
    </div>
  )
}
