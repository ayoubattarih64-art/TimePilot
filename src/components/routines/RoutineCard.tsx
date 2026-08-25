import { ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import {
  describeDays,
  nextRoutineStart,
  routineCategoryOf,
  routineDurationMinutes,
  stepStartTimes,
  type Routine,
  type RoutineStep,
} from '../../models'
import { formatDayLabel, formatTimeOfDay } from '../../lib/activityFormat'
import { Badge, IconButton, Switch } from '../ui'

export type RoutineCardProps = {
  routine: Routine
  /** How many scheduled activities this routine currently owns, if known. */
  generated?: number
  now: number
  expanded: boolean
  busy: boolean
  onToggleExpanded: () => void
  onEdit: (routine: Routine) => void
  onToggleEnabled: (routine: Routine, enabled: boolean) => void
}

const STEP_LABELS: Record<RoutineStep['type'], string> = {
  reminder: 'Reminder',
  timer: 'Timer',
  focus: 'Focus',
}

/**
 * One routine as a row in the grouped list: name, when it runs, how many
 * steps — the three things the list exists to show — plus the switch that
 * says whether it schedules anything at all. Everything else is behind the
 * disclosure, so a page with eight routines is still a short page.
 *
 * The step times shown when expanded come from `stepStartTimes`, the same
 * function the planner uses, so what the card says and what will be scheduled
 * cannot drift apart.
 */
export function RoutineCard({
  routine,
  generated,
  now,
  expanded,
  busy,
  onToggleExpanded,
  onEdit,
  onToggleEnabled,
}: RoutineCardProps) {
  const times = stepStartTimes(routine)
  const startsAt = nextRoutineStart(routine, now)
  const category = routineCategoryOf(routine)
  const total = routineDurationMinutes(routine)
  const steps = routine.steps.length

  return (
    <div className="group relative">
      <div className="flex items-center gap-1 px-3 py-3">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggleExpanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="shrink-0 text-muted" aria-hidden="true">
            {expanded ? (
              <ChevronDown size={15} strokeWidth={2} />
            ) : (
              <ChevronRight size={15} strokeWidth={2} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 truncate text-sm font-medium text-primary">
                {routine.name}
              </span>
              {!routine.enabled ? (
                <Badge tone="neutral" className="shrink-0">
                  Paused
                </Badge>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-2xs text-muted">
              {`${describeDays(routine)} · ${routine.startTime}`}
            </span>
            <span className="mt-0.5 block truncate text-2xs text-muted">
              {steps === 1 ? '1 step' : `${String(steps)} steps`}
              {total > 0 ? ` · ${String(total)} min` : ''}
              {routine.enabled && startsAt !== null
                ? ` · next ${formatDayLabel(startsAt, now).toLowerCase()} ${formatTimeOfDay(startsAt)}`
                : ''}
            </span>
          </span>
        </button>

        <IconButton
          label={`Edit ${routine.name}`}
          icon={<Pencil size={14} strokeWidth={2} />}
          onClick={() => onEdit(routine)}
          className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        />
        <Switch
          label={
            routine.enabled
              ? `Pause ${routine.name}`
              : `Resume ${routine.name}`
          }
          checked={routine.enabled}
          disabled={busy}
          onChange={(enabled) => onToggleEnabled(routine, enabled)}
        />
      </div>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3">
          {routine.description ? (
            <p className="text-xs leading-relaxed text-secondary">
              {routine.description}
            </p>
          ) : null}

          {steps > 0 ? (
            <ol className="flex flex-col gap-1">
              {routine.steps.map((step, index) => (
                <li
                  key={step.id}
                  className="flex items-center gap-2 rounded-md bg-surface-sunken px-2.5 py-1.5"
                >
                  <span className="tabular shrink-0 text-2xs font-medium text-accent">
                    {times[index]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-primary">
                    {step.title}
                  </span>
                  <span className="shrink-0 text-2xs text-muted">
                    {STEP_LABELS[step.type]}
                    {step.durationMinutes > 0
                      ? ` · ${String(step.durationMinutes)} min`
                      : ''}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-2xs text-muted">
              No steps yet. A routine with no steps schedules nothing.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted">
            {category ? <span>{category.name}</span> : null}
            <span>
              {generated === undefined
                ? null
                : generated === 1
                  ? '1 activity scheduled'
                  : `${String(generated)} activities scheduled`}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
