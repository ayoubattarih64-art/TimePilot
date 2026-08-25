import { useCallback, useState, type ReactNode } from 'react'
import { Check, Pause, Play, Square, Timer as TimerIcon } from 'lucide-react'
import { Button, Choice, Input, SectionHeader } from '../../../components/ui'
import { cn } from '../../../lib/cn'
import { formatClock } from '../../../lib/time'
import { useNow } from '../../../hooks/useNow'
import {
  clampTimerMinutes,
  timerRemainingMs,
  TIMER_ADD_MINUTES,
  TIMER_PRESET_MINUTES,
  MAX_TIMER_MINUTES,
  MIN_TIMER_MINUTES,
  type NewTimerSession,
  type TimerSession,
} from '../../../models'

export type TimerProps = {
  /** The live timer — running or paused — or null. */
  timer: TimerSession | null
  /** The most recently settled timer, for the completed state. */
  last: TimerSession | null
  loading: boolean
  busy: boolean
  onStart: (input: NewTimerSession) => void
  onPause: () => void
  onResume: () => void
  onAdd: (minutes: number) => void
  onCancel: () => void
  /** Set while a start was refused because a timer was already live. */
  conflict: boolean
  onDismissConflict: () => void
}

/**
 * The Timer page: a plain countdown and nothing else.
 *
 * The same rules as Focus, minus everything that makes focus focus — no
 * blocklist, no activity link, no concentration copy. The number is derived
 * from the persisted `endsAt`/`remainingMs` on every render; the one-second
 * ticker only decides when to look again, never what the clock is. Paused
 * timers read their frozen `remainingMs`, which is what makes "close the
 * panel, come back later" lose nothing.
 */
export function Timer({
  timer,
  last,
  loading,
  busy,
  onStart,
  onPause,
  onResume,
  onAdd,
  onCancel,
  conflict,
  onDismissConflict,
}: TimerProps) {
  const [setup, setSetup] = useState(false)
  const [acknowledged, setAcknowledged] = useState<string | null>(null)

  const openSetup = useCallback(() => {
    onDismissConflict()
    setSetup(true)
  }, [onDismissConflict])

  const start = useCallback(
    (input: NewTimerSession) => {
      setSetup(false)
      onStart(input)
    },
    [onStart],
  )

  if (timer) {
    return (
      <Running
        timer={timer}
        busy={busy}
        conflict={conflict}
        onDismissConflict={onDismissConflict}
        onPause={onPause}
        onResume={onResume}
        onAdd={onAdd}
        onCancel={onCancel}
      />
    )
  }

  if (setup) {
    return <Setup busy={busy} onStart={start} onCancel={() => setSetup(false)} />
  }

  // A cancelled timer says nothing worth a screen of its own; only a
  // completed one is reported.
  const completed =
    last !== null && last.status === 'completed' && last.id !== acknowledged
      ? last
      : null

  if (completed) {
    return (
      <Completed
        timer={completed}
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
 * gets, exactly as on Focus — the two surfaces are siblings, not twins.
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
    <Shell label="Timer">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
        <span
          className="grid h-12 w-12 place-items-center rounded-full bg-surface-sunken text-secondary"
          aria-hidden="true"
        >
          <TimerIcon size={22} strokeWidth={1.75} />
        </span>
        <div>
          <p className="text-lg font-semibold text-primary">
            A countdown, nothing more.
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-secondary">
            Pick a length and TimePilot will tell you when it is up — the panel
            can close, the browser can restart.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={onStart} disabled={loading}>
          Start Timer
        </Button>
      </div>
    </Shell>
  )
}

/** Choose a length, optionally name it. Presets first, custom behind a choice. */
function Setup({
  busy,
  onStart,
  onCancel,
}: {
  busy: boolean
  onStart: (input: NewTimerSession) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState<number>(TIMER_PRESET_MINUTES[4])
  const [custom, setCustom] = useState('')
  const [customOpen, setCustomOpen] = useState(false)

  const customMinutes = Number(custom)
  const customValid =
    custom.trim().length > 0 &&
    Number.isFinite(customMinutes) &&
    customMinutes >= MIN_TIMER_MINUTES &&
    customMinutes <= MAX_TIMER_MINUTES
  const resolvedMinutes = customOpen
    ? customValid
      ? clampTimerMinutes(customMinutes)
      : null
    : minutes
  const canStart = resolvedMinutes !== null

  return (
    <Shell label="New timer">
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canStart || resolvedMinutes === null) return
          onStart({ title, durationMinutes: resolvedMinutes })
        }}
      >
        <Input
          label="Title"
          hint="Optional. Shown on the completion notification."
          placeholder="Tea"
          value={title}
          maxLength={60}
          onChange={(event) => setTitle(event.target.value)}
        />

        <fieldset className="flex flex-col gap-2.5">
          <legend className="text-xs font-medium text-secondary">
            For how long?
          </legend>
          <div className="flex flex-wrap gap-2">
            {TIMER_PRESET_MINUTES.map((preset) => (
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
            <Choice selected={customOpen} onClick={() => setCustomOpen(true)}>
              Custom
            </Choice>
          </div>

          {customOpen ? (
            <Input
              label="Minutes"
              type="number"
              inputMode="numeric"
              min={MIN_TIMER_MINUTES}
              max={MAX_TIMER_MINUTES}
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              error={
                custom.trim().length > 0 && !customValid
                  ? `Between ${String(MIN_TIMER_MINUTES)} and ${String(MAX_TIMER_MINUTES)} minutes.`
                  : undefined
              }
              hint={`${String(MIN_TIMER_MINUTES)}–${String(MAX_TIMER_MINUTES)} minutes.`}
            />
          ) : null}
        </fieldset>

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!canStart || busy}
          >
            Start Timer
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
 * The live timer.
 *
 * The countdown re-renders every second while running, but the number comes
 * from `timerRemainingMs(timer, now)` — a pure read of the persisted fields.
 * While paused, the same read returns the frozen figure, so the displayed
 * time does not move between renders.
 */
function Running({
  timer,
  busy,
  conflict,
  onDismissConflict,
  onPause,
  onResume,
  onAdd,
  onCancel,
}: {
  timer: TimerSession
  busy: boolean
  conflict: boolean
  onDismissConflict: () => void
  onPause: () => void
  onResume: () => void
  onAdd: (minutes: number) => void
  onCancel: () => void
}) {
  const now = useNow(1000)
  const paused = timer.status === 'paused'
  const left = timerRemainingMs(timer, now)
  const clock = formatClock(left)
  const total = Math.max(1, timer.plannedMs)
  const progress = Math.min(100, Math.max(0, ((total - left) / total) * 100))

  return (
    <Shell label={paused ? 'Paused' : 'Timer'}>
      {conflict ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-raised px-4 py-3"
        >
          <p className="text-xs text-secondary">A timer is already running.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onDismissConflict}>
              Open current timer
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={busy}
            >
              Cancel current timer
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
        {timer.title !== 'Timer' ? (
          <p className="max-w-full truncate text-sm font-medium text-secondary">
            {timer.title}
          </p>
        ) : null}
        {/* Announcements are off: a clock that changes every second would talk
            over everything else. The label carries the time left, so a screen
            reader reads it on demand as one phrase rather than digit by digit. */}
        <p
          role="timer"
          aria-live="off"
          aria-label={`${clock} ${paused ? 'paused' : 'remaining'}`}
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
          aria-label={`${clock} of ${formatClock(timer.plannedMs)} ${paused ? 'paused' : 'remaining'}`}
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-1000 ease-linear',
              paused ? 'bg-border-strong' : 'bg-accent',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

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

        {/* Adding time is offered in both live states: running extends the
            end, paused grows what is left. */}
        <div className="grid grid-cols-2 gap-2">
          {TIMER_ADD_MINUTES.map((minutes) => (
            <Button
              key={minutes}
              variant="secondary"
              size="md"
              disabled={busy}
              onClick={() => onAdd(minutes)}
              className="tabular"
            >
              {`+${String(minutes)} min`}
            </Button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="md"
          fullWidth
          onClick={onCancel}
          disabled={busy}
          iconLeft={<Square size={14} strokeWidth={2} aria-hidden="true" />}
        >
          Cancel Timer
        </Button>
      </div>
    </Shell>
  )
}

/** Reached zero. Says so, and offers the one thing worth offering. */
function Completed({
  timer,
  onAcknowledge,
  onStartAnother,
}: {
  timer: TimerSession
  onAcknowledge: () => void
  onStartAnother: () => void
}) {
  return (
    <Shell label="Timer">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
        <span
          className="grid h-12 w-12 place-items-center rounded-full bg-good-subtle text-good motion-safe:animate-check-in"
          aria-hidden="true"
        >
          <Check size={22} strokeWidth={2} />
        </span>
        <div>
          <p className="text-lg font-semibold text-primary">Time is up.</p>
          {/* Only a named timer has anything to add; the default title would
              just repeat the heading above. */}
          {timer.title !== 'Timer' ? (
            <p className="mt-1.5 text-xs text-secondary">{timer.title}</p>
          ) : null}
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
