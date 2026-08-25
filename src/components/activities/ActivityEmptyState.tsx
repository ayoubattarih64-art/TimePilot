import { CalendarPlus } from 'lucide-react'
import { EmptyState } from '../ui/EmptyState'
import { Button } from '../ui/Button'

export type ActivityEmptyStateProps = {
  onCreate?: () => void
  /** `filtered` explains a search/filter with no matches instead of an empty list. */
  reason?: 'none' | 'filtered' | 'day'
  size?: 'compact' | 'full'
}

const copy = {
  none: {
    title: 'No activities yet',
    description:
      'Add a reminder or a timer and TimePilot will keep track of when it is due.',
  },
  filtered: {
    title: 'Nothing matches',
    description: 'Try a different type or category.',
  },
  day: {
    title: 'Nothing scheduled',
    description: 'This day is clear.',
  },
} as const

/** The empty state for any list of activities. */
export function ActivityEmptyState({
  onCreate,
  reason = 'none',
  size = 'full',
}: ActivityEmptyStateProps) {
  const { title, description } = copy[reason]

  return (
    <EmptyState
      size={size}
      icon={<CalendarPlus size={22} strokeWidth={1.75} />}
      title={title}
      description={description}
      action={
        onCreate && reason !== 'filtered' ? (
          <Button variant="primary" size="sm" onClick={onCreate}>
            New activity
          </Button>
        ) : undefined
      }
    />
  )
}
