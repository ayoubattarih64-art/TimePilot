import { useCallback, useState, type ReactNode } from 'react'
import { Check, Focus as FocusIcon, Pause, Play, Shield, Square } from 'lucide-react'
import { Button, Choice, Input, SectionHeader, Select } from '../../../components/ui'
import { cn } from '../../../lib/cn'
import { formatClock, formatDuration } from '../../../lib/time'
import { useNow } from '../../../hooks/useNow'
import type { BlockingStatus } from '../../../background/features/blocking'
import {
  clampFocusMinutes,
  focusRemainingMs,
  FOCUS_PRESET_MINUTES,
  MAX_FOCUS_MINUTES,
  MIN_FOCUS_MINUTES,
  type Blocklist,
  type FocusSession,
  type NewFocusSession,
  type ScheduledActivity,
} from '../../../models'

export type FocusProps = {
  /** The live session — running or paused — or null. */
  session: FocusSession | null
  /** The most recently settled session, for the completed state. */
  last: FocusSession | null
  loading: boolean
  busy: boolean
  activities: readonly ScheduledActivity[]
  /** Lists the user can choose from. Only enabled, non-empty ones can block. */
  blocklists: readonly Blocklist[]
  /** What Chrome actually holds. Null until the worker has answered. */
  blocking: BlockingStatus | null
  onStart: (input: NewFocusSession) => void
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  /** Set while a start was refused because a session was already live. */
  conflict: boolean
  onDismissConflict: () => void
}

/** Free-text title rather than an existing activity. */
const CUSTOM_VALUE = '__custom__'

/** "None" in the blocklist picker. A session without one is still a session. */
const NO_BLOCKLIST = '__none__'

/**
 * The Focus page.
 *
 * A concentration environment, not a dashboard: one thing on screen at a
 * time, no badges, no counts, no decoration. A running session is a title
 * and a countdown, and the countdown is derived from the session's persisted
 * `endsAt` on every render — never counted down in the component — so closing
 * the panel, losing the worker, or restarting the browser leaves it correct.
 *
 * The blocking line follows the same rule for the same reason: it renders the
 * status the worker read back from Chrome, so it can only ever report protection
 * that exists.
 */
export function Focus({
  session,
  last,
  loading,
  busy,
  activities,
  blocklists,
  blocking,
  onStart,
  onPause,
  onResume,
  onCancel,
  conflict,
  onDismissConflict,
}: FocusProps) {
  const [setup, setSetup] = useState(false)
  const [acknowledged, setAcknowledged] = useState<string | null>(null)

  const openSetup = useCallback(() => {
    onDismissConflict()
    setSetup(true)
  }, [onDismissConflict])

  const start = useCallback(
    (input: NewFocusSession) => {
      setSetup(false)
      onStart(input)
    },
    [onStart],
  )

  if (session) {
    return (
      <Running
        session={session}
        blocking={blocking}
        busy={busy}
        conflict={conflict}
        onDismissConflict={onDismissConflict}
        onPause={onPause}
        onResume={onResume}
        onCancel={onCancel}
      />
    )
  }

  if (setup) {
    return (
      <Setup
        activities={activities}
        blocklists={blocklists}
        busy={busy}
        onStart={start}
        onCancel={() => setSetup(false)}
      />
    )
  }

  // A cancelled session says nothing worth a screen of its own — the spec asks
  // for the ordinary state back. Only a completed one is reported.
  const completed =
    last !== null && last.status === 'completed' && last.id !== acknowledged
      ? last
      : null

  if (completed) {
    return (
      <Completed
        session={completed}
        onAcknowledge={() => setAcknowledged(completed.id)}
        onStartAnother={() => {
          setAcknowledged(completed.id)
          setSetup(true)
        }}
      />
    )
  }

  return <Empty loading={loading} onStart={openSetup} />
}

/* --- States --------------------------------------------------------------- */

/**
 * Shared frame. A single quiet label at the top is the only chrome the page
 * gets; everything else is the one thing the user is here for.
 */
function Shell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col gap-6 p-4">
      {/* The Shell's label is the surface's title, so it is the h1. */}
      <SectionHeader title={label} level={1} />
      {children}
    </div>
  )
}

/** Nothing running. One sentence and one way in. */
function Empty({
  loading,
  onStart,
}: {
  loading: boolean
  onStart: () => void
}) {
  return (
    <Shell label="Focus">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
        <span
          className="grid h-12 w-12 place-items-center rounded-full bg-surface-sunken text-secondary"
          aria-hidden="true"
        >
          <FocusIcon size={22} strokeWidth={1.75} />
        </span>
        <div>
          <p className="text-lg font-semibold text-primary">
            Focus on what matters.
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-secondary">
            One thing, for a set stretch of time. TimePilot will tell you when it
            is done.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={onStart} disabled={loading}>
          Start Focus
        </Button>
      </div>
    </Shell>
  )
}

/** Choose what and how long. Presets first, a custom length behind a choice. */
function Setup({
  activities,
  blocklists,
  busy,
  onStart,
  onCancel,
}: {
  activities: readonly ScheduledActivity[]
  blocklists: readonly Blocklist[]
  busy: boolean
  onStart: (input: NewFocusSession) => void
  onCancel: () => void
}) {
  const [source, setSource] = useState<string>(CUSTOM_VALUE)
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState<number>(FOCUS_PRESET_MINUTES[1])
  const [custom, setCustom] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [blocklistId, setBlocklistId] = useState<string>(NO_BLOCKLIST)

  const options = [
    { value: CUSTOM_VALUE, label: 'Something else' },
    ...activities.map((activity) => ({
      value: activity.id,
      label: activity.title,
    })),
  ]

  // Only lists that can actually block are offered: an empty or disabled one
  // would leave the session claiming a blocklist that does nothing.
  const usable = blocklists.filter(
    (list) => list.enabled && list.domains.length > 0,
  )
  const blockOptions = [
    { value: NO_BLOCKLIST, label: 'None' },
    ...usable.map((list) => ({
      value: list.id,
      label: `${list.name} · ${String(list.domains.length)}`,
    })),
  ]

  const chosen = activities.find((activity) => activity.id === source) ?? null
  const resolvedTitle = chosen ? chosen.title : title.trim()
  const customMinutes = Number(custom)
  const customValid =
    custom.trim().length > 0 &&
    Number.isFinite(customMinutes) &&
    customMinutes >= MIN_FOCUS_MINUTES &&
    customMinutes <= MAX_FOCUS_MINUTES
  const resolvedMinutes = customOpen
    ? customValid
      ? clampFocusMinutes(customMinutes)
      : null
    : minutes

  const canStart = resolvedTitle.length > 0 && resolvedMinutes !== null

  return (
    <Shell label="New focus session">
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canStart || resolvedMinutes === null) return
          onStart({
            title: resolvedTitle,
            durationMinutes: resolvedMinutes,
            activityId: chosen?.id ?? null,
            blocklistId: blocklistId === NO_BLOCKLIST ? null : blocklistId,
          })
        }}
      >
        <div className="flex flex-col gap-3">
          {activities.length > 0 ? (
            <Select
              label="Focus on"
              options={options}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
          ) : null}

          {chosen === null ? (
            <Input
              label={activities.length > 0 ? 'What are you focusing on?' : 'Focus on'}
              placeholder="Study"
              value={title}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
            />
          ) : null}
        </div>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="text-xs font-medium text-secondary">
            For how long?
          </legend>
          <div className="flex flex-wrap gap-2">
            {FOCUS_PRESET_MINUTES.map((preset) => (
              <Choice
                key={preset}
                selected={!customOpen && preset === minutes}
                className="tabular"
                onClick={() => {
                  setCustomOpen(false)
                  setMinutes(preset)
                }}
              >
                {`${String(preset)}m`}
              </Choice>
            ))}
            <Choice
              selected={customOpen}
              onClick={() => setCustomOpen(true)}
            >
              Custom
            </Choice>
          </div>

          {customOpen ? (
            <Input
              label="Minutes"
              type="number"
              inputMode="numeric"
              min={MIN_FOCUS_MINUTES}
              max={MAX_FOCUS_MINUTES}
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              error={
                custom.trim().length > 0 && !customValid
                  ? `Between ${String(MIN_FOCUS_MINUTES)} and ${String(MAX_FOCUS_MINUTES)} minutes.`
                  : undefined
              }
              hint={`${String(MIN_FOCUS_MINUTES)}–${String(MAX_FOCUS_MINUTES)} minutes.`}
            />
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          {usable.length > 0 ? (
            <Select
              label="Block distractions"
              options={blockOptions}
              value={blocklistId}
              onChange={(event) => setBlocklistId(event.target.value)}
            />
          ) : (
            <p className="text-2xs text-muted">
              Add a blocklist in Settings to block distracting websites while you
              focus.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!canStart || busy}
          >
            Start Focus
          </Button>
          <Button variant="ghost" size="md" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Shell>
  )
}

/**
 * A session in progress.
 *
 * The countdown re-renders every second, but the number itself comes from
 * `focusRemainingMs(session, now)` — a pure read of the persisted `endsAt`. The
 * interval only decides *when* to look; it is never what the clock is. The
 * progress bar is the same read as a fraction of the planned length, moved by
 * a one-second linear transition so it flows between renders instead of
 * stepping.
 */
function Running({
  session,
  blocking,
  busy,
  conflict,
  onDismissConflict,
  onPause,
  onResume,
  onCancel,
}: {
  session: FocusSession
  blocking: BlockingStatus | null
  busy: boolean
  conflict: boolean
  onDismissConflict: () => void
  onPause: () => void
  onResume: () => void
  onCancel: () => void
}) {
  const now = useNow(1000)
  const paused = session.status === 'paused'
  const left = focusRemainingMs(session, now)
  const clock = formatClock(left)
  const total = Math.max(1, session.plannedMs)
  const progress = Math.min(100, Math.max(0, ((total - left) / total) * 100))

  return (
    <Shell label={paused ? 'Paused' : 'Focusing'}>
      {conflict ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-raised px-4 py-3"
        >
          <p className="text-xs text-secondary">
            A focus session is already running.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onDismissConflict}>
              Open current session
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={busy}
            >
              Cancel current session
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
        <p className="max-w-full truncate text-sm font-medium text-secondary">
          {session.title}
        </p>
        {/* Announcements are off: a clock that changes every second would talk
            over everything else. The label carries the time left, so a screen
            reader reads it on demand as one phrase rather than digit by digit. */}
        <p
          role="timer"
          aria-live="off"
          aria-label={`${clock} remaining`}
          className={cn(
            'tabular text-metric font-semibold',
            paused ? 'text-secondary' : 'text-primary',
          )}
        >
          {clock}
        </p>

        <div
          className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${clock} ${paused ? 'paused' : 'remaining'} of ${formatClock(session.plannedMs)}`}
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-1000 ease-linear',
              paused ? 'bg-border-strong' : 'bg-accent',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        <p className="text-xs text-secondary">
          {paused
            ? 'Paused. The clock is stopped.'
            : 'Stay focused on one thing at a time.'}
        </p>
      </div>

      <BlockingLine session={session} blocking={blocking} paused={paused} />

      <div className="flex flex-col gap-2">
        {paused ? (
          <Button
            variant="primary"
            size="md"
            fullWidth
            onClick={onResume}
            disabled={busy}
            iconLeft={<Play size={15} strokeWidth={2} aria-hidden="true" />}
          >
            Resume
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="md"
            fullWidth
            onClick={onPause}
            disabled={busy}
            iconLeft={<Pause size={15} strokeWidth={2} aria-hidden="true" />}
          >
            Pause
          </Button>
        )}
        <Button
          variant="ghost"
          size="md"
          fullWidth
          onClick={onCancel}
          disabled={busy}
          iconLeft={<Square size={14} strokeWidth={2} aria-hidden="true" />}
        >
          End Session
        </Button>
      </div>
    </Shell>
  )
}

/**
 * One line: what is blocked, and whether it is really in force.
 *
 * The three cases are deliberately distinct. No blocklist chosen says so
 * plainly. Blocking asked for and confirmed by Chrome gets the dot. Blocking
 * asked for and *not* confirmed gets the reason in critical text — the one thing
 * this line may never do is imply protection the network layer is not applying.
 */
function BlockingLine({
  session,
  blocking,
  paused,
}: {
  session: FocusSession
  blocking: BlockingStatus | null
  paused: boolean
}) {
  if (session.blocklistId === null) {
    return (
      <p className="text-center text-2xs text-muted">Blocking: None</p>
    )
  }

  // Paused releases the websites by design, so an inactive status here is the
  // correct outcome rather than a failure worth reporting.
  if (paused) {
    return (
      <p className="text-center text-2xs text-muted">
        Blocking: paused with the session
      </p>
    )
  }

  if (!blocking) {
    return <p className="text-center text-2xs text-muted">Blocking: checking…</p>
  }

  if (blocking.error !== null || !blocking.active) {
    return (
      <p
        role="status"
        className="rounded-md border border-critical/40 bg-critical-subtle px-3 py-2 text-center text-2xs text-critical"
      >
        {blocking.error ?? 'Blocking could not be activated.'}
      </p>
    )
  }

  const focusList = blocking.lists[0]
  return (
    <p className="flex items-center justify-center gap-1.5 text-2xs text-secondary">
      <Shield size={12} strokeWidth={2} aria-hidden="true" />
      <span className="truncate">
        {`Blocking: ${focusList?.name ?? 'websites'}${
          focusList && focusList.domainCount > 0
            ? ` · ${String(focusList.domainCount)} ${
                focusList.domainCount === 1 ? 'site' : 'sites'
              }`
            : ''
        }`}
      </span>
      <span className="text-good" aria-hidden="true">
        ●
      </span>
      <span className="text-good">Active</span>
    </p>
  )
}

/** Reached zero. Says so, and offers the one thing worth offering. */
function Completed({
  session,
  onAcknowledge,
  onStartAnother,
}: {
  session: FocusSession
  onAcknowledge: () => void
  onStartAnother: () => void
}) {
  return (
    <Shell label="Focus">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
        <span
          className="grid h-12 w-12 place-items-center rounded-full bg-good-subtle text-good motion-safe:animate-check-in"
          aria-hidden="true"
        >
          <Check size={22} strokeWidth={2} />
        </span>
        <div>
          <p className="text-lg font-semibold text-primary">
            Focus session complete.
          </p>
          <p className="mt-1.5 text-xs text-secondary">
            {`${session.title} · ${formatDuration(session.plannedMs)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" size="md" onClick={onStartAnother}>
            Start another
          </Button>
          <Button variant="ghost" size="md" onClick={onAcknowledge}>
            Done
          </Button>
        </div>
      </div>
    </Shell>
  )
}
