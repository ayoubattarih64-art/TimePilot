import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  Compass,
  Focus as FocusIcon,
  House,
  ListChecks,
  Plus,
  Repeat,
  Settings as SettingsIcon,
  Timer as TimerIcon,
} from 'lucide-react'
import {
  Button,
  Dialog,
  IconButton,
  NavigationBar,
  ToastViewport,
  useToasts,
  type NavigationItem,
} from '../../components/ui'
import { ActivityEditor } from '../../components/activities'
import { RoutineEditor } from '../../components/routines'
import { formatDayLabel, formatTimeOfDay } from '../../lib/activityFormat'
import { useActivities } from '../../hooks/useActivities'
import { useBlocklists } from '../../hooks/useBlocklists'
import { useBlockingStatus } from '../../hooks/useBlockingStatus'
import { useFocusSession } from '../../hooks/useFocusSession'
import { useNow } from '../../hooks/useNow'
import { useRoutines } from '../../hooks/useRoutines'
import { useSchedule } from '../../hooks/useSchedule'
import { useSettings } from '../../hooks/useSettings'
import { useTimer } from '../../hooks/useTimer'
import { useWorkerStatus } from '../../hooks/useWorkerStatus'
import { isFirstRun } from '../../lib/onboarding'
import { takeIntent } from '../../services/intent'
import { nextRoutineStart } from '../../models'
import type {
  ActivityType,
  NewFocusSession,
  NewRoutine,
  NewScheduledActivity,
  NewTimerSession,
  Routine,
  ScheduledActivity,
} from '../../models'
import { Activities } from './pages/Activities'
import { Focus } from './pages/Focus'
import { Home } from './pages/Home'
import { Insights } from './pages/Insights'
import { Onboarding } from './pages/Onboarding'
import { Routines } from './pages/Routines'
import { Schedule } from './pages/Schedule'
import { Settings } from './pages/Settings'
import { Timer } from './pages/Timer'

type Section =
  | 'home'
  | 'activities'
  | 'routines'
  | 'focus'
  | 'timer'
  | 'schedule'
  | 'insights'
  | 'settings'

const NAV: ReadonlyArray<NavigationItem<Section>> = [
  { value: 'home', label: 'Home', icon: <House size={17} strokeWidth={2} /> },
  {
    value: 'activities',
    label: 'Activities',
    icon: <ListChecks size={17} strokeWidth={2} />,
  },
  {
    value: 'routines',
    label: 'Routines',
    icon: <Repeat size={17} strokeWidth={2} />,
  },
  {
    value: 'focus',
    label: 'Focus',
    icon: <FocusIcon size={17} strokeWidth={2} />,
  },
  {
    value: 'timer',
    label: 'Timer',
    icon: <TimerIcon size={17} strokeWidth={2} />,
  },
  {
    value: 'schedule',
    label: 'Schedule',
    icon: <CalendarDays size={17} strokeWidth={2} />,
  },
  {
    value: 'insights',
    label: 'Insights',
    icon: <BarChart3 size={17} strokeWidth={2} />,
  },
]

/**
 * "at 18:00 today" / "at 06:30 tomorrow" — the confirmation the toast needs.
 * Lives here rather than in activityFormat because it is only ever a toast.
 */
function describeFireTime(at: number, now = Date.now()): string {
  return `${formatDayLabel(at, now).toLowerCase()} at ${formatTimeOfDay(at)}`
}

/**
 * The side panel is TimePilot's primary surface: it persists while the user
 * browses, so it holds the whole application.
 *
 * Layout is a fixed three-row grid — header, scrolling content, navigation —
 * inside `h-screen`. Only the middle row scrolls, so the primary action and the
 * navigation are always reachable no matter how long the list gets. Nothing has
 * a fixed width; the panel can be dragged narrow without horizontal overflow.
 */
export function SidePanel() {
  const [section, setSection] = useState<Section>('home')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<ScheduledActivity | null>(null)
  const [editorType, setEditorType] = useState<ActivityType>('reminder')
  const [pendingDelete, setPendingDelete] = useState<ScheduledActivity | null>(
    null,
  )
  const [routineEditorOpen, setRoutineEditorOpen] = useState(false)
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null)
  const [pendingRoutineDelete, setPendingRoutineDelete] =
    useState<Routine | null>(null)
  /** Set when a focus start was refused because a session was already live. */
  const [focusConflict, setFocusConflict] = useState(false)
  /** Set when a timer start was refused because one was already live. */
  const [timerConflict, setTimerConflict] = useState(false)
  /** Set while the welcome tour is reopened from Settings. */
  const [onboardingOverride, setOnboardingOverride] = useState(false)

  const now = useNow()
  const worker = useWorkerStatus()
  const { settings, completeOnboarding, setNotificationsEnabled } =
    useSettings()
  const {
    activities,
    scheduledTimes,
    loading,
    error,
    busy,
    create,
    update,
    remove,
    setEnabled,
    complete,
    snooze,
  } = useActivities()
  const focus = useFocusSession()
  const timer = useTimer()
  const routines = useRoutines()
  // Read here rather than inside the Focus page so the picker and the Settings
  // section share one subscription to the same storage key.
  const { blocklists } = useBlocklists()
  const { status: blockingStatus } = useBlockingStatus()
  const { next, today } = useSchedule(activities, now)
  const { toasts, push, dismiss } = useToasts()

  /**
   * Generated rows per routine id, counted from the activities already loaded.
   * The worker owns the ownership marks; this only reads them, so the page can
   * say "3 activities scheduled" without a second request.
   */
  const generatedByRoutine = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const activity of activities) {
      const id = activity.routineId
      if (typeof id !== 'string') continue
      counts[id] = (counts[id] ?? 0) + 1
    }
    return counts
  }, [activities])

  const openCreate = useCallback((type: ActivityType = 'reminder') => {
    setEditing(null)
    setEditorType(type)
    setEditorOpen(true)
  }, [])

  const openEdit = useCallback((activity: ScheduledActivity) => {
    setEditing(activity)
    setEditorOpen(true)
  }, [])

  // The popup parks a request before opening this panel; pick it up once on
  // mount so the click continues where it left off.
  useEffect(() => {
    let active = true
    void takeIntent().then((intent) => {
      if (!active || !intent) return
      if (intent.kind === 'new-activity') openCreate(intent.type)
      if (intent.kind === 'open-timer') setSection('timer')
      if (intent.kind === 'open-focus') setSection('focus')
    })
    return () => {
      active = false
    }
  }, [openCreate])

  const byId = useMemo(
    () => new Map(activities.map((activity) => [activity.id, activity])),
    [activities],
  )

  const editById = useCallback(
    (id: string) => {
      const activity = byId.get(id)
      if (activity) openEdit(activity)
    },
    [byId, openEdit],
  )

  const submit = useCallback(
    async (input: NewScheduledActivity) => {
      const result = editing
        ? await update(editing.id, input)
        : await create(input)

      if (!result.ok) {
        push('Could not save the activity', 'critical')
        return
      }

      setEditorOpen(false)
      // Confirm the schedule, not just the save — the whole point of the
      // reminder is the notification, so name when it will arrive.
      const verb = editing ? 'updated' : 'created'
      if (result.scheduledAt !== null) {
        push(
          `Activity ${verb} · reminder ${describeFireTime(result.scheduledAt)}`,
          'good',
        )
      } else if (input.type === 'reminder' && input.notify !== 'none') {
        // Saved, but nothing will fire: a one-off whose time has passed.
        push(`Activity ${verb} — no upcoming reminder`, 'neutral')
      } else {
        push(`Activity ${verb}`, 'good')
      }
    },
    [editing, update, create, push],
  )

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    const ok = await remove(pendingDelete.id)
    setPendingDelete(null)
    push(ok ? 'Activity deleted' : 'Could not delete the activity', ok ? 'neutral' : 'critical')
  }, [pendingDelete, remove, push])

  const toggleEnabled = useCallback(
    async (activity: ScheduledActivity, enabled: boolean) => {
      const result = await setEnabled(activity.id, enabled)
      if (!result.ok) {
        push('Could not update the activity', 'critical')
        return
      }
      if (!enabled) {
        push(`${activity.title} paused — it will not notify you`, 'neutral')
      } else if (result.scheduledAt !== null) {
        push(
          `${activity.title} resumed · reminder ${describeFireTime(result.scheduledAt)}`,
          'good',
        )
      } else {
        push(`${activity.title} resumed — no upcoming reminder`, 'neutral')
      }
    },
    [setEnabled, push],
  )

  const markDone = useCallback(
    async (activity: ScheduledActivity) => {
      const ok = await complete(activity.id)
      push(
        ok ? `${activity.title} marked done` : 'Could not mark it done',
        ok ? 'good' : 'critical',
      )
    },
    [complete, push],
  )

  const snoozeFor = useCallback(
    async (activity: ScheduledActivity, minutes: number) => {
      const ok = await snooze(activity.id, minutes)
      push(
        ok
          ? `Snoozed ${String(minutes)} min — the repeat is unchanged`
          : 'Could not snooze it',
        ok ? 'neutral' : 'critical',
      )
    },
    [snooze, push],
  )

  const startFocus = useCallback(
    async (input: NewFocusSession) => {
      const result = await focus.start(input)
      if (!result.ok) {
        push('Could not start the session', 'critical')
        return
      }
      if (!result.started) {
        // Refused: one was already live. The Focus page explains it and offers
        // the choice, so nothing is replaced behind the user's back.
        setFocusConflict(true)
        return
      }
      setFocusConflict(false)
      // Blocking is reported separately from the session: it started either way,
      // and saying so honestly matters more than a clean success message.
      if (result.blocking?.error) {
        push(result.blocking.error, 'critical')
        return
      }
      if (input.blocklistId && result.blocking?.active) {
        const name = result.blocking.lists[0]?.name
        push(
          `Focusing on ${input.title} · blocking ${name ?? 'websites'}`,
          'good',
        )
        return
      }
      push(`Focusing on ${input.title}`, 'good')
    },
    [focus, push],
  )

  const endFocus = useCallback(async () => {
    const ok = await focus.cancel()
    setFocusConflict(false)
    if (ok) push('Focus session ended', 'neutral')
  }, [focus, push])

  const startTimer = useCallback(
    async (input: NewTimerSession) => {
      const result = await timer.start(input)
      if (!result.ok) {
        push('Could not start the timer', 'critical')
        return
      }
      if (!result.started) {
        // Refused: one was already live. The Timer page explains it and offers
        // the choice, so nothing is replaced behind the user's back.
        setTimerConflict(true)
        return
      }
      setTimerConflict(false)
      push(`Timer started · ${input.title.trim() || 'countdown'}`, 'good')
    },
    [timer, push],
  )

  const cancelTimer = useCallback(async () => {
    const ok = await timer.cancel()
    setTimerConflict(false)
    if (ok) push('Timer cancelled', 'neutral')
  }, [timer, push])

  /* --- Welcome tour --------------------------------------------------- */

  // The tour creates through the same doors the editors use, so what it leaves
  // behind is indistinguishable from hand-made data.
  const createFirstActivity = useCallback(
    async (input: NewScheduledActivity) => create(input),
    [create],
  )

  const createRoutineFromTemplate = useCallback(
    async (input: NewRoutine) => routines.create(input),
    [routines],
  )

  const finishOnboarding = useCallback(async () => {
    await completeOnboarding()
  }, [completeOnboarding])

  // The tour shows itself only on a genuinely fresh store: the completed mark
  // is the durable answer, and the emptiness check keeps an install upgrading
  // from before the tour existed from being ambushed by a welcome screen. The
  // decision is latched for the panel's lifetime once made — creating the
  // first reminder or routine *inside the tour* must not pull the floor out
  // from under it.
  const dataLoaded =
    !loading && !routines.loading && !focus.loading && !timer.loading
  const fresh = isFirstRun({
    scheduled: activities.length,
    routines: routines.routines.length,
    focusUsed: focus.session !== null || focus.last !== null,
    timerUsed: timer.timer !== null || timer.last !== null,
  })
  const [tourEligible, setTourEligible] = useState<boolean | null>(null)
  // Derived during render (the React pattern for state that must react to a
  // prop change and stick): the completed mark always wins — including the
  // moment the tour's own Finish writes it, which is what hands the panel
  // back — and the first-run decision is made once and then latched, so
  // creating the first reminder or routine inside the tour cannot pull the
  // floor out from under it.
  if (settings !== null && settings.onboardingCompletedAt !== null) {
    if (tourEligible !== false) setTourEligible(false)
  } else if (tourEligible === null && settings !== null && dataLoaded) {
    setTourEligible(fresh)
  }
  const showOnboarding = onboardingOverride || tourEligible === true

  /**
   * The routine that starts soonest, for Home's pointer card.
   *
   * `nextRoutineStart` already returns null for a disabled or stepless routine,
   * so this needs no filter of its own — and it is a *routine* start, not the
   * generated activity, because Home links to the plan rather than to one step.
   */
  const nextRoutine = useMemo(() => {
    let best: { routine: Routine; at: number } | null = null
    for (const routine of routines.routines) {
      const at = nextRoutineStart(routine, now)
      if (at === null) continue
      if (!best || at < best.at) best = { routine, at }
    }
    return best
  }, [routines.routines, now])

  const openCreateRoutine = useCallback(() => {
    setEditingRoutine(null)
    setRoutineEditorOpen(true)
  }, [])

  const openEditRoutine = useCallback((routine: Routine) => {
    setEditingRoutine(routine)
    setRoutineEditorOpen(true)
  }, [])

  /**
   * Save a routine and report what it actually scheduled.
   *
   * `generated` comes back from the worker after it regenerated, so the toast
   * describes storage rather than intent — a routine whose steps are all in the
   * past today still says how many activities it owns.
   */
  const submitRoutine = useCallback(
    async (input: NewRoutine) => {
      const result = editingRoutine
        ? await routines.update(editingRoutine.id, input)
        : await routines.create(input)

      if (!result.ok) {
        push(
          result.reason === 'limit'
            ? 'You have reached the routine limit'
            : 'Could not save the routine',
          'critical',
        )
        return
      }

      setRoutineEditorOpen(false)
      const verb = editingRoutine ? 'updated' : 'created'
      push(
        result.generated > 0
          ? `Routine ${verb} · ${String(result.generated)} ${result.generated === 1 ? 'activity' : 'activities'} scheduled`
          : `Routine ${verb} — nothing scheduled yet`,
        'good',
      )
    },
    [editingRoutine, routines, push],
  )

  const toggleRoutine = useCallback(
    async (routine: Routine, enabled: boolean) => {
      const result = await routines.setEnabled(routine.id, enabled)
      if (!result.ok) {
        push('Could not update the routine', 'critical')
        return
      }
      push(
        enabled
          ? `${routine.name} resumed · ${String(result.generated)} scheduled`
          : `${routine.name} paused — it will not schedule anything`,
        enabled ? 'good' : 'neutral',
      )
    },
    [routines, push],
  )

  const confirmRoutineDelete = useCallback(async () => {
    if (!pendingRoutineDelete) return
    const ok = await routines.remove(pendingRoutineDelete.id)
    setPendingRoutineDelete(null)
    if (ok) setRoutineEditorOpen(false)
    push(
      ok
        ? 'Routine deleted — completed occurrences were kept'
        : 'Could not delete the routine',
      ok ? 'neutral' : 'critical',
    )
  }, [pendingRoutineDelete, routines, push])

  // The tour replaces the whole panel — header and navigation included — so
  // nothing competes with it and nothing can be reached "around" it by
  // accident. Toasts stay available for the creation feedback.
  if (showOnboarding) {
    return (
      <div className="h-screen overflow-hidden bg-surface">
        <Onboarding
          now={now}
          blocklists={blocklists}
          reopened={
            onboardingOverride &&
            (settings?.onboardingCompletedAt ?? null) !== null
          }
          onCreateActivity={createFirstActivity}
          onCreateRoutine={createRoutineFromTemplate}
          onDone={() => {
            setOnboardingOverride(false)
            void finishOnboarding()
          }}
        />
        <ToastViewport toasts={toasts} onDismiss={dismiss} />
      </div>
    )
  }

  return (
    <div className="grid h-screen grid-rows-[auto_1fr_auto] overflow-hidden bg-surface">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border-subtle bg-surface-raised px-4 py-2.5">
        {/* The brand mark: one accent tile, the only identity element every
            surface shares. */}
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-on-accent"
          aria-hidden="true"
        >
          <Compass size={15} strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-primary">TimePilot</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => openCreate()}
          iconLeft={<Plus size={14} strokeWidth={2.5} aria-hidden="true" />}
        >
          New activity
        </Button>
        <IconButton
          label="Settings"
          icon={<SettingsIcon size={16} strokeWidth={2} />}
          onClick={() => setSection('settings')}
        />
      </header>

      {/* The only scrolling region. min-h-0 is required for it to scroll
          inside the grid row rather than expanding it. */}
      <main className="min-h-0 overflow-y-auto">
        {error ?? focus.error ?? routines.error ?? timer.error ? (
          <p
            role="status"
            className="mx-4 mt-4 rounded-md border border-critical/40 bg-critical-subtle px-3 py-2 text-xs text-critical"
          >
            {error ?? focus.error ?? routines.error ?? timer.error}
          </p>
        ) : null}

        {section === 'home' ? (
          <Home
            now={now}
            next={next}
            today={today}
            loading={loading}
            focus={focus.session}
            timer={timer.timer}
            blocking={blockingStatus}
            nextRoutine={nextRoutine}
            onNewActivity={openCreate}
            onSelect={editById}
            onGoToFocus={() => setSection('focus')}
            onGoToTimer={() => setSection('timer')}
            onGoToRoutines={() => setSection('routines')}
            onGoToSettings={() => setSection('settings')}
          />
        ) : null}

        {section === 'activities' ? (
          <Activities
            activities={activities}
            scheduledTimes={scheduledTimes}
            now={now}
            loading={loading}
            onCreate={() => openCreate()}
            onEdit={openEdit}
            onDelete={setPendingDelete}
            onToggleEnabled={(activity, enabled) => {
              void toggleEnabled(activity, enabled)
            }}
            onComplete={(activity) => {
              void markDone(activity)
            }}
            onSnooze={(activity, minutes) => {
              void snoozeFor(activity, minutes)
            }}
          />
        ) : null}

        {section === 'routines' ? (
          <Routines
            routines={routines.routines}
            generated={generatedByRoutine}
            now={now}
            loading={routines.loading}
            busy={routines.busy}
            onCreate={openCreateRoutine}
            onEdit={openEditRoutine}
            onToggleEnabled={(routine, enabled) => {
              void toggleRoutine(routine, enabled)
            }}
          />
        ) : null}

        {section === 'focus' ? (
          <Focus
            session={focus.session}
            last={focus.last}
            loading={focus.loading}
            busy={focus.busy}
            activities={activities}
            blocklists={blocklists}
            blocking={focus.blocking}
            conflict={focusConflict}
            onDismissConflict={() => setFocusConflict(false)}
            onStart={(input) => {
              void startFocus(input)
            }}
            onPause={() => {
              void focus.pause()
            }}
            onResume={() => {
              void focus.resume()
            }}
            onCancel={() => {
              void endFocus()
            }}
          />
        ) : null}

        {section === 'timer' ? (
          <Timer
            timer={timer.timer}
            last={timer.last}
            loading={timer.loading}
            busy={timer.busy}
            onStart={(input) => {
              void startTimer(input)
            }}
            onPause={() => {
              void timer.pause()
            }}
            onResume={() => {
              void timer.resume()
            }}
            onAdd={(minutes) => {
              void timer.add(minutes)
            }}
            onCancel={() => {
              void cancelTimer()
            }}
            conflict={timerConflict}
            onDismissConflict={() => setTimerConflict(false)}
          />
        ) : null}

        {section === 'schedule' ? (
          <Schedule activities={activities} now={now} onSelect={openEdit} />
        ) : null}

        {section === 'insights' ? (
          <Insights
            activities={activities}
            routines={routines.routines}
            now={now}
            loading={loading || routines.loading}
          />
        ) : null}

        {section === 'settings' ? (
          <Settings
            version={worker.version}
            connected={worker.connected}
            notificationsEnabled={settings?.notificationsEnabled ?? true}
            onSetNotificationsEnabled={(enabled) => {
              void setNotificationsEnabled(enabled)
            }}
            onOpenOnboarding={() => setOnboardingOverride(true)}
          />
        ) : null}
      </main>

      <NavigationBar
        items={NAV}
        // Settings is reached from the header, so no nav item is current there.
        value={section === 'settings' ? null : section}
        onChange={setSection}
      />

      <ActivityEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSubmit={submit}
        activity={editing}
        initialType={editorType}
        busy={busy}
      />

      <RoutineEditor
        open={routineEditorOpen}
        onClose={() => setRoutineEditorOpen(false)}
        onSubmit={submitRoutine}
        routine={editingRoutine}
        onDelete={setPendingRoutineDelete}
        busy={routines.busy}
      />

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete activity?"
        description={
          pendingDelete
            ? `"${pendingDelete.title}" will be removed. This cannot be undone.`
            : undefined
        }
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void confirmDelete()}
              disabled={busy}
            >
              Delete
            </Button>
          </>
        }
      />

      <Dialog
        open={pendingRoutineDelete !== null}
        onClose={() => setPendingRoutineDelete(null)}
        title="Delete routine?"
        description={
          pendingRoutineDelete
            ? `"${pendingRoutineDelete.name}" and its upcoming activities will be removed. Occurrences you already completed are kept.`
            : undefined
        }
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPendingRoutineDelete(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void confirmRoutineDelete()}
              disabled={routines.busy}
            >
              Delete
            </Button>
          </>
        }
      />

      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
