import { Bell, ChevronRight, Focus, Repeat, ShieldOff, Timer as TimerIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  formatDayLabel,
  formatRelativeStart,
  formatTimeOfDay,
  greetingFor,
} from '../../../lib/activityFormat'
import { CATEGORY_BG } from '../../../lib/categoryColors'
import { cn } from '../../../lib/cn'
import { formatClock } from '../../../lib/time'
import {
  categoryOf,
  describeDays,
  focusRemainingMs,
  timerRemainingMs,
  type ActivityType,
  type FocusSession,
  type Routine,
  type TimerSession,
} from '../../../models'
import { SectionHeader } from '../../../components/ui'
import {
  ActivityEmptyState,
  ActivityTypeBadge,
  TimelineItem,
} from '../../../components/activities'
import { useNow } from '../../../hooks/useNow'
import type { Occurrence } from '../../../hooks/useSchedule'
import type { BlockingStatus } from '../../../background/features/blocking'

export type HomeProps = {
  now: number
  next: Occurrence | null
  today: readonly Occurrence[]
  loading: boolean
  /** The live focus session, when there is one. */
  focus: FocusSession | null
  /** The live timer, when there is one. */
  timer: TimerSession | null
  /** What is blocked right now, read back from Chrome. Null before the first reply. */
  blocking: BlockingStatus | null
  /** The routine starting soonest, with the instant it starts. Omitted if none. */
  nextRoutine?: { routine: Routine; at: number } | null
  onNewActivity: (type: ActivityType) => void
  onSelect: (id: string) => void
  onGoToFocus: () => void
  onGoToTimer: () => void
  onGoToRoutines: () => void
  onGoToSettings: () => void
}

/** "Thursday, 20 August" — orientation, not a clock. */
function formatLongDate(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(at)
}

/**
 * Home answers one question: what matters right now?
 *
 * There is exactly one focal point at a time — a running focus session above
 * everything, otherwise a running timer, otherwise the next thing — and one
 * clear distinction between the two active states: focus is an intentional
 * concentration session and keeps the hero; a timer is a countdown and either
 * takes the hero (when focus is quiet) or recedes to a single row beneath it.
 * Everything else stays quiet: the next routine is a row, the rest of today
 * is a timeline, and the quick actions sit at the bottom where they never
 * compete with the answer. Insights live on Insights.
 */
export function Home({
  now,
  next,
  today,
  loading,
  focus,
  timer,
  blocking,
  nextRoutine = null,
  onNewActivity,
  onSelect,
  onGoToFocus,
  onGoToTimer,
  onGoToRoutines,
  onGoToSettings,
}: HomeProps) {
  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="min-w-0 truncate text-lg font-semibold text-primary">
            {greetingFor(now)}
          </h1>
          <p className="shrink-0 truncate text-2xs text-muted">
            {formatLongDate(now)}
          </p>
        </div>
        <p className="text-xs text-secondary">
          {focus
            ? 'A focus session is running.'
            : timer
              ? 'A timer is running.'
              : next
                ? "Here's what's coming up."
                : loading
                  ? 'Loading your schedule…'
                  : 'Nothing scheduled. Add something when you are ready.'}
        </p>
      </header>

      {focus ? (
        <ActiveFocusCard session={focus} onOpen={onGoToFocus} />
      ) : timer ? (
        <ActiveTimerCard timer={timer} onOpen={onGoToTimer} />
      ) : next ? (
        <NextCard occurrence={next} now={now} onSelect={onSelect} />
      ) : (
        <ActivityEmptyState
          size="compact"
          reason={loading ? 'day' : 'none'}
          onCreate={loading ? undefined : () => onNewActivity('reminder')}
        />
      )}

      {/* Focus outranks the timer: when both run, the timer stays visible as
          one quiet row rather than a second hero. */}
      {focus && timer ? (
        <TimerRow timer={timer} onOpen={onGoToTimer} />
      ) : null}

      {/* Blocking is a status, not a hero: one quiet line whenever rules are
          in force, whichever side activated them. */}
      {blocking?.active && blocking.lists.length > 0 ? (
        <BlockingRow blocking={blocking} onOpen={onGoToSettings} />
      ) : null}

      {nextRoutine && !focus && !timer ? (
        <NextRoutineRow
          routine={nextRoutine.routine}
          at={nextRoutine.at}
          now={now}
          onOpen={onGoToRoutines}
        />
      ) : null}

      <section className="flex flex-col gap-1.5">
        <SectionHeader
          title="Today"
          trailing={
            today.length > 0 ? `${String(today.length)} planned` : undefined
          }
        />
        {today.length > 0 ? (
          <ul className="flex flex-col">
            {today.map(({ activity, at }) => (
              <li key={`${activity.id}-${String(at)}`}>
                <TimelineItem
                  activity={activity}
                  at={at}
                  past={at < now}
                  onSelect={() => onSelect(activity.id)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <ActivityEmptyState size="compact" reason="day" />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeader title="Quick actions" />
        {/* One row of four: they are actions, not content — a 2×2 grid would
            give them more visual weight than the timeline above them. */}
        <div className="grid grid-cols-4 gap-2">
          <QuickAction
            icon={<Bell size={16} strokeWidth={2} />}
            label="Reminder"
            onClick={() => onNewActivity('reminder')}
          />
          <QuickAction
            icon={<TimerIcon size={16} strokeWidth={2} />}
            label="Timer"
            onClick={onGoToTimer}
          />
          <QuickAction
            icon={<Focus size={16} strokeWidth={2} />}
            label="Focus"
            onClick={onGoToFocus}
          />
          <QuickAction
            icon={<Repeat size={16} strokeWidth={2} />}
            label="Routines"
            onClick={onGoToRoutines}
          />
        </div>
      </section>
    </div>
  )
}

/**
 * A running session is Home's hero, and the only accent-tinted thing on the
 * page. The countdown comes from the persisted `endsAt` on a one-second
 * clock, and the progress bar is the same read expressed as a fraction of
 * the planned length — nothing is counted down in component state.
 */
function ActiveFocusCard({
  session,
  onOpen,
}: {
  session: FocusSession
  onOpen: () => void
}) {
  const now = useNow(1000)
  const paused = session.status === 'paused'
  const left = focusRemainingMs(session, now)
  const clock = formatClock(left)
  const total = Math.max(1, session.plannedMs)
  const progress = Math.min(100, Math.max(0, ((total - left) / total) * 100))

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group w-full rounded-lg border border-accent-border bg-accent-subtle p-4 text-left',
        'transition-colors duration-150 ease-tp hover:border-accent/50',
        'motion-safe:animate-rise-in',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-medium text-accent">
          {paused ? 'Focus · paused' : 'Focusing'}
        </p>
        <ChevronRight
          size={16}
          strokeWidth={2}
          aria-hidden="true"
          className="shrink-0 text-muted transition-transform duration-150 ease-tp group-hover:translate-x-0.5"
        />
      </div>

      <p className="mt-1 truncate text-base font-semibold text-primary">
        {session.title}
      </p>
      <p className="tabular mt-1 text-2xl font-semibold text-primary">
        {clock}
      </p>

      <div
        className="mt-3 h-1 overflow-hidden rounded-full bg-accent/15"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${clock} ${paused ? 'paused' : 'remaining'} of ${formatClock(session.plannedMs)}`}
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${progress}%` }}
        />
      </div>
    </button>
  )
}

/**
 * The next thing, when nothing is running. A quiet raised card — clearly
 * secondary to the focus hero it stands in for, still the page's focal
 * point by being the first content block.
 */
function NextCard({
  occurrence,
  now,
  onSelect,
}: {
  occurrence: Occurrence
  now: number
  onSelect: (id: string) => void
}) {
  const { activity, at } = occurrence
  const category = categoryOf(activity)

  return (
    <button
      type="button"
      onClick={() => onSelect(activity.id)}
      className={cn(
        'group w-full rounded-lg border border-border-subtle bg-surface-raised p-4 text-left shadow-xs',
        'transition-colors duration-150 ease-tp hover:border-border hover:bg-surface-hover',
        'motion-safe:animate-rise-in',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${CATEGORY_BG[category.slot]}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-primary">
            {activity.title}
          </p>
          <p className="mt-0.5 text-xs text-secondary">
            {`${formatDayLabel(at, now)} · ${formatTimeOfDay(at)}`}
          </p>
          <p className="tabular mt-1.5 text-sm font-medium text-accent">
            {formatRelativeStart(at, now)}
          </p>
        </div>
        <ChevronRight
          size={16}
          strokeWidth={2}
          aria-hidden="true"
          className="mt-1 shrink-0 text-muted transition-transform duration-150 ease-tp group-hover:translate-x-0.5"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <ActivityTypeBadge type={activity.type} />
        <span className="text-2xs text-muted">{category.name}</span>
        {activity.durationMinutes > 0 ? (
          <span className="tabular text-2xs text-muted">
            {activity.durationMinutes} min
          </span>
        ) : null}
      </div>
    </button>
  )
}

/**
 * The routine starting soonest — a pointer, not a second Routines page. One
 * quiet row: what, when it repeats, and how far away it is.
 */
function NextRoutineRow({
  routine,
  at,
  now,
  onOpen,
}: {
  routine: Routine
  at: number
  now: number
  onOpen: () => void
}) {
  const steps = routine.steps.length

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group -mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-md px-2 py-2 text-left',
        'transition-colors duration-150 ease-tp hover:bg-surface-hover',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
      )}
    >
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-sunken text-secondary"
        aria-hidden="true"
      >
        <Repeat size={15} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-primary">
          {routine.name}
        </span>
        <span className="block truncate text-2xs text-muted">
          {`${describeDays(routine)} · ${routine.startTime} · ${
            steps === 1 ? '1 step' : `${String(steps)} steps`
          }`}
        </span>
      </span>
      <span className="tabular shrink-0 text-2xs font-medium text-secondary">
        {formatRelativeStart(at, now)}
      </span>
      <ChevronRight
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        className="shrink-0 text-muted transition-transform duration-150 ease-tp group-hover:translate-x-0.5"
      />
    </button>
  )
}

/**
 * A running timer takes the hero only when no focus session does. Visually the
 * focus hero's sibling, labelled so the two active states are never confused:
 * the kicker says Timer, the icon says Timer, and the copy never mentions
 * concentration.
 */
function ActiveTimerCard({
  timer,
  onOpen,
}: {
  timer: TimerSession
  onOpen: () => void
}) {
  const now = useNow(1000)
  const paused = timer.status === 'paused'
  const left = timerRemainingMs(timer, now)
  const clock = formatClock(left)
  const total = Math.max(1, timer.plannedMs)
  const progress = Math.min(100, Math.max(0, ((total - left) / total) * 100))

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group w-full rounded-lg border border-accent-border bg-accent-subtle p-4 text-left',
        'transition-colors duration-150 ease-tp hover:border-accent/50',
        'motion-safe:animate-rise-in',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-accent">
          <TimerIcon size={13} strokeWidth={2} aria-hidden="true" />
          <span className="truncate">
            {timer.title !== 'Timer' ? timer.title : 'Timer'}
            {paused ? ' · paused' : ''}
          </span>
        </p>
        <ChevronRight
          size={16}
          strokeWidth={2}
          aria-hidden="true"
          className="shrink-0 text-muted transition-transform duration-150 ease-tp group-hover:translate-x-0.5"
        />
      </div>

      <p className="tabular mt-1 text-2xl font-semibold text-primary">
        {clock}
      </p>

      <div
        className="mt-3 h-1 overflow-hidden rounded-full bg-accent/15"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${clock} ${paused ? 'paused' : 'remaining'} of ${formatClock(timer.plannedMs)}`}
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${progress}%` }}
        />
      </div>
    </button>
  )
}

/**
 * The timer when focus outranks it: one quiet row, the same shape as the
 * next-routine row, so the page keeps a single focal point.
 */
function TimerRow({
  timer,
  onOpen,
}: {
  timer: TimerSession
  onOpen: () => void
}) {
  const now = useNow(1000)
  const paused = timer.status === 'paused'
  const clock = formatClock(timerRemainingMs(timer, now))

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group -mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-md px-2 py-2 text-left',
        'transition-colors duration-150 ease-tp hover:bg-surface-hover',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
      )}
    >
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-sunken text-secondary"
        aria-hidden="true"
      >
        <TimerIcon size={15} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-primary">
          {timer.title !== 'Timer' ? timer.title : 'Timer'}
        </span>
        <span className="block truncate text-2xs text-muted">
          {paused ? 'Timer · paused' : 'Timer running'}
        </span>
      </span>
      <span className="tabular shrink-0 text-sm font-semibold text-primary">
        {clock}
      </span>
      <ChevronRight
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        className="shrink-0 text-muted transition-transform duration-150 ease-tp group-hover:translate-x-0.5"
      />
    </button>
  )
}

/**
 * Blocking as a quiet status row: what is being kept away, and the way to the
 * place that can change it. Never competes with the hero — the hero above it
 * says what the user is doing, this says what is being kept out of the way.
 */
function BlockingRow({
  blocking,
  onOpen,
}: {
  blocking: BlockingStatus
  onOpen: () => void
}) {
  const first = blocking.lists[0]
  const summary =
    blocking.lists.length === 1
      ? `${first.name} · ${
          first.domainCount === 1 ? '1 site' : `${String(first.domainCount)} sites`
        }`
      : `${String(blocking.lists.length)} blocklists`

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group -mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-md px-2 py-2 text-left',
        'transition-colors duration-150 ease-tp hover:bg-surface-hover',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
      )}
    >
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-sunken text-secondary"
        aria-hidden="true"
      >
        <ShieldOff size={15} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-primary">
          Blocking active
        </span>
        <span className="block truncate text-2xs text-muted">{summary}</span>
      </span>
      <ChevronRight
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        className="shrink-0 text-muted transition-transform duration-150 ease-tp group-hover:translate-x-0.5"
      />
    </button>
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
        'flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-md ' +
        'border border-border-subtle bg-surface-raised px-2 py-2.5 ' +
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
