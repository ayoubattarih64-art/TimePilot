import { useMemo, useState, type ReactNode } from 'react'
import {
  Bell,
  Check,
  Compass,
  Focus as FocusIcon,
  Monitor,
  Moon,
  Repeat,
  ShieldOff,
  Sun,
  Timer as TimerIcon,
} from 'lucide-react'
import { Button, Choice, Input } from '../../../components/ui'
import { cn } from '../../../lib/cn'
import { ROUTINE_TEMPLATES, whenChoices } from '../../../lib/onboarding'
import { useTheme, type ThemePreference } from '../../../theme'
import type {
  Blocklist,
  NewRoutine,
  NewScheduledActivity,
  Routine,
} from '../../../models'

export type OnboardingProps = {
  now: number
  /** The saved lists, for the blocking introduction. */
  blocklists: readonly Blocklist[]
  /** True when reopened from Settings rather than shown on a genuine first run. */
  reopened?: boolean
  onCreateActivity: (
    input: NewScheduledActivity,
  ) => Promise<{ ok: boolean; scheduledAt: number | null }>
  onCreateRoutine: (
    input: NewRoutine,
  ) => Promise<{
    ok: boolean
    routine?: Routine | null
    generated?: number
  }>
  /** Finished or dismissed — either way the tour is marked complete. */
  onDone: () => void
}

/**
 * The welcome tour.
 *
 * A first-run overlay for the side panel, not a page in the navigation: the
 * moment it is finished or dismissed it cannot appear again unless the user
 * asks for it from Settings. Every step creates real things through the real
 * paths — the reminder step calls the same create the editor does, the routine
 * step plants a real routine — so what the tour leaves behind is exactly what
 * the user would have built by hand, never a demo copy of it.
 *
 * Two steps are optional by design (reminder, routines): a tour that demands
 * data before it lets you through is a wall, not a welcome.
 */

/** Welcome, reminder, routines, blocking, appearance, done. */
const STEP_COUNT = 6
const LAST_STEP = STEP_COUNT - 1

const THEMES: ReadonlyArray<{
  value: ThemePreference
  label: string
  icon: ReactNode
}> = [
  { value: 'light', label: 'Light', icon: <Sun size={16} strokeWidth={2} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={16} strokeWidth={2} /> },
  {
    value: 'system',
    label: 'System',
    icon: <Monitor size={16} strokeWidth={2} />,
  },
]

export function Onboarding({
  now,
  blocklists,
  reopened = false,
  onCreateActivity,
  onCreateRoutine,
  onDone,
}: OnboardingProps) {
  const [step, setStep] = useState(0)
  const [reminder, setReminder] = useState<{ title: string; whenLabel: string } | null>(null)
  const [addedRoutines, setAddedRoutines] = useState<Record<string, number>>({})
  const last = step === LAST_STEP

  const back = () => setStep((value) => Math.max(0, value - 1))
  const next = () =>
    last ? onDone() : setStep((value) => Math.min(LAST_STEP, value + 1))

  return (
    <div className="flex h-screen flex-col bg-surface">
      {/* The one scrolling region; the footer's actions stay reachable. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5">
        {/* Steps re-mount on change, so the entrance animation marks the move. */}
        <div key={step} className="flex flex-1 flex-col gap-5 py-6 motion-safe:animate-rise-in">
          {step === 0 ? (
            <Welcome reopened={reopened} />
          ) : null}
          {step === 1 ? (
            <ReminderStep
              now={now}
              created={reminder}
              onCreated={setReminder}
              onCreate={onCreateActivity}
            />
          ) : null}
          {step === 2 ? (
            <RoutinesStep
              added={addedRoutines}
              onAdded={(templateId, generated) =>
                setAddedRoutines((current) => ({
                  ...current,
                  [templateId]: generated,
                }))
              }
              onCreate={onCreateRoutine}
            />
          ) : null}
          {step === 3 ? <BlockingStep blocklists={blocklists} /> : null}
          {step === 4 ? <AppearanceStep /> : null}
          {step === 5 ? <Done reminder={reminder} routines={addedRoutines} /> : null}
        </div>
      </main>

      <footer className="flex shrink-0 flex-col gap-3 border-t border-border-subtle bg-surface-raised px-5 py-4">
        <Progress step={step} count={STEP_COUNT} />
        <div className="flex items-center justify-between gap-2">
          {step > 0 ? (
            <Button variant="ghost" size="md" onClick={back}>
              Back
            </Button>
          ) : (
            <Button variant="ghost" size="md" onClick={onDone}>
              Skip
            </Button>
          )}
          <Button variant="primary" size="md" onClick={next}>
            {last ? 'Finish' : 'Next'}
          </Button>
        </div>
      </footer>
    </div>
  )
}

/* --- Shared pieces --------------------------------------------------------- */

function Brand() {
  return (
    <span
      className="grid h-10 w-10 place-items-center rounded-md bg-accent text-on-accent"
      aria-hidden="true"
    >
      <Compass size={20} strokeWidth={2.25} />
    </span>
  )
}

function StepTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-lg font-semibold text-primary">{children}</h1>
}

function StepBody({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-secondary">{children}</p>
}

/** Dots plus a spoken position, so the progress never rests on colour alone. */
function Progress({ step, count }: { step: number; count: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      <span className="sr-only" aria-live="polite">
        {`Step ${String(step + 1)} of ${String(count)}`}
      </span>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cn(
            'h-1.5 rounded-full transition-all duration-150 ease-tp',
            index === step
              ? 'w-4 bg-accent'
              : index < step
                ? 'w-1.5 bg-accent/50'
                : 'w-1.5 bg-border-strong/60',
          )}
        />
      ))}
    </div>
  )
}

/* --- Steps ----------------------------------------------------------------- */

function Welcome({ reopened }: { reopened: boolean }) {
  return (
    <>
      <Brand />
      <div className="flex flex-col gap-1">
        <StepTitle>{reopened ? 'Welcome back.' : 'Welcome to TimePilot.'}</StepTitle>
        <StepBody>
          A private place for your time: reminders and timers, focus sessions
          with website blocking, and routines that repeat. Everything stays on
          this device.
        </StepBody>
      </div>

      <ul className="flex flex-col gap-2.5">
        {[
          {
            icon: <Bell size={15} strokeWidth={2} />,
            title: 'Reminders & timers',
            line: 'Notifications for what you plan, countdowns for what you cook, brew, or wait out.',
          },
          {
            icon: <FocusIcon size={15} strokeWidth={2} />,
            title: 'Focus & blocking',
            line: 'A session timer that can keep distracting websites away until it ends.',
          },
          {
            icon: <Repeat size={15} strokeWidth={2} />,
            title: 'Routines',
            line: 'Reusable plans whose steps become ordinary scheduled activities.',
          },
        ].map((row) => (
          <li key={row.title} className="flex items-start gap-2.5">
            <span
              className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-sunken text-secondary"
              aria-hidden="true"
            >
              {row.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-primary">{row.title}</span>
              <span className="block text-xs leading-relaxed text-secondary">{row.line}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

function ReminderStep({
  now,
  created,
  onCreated,
  onCreate,
}: {
  now: number
  created: { title: string; whenLabel: string } | null
  onCreated: (value: { title: string; whenLabel: string } | null) => void
  onCreate: OnboardingProps['onCreateActivity']
}) {
  const choices = useMemo(() => whenChoices(now), [now])
  const [title, setTitle] = useState('')
  const [whenId, setWhenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = title.trim()
  const choice = choices.find((entry) => entry.id === whenId) ?? null
  const canCreate = trimmed.length > 0 && choice !== null && !busy

  const create = async () => {
    if (!choice || !canCreate) return
    setBusy(true)
    setError(null)
    const result = await onCreate({
      title: trimmed,
      type: 'reminder',
      date: choice.date,
      time: choice.time,
      repeat: 'none',
      durationMinutes: 0,
      categoryId: 'personal',
      notify: 'at-time',
    })
    setBusy(false)
    if (result.ok) {
      onCreated({ title: trimmed, whenLabel: choice.label.toLowerCase() })
    } else {
      setError('That could not be saved. You can try again or continue.')
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-surface-sunken text-secondary" aria-hidden="true">
          <Bell size={16} strokeWidth={2} />
        </span>
        <span className="text-2xs font-semibold tracking-wider text-muted uppercase">
          Optional
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <StepTitle>Your first reminder</StepTitle>
        <StepBody>
          Name something you want to be reminded about and pick when. TimePilot
          schedules it like any activity you create later.
        </StepBody>
      </div>

      {created ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-good/30 bg-good-subtle px-4 py-3">
          <span className="mt-0.5 shrink-0 text-good" aria-hidden="true">
            <Check size={16} strokeWidth={2.5} />
          </span>
          <p className="text-xs leading-relaxed text-secondary">
            <span className="font-medium text-primary">{created.title}</span> is
            scheduled for {created.whenLabel}. You can edit it under Activities.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <Input
            label="What should it say?"
            placeholder="e.g. Stretch"
            value={title}
            maxLength={60}
            onChange={(event) => setTitle(event.target.value)}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-secondary">When?</legend>
            <div className="flex flex-wrap gap-2">
              {choices.map((entry) => (
                <Choice
                  key={entry.id}
                  selected={whenId === entry.id}
                  onClick={() => setWhenId(entry.id)}
                >
                  {entry.label}
                </Choice>
              ))}
            </div>
          </fieldset>
          {error ? (
            <p role="status" className="text-2xs text-critical">
              {error}
            </p>
          ) : null}
          <Button
            variant="secondary"
            size="md"
            className="self-start"
            disabled={!canCreate}
            onClick={() => void create()}
          >
            Create reminder
          </Button>
        </div>
      )}
    </>
  )
}

function RoutinesStep({
  added,
  onAdded,
  onCreate,
}: {
  added: Record<string, number>
  onAdded: (templateId: string, generated: number) => void
  onCreate: OnboardingProps['onCreateRoutine']
}) {
  const [busyId, setBusyId] = useState<string | null>(null)

  const add = async (template: (typeof ROUTINE_TEMPLATES)[number]) => {
    setBusyId(template.id)
    const result = await onCreate({
      name: template.name,
      description: template.description,
      ...template.input,
    })
    setBusyId(null)
    if (result.ok && result.routine) {
      onAdded(template.id, result.generated ?? 0)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-surface-sunken text-secondary" aria-hidden="true">
          <Repeat size={16} strokeWidth={2} />
        </span>
        <span className="text-2xs font-semibold tracking-wider text-muted uppercase">
          Optional
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <StepTitle>Start a routine?</StepTitle>
        <StepBody>
          A routine is a reusable plan — its steps become scheduled activities on
          the days it runs. Add one of these to start from, or build your own
          later under Routines.
        </StepBody>
      </div>

      <ul className="flex flex-col gap-2">
        {ROUTINE_TEMPLATES.map((template) => {
          const already = template.id in added
          return (
            <li
              key={template.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border px-4 py-3',
                already
                  ? 'border-good/30 bg-good-subtle'
                  : 'border-border-subtle bg-surface-raised',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-primary">
                  {template.name}
                </p>
                <p className="truncate text-xs text-secondary">
                  {template.summary}
                </p>
              </div>
              {already ? (
                <span
                  className="flex shrink-0 items-center gap-1 text-2xs font-medium text-good"
                  title={`${String(added[template.id] ?? 0)} activities scheduled`}
                >
                  <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                  Added
                </span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busyId !== null}
                  onClick={() => void add(template)}
                >
                  Add
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function BlockingStep({ blocklists }: { blocklists: readonly Blocklist[] }) {
  return (
    <>
      <span className="grid h-9 w-9 place-items-center rounded-md bg-surface-sunken text-secondary" aria-hidden="true">
        <ShieldOff size={16} strokeWidth={2} />
      </span>

      <div className="flex flex-col gap-1">
        <StepTitle>Focus, with the noise kept out</StepTitle>
        <StepBody>
          When you start a Focus session you can attach a blocklist: those
          websites show a calm blocked page until the session ends. Pausing the
          session lets them back in; finishing or cancelling removes the rules
          entirely. You can also keep a list blocking always, not just during
          Focus.
        </StepBody>
      </div>

      {blocklists.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-secondary">
            These are ready to use:
          </p>
          <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">
            {blocklists.map((list) => (
              <li key={list.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 truncate text-xs font-medium text-primary">
                  {list.name}
                </span>
                <span className="shrink-0 text-2xs text-muted">
                  {list.domains.length === 1
                    ? '1 website'
                    : `${String(list.domains.length)} websites`}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-2xs text-muted">
            Edit them any time under Settings · Blocklists.
          </p>
        </div>
      ) : (
        <p className="text-2xs text-muted">
          You can build blocklists later under Settings · Blocklists.
        </p>
      )}

      <div className="flex items-center gap-2 rounded-lg bg-surface-sunken px-4 py-3">
        <TimerIcon size={15} strokeWidth={2} className="shrink-0 text-secondary" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-secondary">
          Timers are separate from Focus: a plain countdown for anything that
          isn't a concentration session.
        </p>
      </div>
    </>
  )
}

function AppearanceStep() {
  const { preference, setPreference } = useTheme()
  return (
    <>
      <span className="grid h-9 w-9 place-items-center rounded-md bg-surface-sunken text-secondary" aria-hidden="true">
        <Sun size={16} strokeWidth={2} />
      </span>

      <div className="flex flex-col gap-1">
        <StepTitle>How should it look?</StepTitle>
        <StepBody>
          Pick a theme now — you can change it any time under Settings.
        </StepBody>
      </div>

      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid grid-cols-3 gap-2"
      >
        {THEMES.map((theme) => {
          const active = preference === theme.value
          return (
            <button
              key={theme.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPreference(theme.value)}
              className={cn(
                'flex min-w-0 flex-col items-center gap-1.5 rounded-md border px-2 py-2.5',
                'transition-colors duration-150 ease-tp',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                active
                  ? 'border-accent bg-accent-subtle text-accent'
                  : 'border-transparent bg-surface-sunken text-secondary hover:text-primary',
              )}
            >
              <span aria-hidden="true" className="shrink-0">
                {theme.icon}
              </span>
              <span className="w-full truncate text-center text-xs font-medium">
                {theme.label}
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}

function Done({
  reminder,
  routines,
}: {
  reminder: { title: string } | null
  routines: Record<string, number>
}) {
  const routineCount = Object.keys(routines).length
  return (
    <>
      <span
        className="grid h-12 w-12 place-items-center rounded-full bg-good-subtle text-good motion-safe:animate-check-in"
        aria-hidden="true"
      >
        <Check size={22} strokeWidth={2} />
      </span>

      <div className="flex flex-col gap-1">
        <StepTitle>You're set.</StepTitle>
        <StepBody>
          {reminder || routineCount > 0
            ? 'Here is what the tour left in place:'
            : 'Nothing was created — the panel is a blank page ready for whatever you plan next.'}
        </StepBody>
      </div>

      {reminder || routineCount > 0 ? (
        <ul className="flex flex-col gap-1.5 text-xs text-secondary">
          {reminder ? (
            <li className="flex items-center gap-2">
              <Check size={13} strokeWidth={2.5} className="shrink-0 text-good" aria-hidden="true" />
              <span className="truncate">
                Reminder “{reminder.title}” on your schedule
              </span>
            </li>
          ) : null}
          {routineCount > 0 ? (
            <li className="flex items-center gap-2">
              <Check size={13} strokeWidth={2.5} className="shrink-0 text-good" aria-hidden="true" />
              <span className="truncate">
                {routineCount === 1
                  ? '1 routine, scheduling its steps'
                  : `${String(routineCount)} routines, scheduling their steps`}
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}

      <p className="text-2xs text-muted">
        The welcome tour can be reopened from Settings any time.
      </p>
    </>
  )
}
