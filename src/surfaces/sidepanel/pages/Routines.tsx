import { useState } from 'react'
import { CalendarClock, Plus } from 'lucide-react'
import type { Routine } from '../../../models'
import { Button, EmptyState } from '../../../components/ui'
import { RoutineCard } from '../../../components/routines'

export type RoutinesProps = {
  routines: readonly Routine[]
  /** Generated activities per routine id, counted from the activity list. */
  generated: Readonly<Record<string, number>>
  now: number
  loading: boolean
  busy: boolean
  onCreate: () => void
  onEdit: (routine: Routine) => void
  onToggleEnabled: (routine: Routine, enabled: boolean) => void
}

/**
 * The Routines page: a reusable plan per row, and the way to make another.
 *
 * Deliberately a list and not a calendar. A routine has no dates of its own —
 * it has days of the week and a start time — so there is nothing a month grid
 * would show that "Every weekday · 07:00" does not say more briefly.
 *
 * Sorted by start time so the page reads down the day.
 */
export function Routines({
  routines,
  generated,
  now,
  loading,
  busy,
  onCreate,
  onEdit,
  onToggleEnabled,
}: RoutinesProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const ordered = [...routines].sort((a, b) =>
    a.startTime === b.startTime
      ? a.createdAt - b.createdAt
      : a.startTime.localeCompare(b.startTime),
  )

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-primary">Routines</h1>
          <p className="mt-0.5 text-xs text-secondary">
            A reusable plan. Its steps become scheduled activities.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={onCreate}
          iconLeft={<Plus size={14} strokeWidth={2.5} aria-hidden="true" />}
        >
          New
        </Button>
      </div>

      {ordered.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">
          {ordered.map((routine) => (
            <li key={routine.id}>
              <RoutineCard
                routine={routine}
                generated={generated[routine.id] ?? 0}
                now={now}
                busy={busy}
                expanded={expanded === routine.id}
                onToggleExpanded={() =>
                  setExpanded((current) =>
                    current === routine.id ? null : routine.id,
                  )
                }
                onEdit={onEdit}
                onToggleEnabled={onToggleEnabled}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<CalendarClock size={22} strokeWidth={1.75} />}
          title={loading ? 'Loading routines…' : 'No routines yet'}
          description={
            loading
              ? undefined
              : 'Build one for the part of the day you repeat — a morning start, a study block, an evening wind-down.'
          }
          action={
            loading ? undefined : (
              <Button
                variant="primary"
                size="sm"
                onClick={onCreate}
                iconLeft={
                  <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
                }
              >
                Create routine
              </Button>
            )
          }
        />
      )}
    </div>
  )
}
