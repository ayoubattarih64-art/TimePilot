import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import {
  daysForRecurrence,
  describeDaysOf,
  MAX_ROUTINE_DESCRIPTION,
  MAX_ROUTINE_NAME,
  MAX_ROUTINE_STEPS,
  MAX_STEP_MINUTES,
  MAX_STEP_TITLE,
  recurrenceOfDays,
  ROUTINE_CATEGORIES,
  stepStartTimesFrom,
  type NewRoutine,
  type NewRoutineStep,
  type Routine,
  type RoutineRecurrence,
  type RoutineStepType,
  type Weekday,
} from '../../models'
import { Button, IconButton, Input, Select, Sheet } from '../ui'
import { DayPicker } from './DayPicker'

export type RoutineEditorProps = {
  open: boolean
  onClose: () => void
  onSubmit: (input: NewRoutine) => Promise<void> | void
  /** Present when editing; absent when creating. */
  routine?: Routine | null
  /** Offered only when editing. */
  onDelete?: (routine: Routine) => void
  busy?: boolean
}

const RECURRENCE_OPTIONS = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)' },
  { value: 'weekends', label: 'Weekends' },
  { value: 'selected', label: 'Selected days' },
] as const

const STEP_TYPE_OPTIONS = [
  { value: 'reminder', label: 'Reminder' },
  { value: 'timer', label: 'Timer' },
  { value: 'focus', label: 'Focus' },
] as const

const NO_CATEGORY = 'none'

const CATEGORY_OPTIONS = [
  { value: NO_CATEGORY, label: 'No category' },
  ...ROUTINE_CATEGORIES.map((category) => ({
    value: category.id,
    label: category.name,
  })),
]

/** A step in the form. `id` is carried through so an edit is not a re-create. */
type DraftStep = NewRoutineStep & { key: string }

type FormState = {
  name: string
  description: string
  categoryId: string
  daysOfWeek: Weekday[]
  startTime: string
  steps: DraftStep[]
}

let draftKeys = 0
/** Local list keys only — the real step ids come from the worker. */
function draftKey(): string {
  draftKeys += 1
  return `draft-${String(draftKeys)}`
}

function newStep(type: RoutineStepType = 'timer'): DraftStep {
  return {
    key: draftKey(),
    title: '',
    durationMinutes: type === 'reminder' ? 0 : 25,
    type,
  }
}

function defaultForm(): FormState {
  return {
    name: '',
    description: '',
    categoryId: NO_CATEGORY,
    // Weekdays is the shape most routines take, and it is one tap from the rest.
    daysOfWeek: [...daysForRecurrence('weekdays')],
    startTime: '07:00',
    steps: [newStep()],
  }
}

function toForm(routine: Routine): FormState {
  return {
    name: routine.name,
    description: routine.description,
    categoryId: routine.categoryId ?? NO_CATEGORY,
    daysOfWeek: [...routine.daysOfWeek],
    startTime: routine.startTime,
    steps: routine.steps.map((step) => ({
      key: step.id,
      id: step.id,
      title: step.title,
      durationMinutes: step.durationMinutes,
      type: step.type,
    })),
  }
}

/**
 * Create/edit form for a routine, in a bottom sheet.
 *
 * Remounted per open via the key, exactly like `ActivityEditor`, so the fields
 * are initialised from props in `useState` and a cancelled edit leaves nothing
 * behind.
 */
export function RoutineEditor(props: RoutineEditorProps) {
  const { open, routine = null } = props
  const session = open ? (routine?.id ?? 'new') : 'closed'
  return <RoutineEditorSheet key={session} {...props} />
}

function RoutineEditorSheet({
  open,
  onClose,
  onSubmit,
  routine = null,
  onDelete,
  busy = false,
}: RoutineEditorProps) {
  const [form, setForm] = useState<FormState>(() =>
    routine ? toForm(routine) : defaultForm(),
  )
  const [nameError, setNameError] = useState<string | null>(null)
  const [stepsError, setStepsError] = useState<string | null>(null)

  const patch = (next: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...next }))
  }

  const patchStep = (key: string, next: Partial<DraftStep>) => {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.key === key ? { ...step, ...next } : step,
      ),
    }))
  }

  const removeStep = (key: string) => {
    setForm((current) => ({
      ...current,
      steps: current.steps.filter((step) => step.key !== key),
    }))
  }

  /** Reorder by one place. The two arrows are the whole interaction — no drag. */
  const moveStep = (index: number, delta: number) => {
    setForm((current) => {
      const target = index + delta
      if (target < 0 || target >= current.steps.length) return current
      const steps = [...current.steps]
      const [moved] = steps.splice(index, 1)
      steps.splice(target, 0, moved)
      return { ...current, steps }
    })
  }

  const addStep = () => {
    setForm((current) =>
      current.steps.length >= MAX_ROUTINE_STEPS
        ? current
        : { ...current, steps: [...current.steps, newStep()] },
    )
    setStepsError(null)
  }

  const recurrence = recurrenceOfDays(form.daysOfWeek)
  const times = stepStartTimesFrom(form.startTime, form.steps)

  const handleSubmit = () => {
    const name = form.name.trim()
    const titled = form.steps.filter((step) => step.title.trim().length > 0)

    setNameError(name ? null : 'Give the routine a name')
    setStepsError(
      titled.length > 0 ? null : 'Add at least one step with a name',
    )
    if (!name || titled.length === 0) return

    void onSubmit({
      name,
      description: form.description.trim(),
      categoryId: form.categoryId === NO_CATEGORY ? null : form.categoryId,
      daysOfWeek: form.daysOfWeek,
      startTime: form.startTime,
      steps: titled.map((step) => ({
        ...(step.id !== undefined ? { id: step.id } : {}),
        title: step.title.trim(),
        durationMinutes: step.durationMinutes,
        type: step.type,
      })),
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={routine ? 'Edit routine' : 'New routine'}
      description={
        routine
          ? 'Changes apply to future occurrences. Completed history is kept.'
          : 'A reusable plan: the days it runs, a start time, and its steps.'
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          {routine && onDelete ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onDelete(routine)}
              iconLeft={<Trash2 size={13} strokeWidth={2} aria-hidden="true" />}
            >
              Delete
            </Button>
          ) : (
            <span />
          )}
          <span className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={busy}
            >
              {routine ? 'Save changes' : 'Create routine'}
            </Button>
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Input
          label="Routine name"
          placeholder="e.g. Morning"
          value={form.name}
          maxLength={MAX_ROUTINE_NAME}
          error={nameError ?? undefined}
          onChange={(event) => {
            patch({ name: event.target.value })
            if (nameError) setNameError(null)
          }}
        />

        <Input
          label="Description"
          placeholder="Optional"
          value={form.description}
          maxLength={MAX_ROUTINE_DESCRIPTION}
          hint="Notes for yourself. Never used for scheduling."
          onChange={(event) => {
            patch({ description: event.target.value })
          }}
        />

        <Select
          label="Category"
          options={CATEGORY_OPTIONS}
          value={form.categoryId}
          hint="Optional. Decides the colour its activities carry."
          onChange={(event) => {
            patch({ categoryId: event.target.value })
          }}
        />

        <Select
          label="Repeat"
          options={RECURRENCE_OPTIONS}
          value={recurrence}
          onChange={(event) => {
            const next = event.target.value as RoutineRecurrence
            // 'Selected days' has no days of its own: keep what is there so the
            // choice does not silently clear the week the user just picked.
            if (next === 'selected') return
            patch({ daysOfWeek: [...daysForRecurrence(next)] })
          }}
        />

        <DayPicker
          value={form.daysOfWeek}
          hint={
            form.daysOfWeek.length === 0
              ? 'No days selected — it runs every day.'
              : describeDaysOf(form.daysOfWeek)
          }
          onChange={(next) => {
            patch({ daysOfWeek: next })
          }}
        />

        <Input
          label="Start time"
          type="time"
          value={form.startTime}
          hint="The first step begins here; the rest follow back to back."
          onChange={(event) => {
            patch({ startTime: event.target.value || '07:00' })
          }}
        />

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-secondary">Steps</span>
            <span className="text-2xs text-muted">
              {`${String(form.steps.length)} of ${String(MAX_ROUTINE_STEPS)}`}
            </span>
          </div>

          {form.steps.length > 0 ? (
            <ol className="flex flex-col gap-2">
              {form.steps.map((step, index) => (
                <li
                  key={step.key}
                  className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-sunken p-2.5"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="tabular shrink-0 text-2xs font-medium text-accent">
                      {times[index]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Input
                        aria-label={`Step ${String(index + 1)} name`}
                        placeholder="e.g. Exercise"
                        inputSize="sm"
                        maxLength={MAX_STEP_TITLE}
                        value={step.title}
                        onChange={(event) => {
                          patchStep(step.key, { title: event.target.value })
                          if (stepsError) setStepsError(null)
                        }}
                      />
                    </div>
                    <IconButton
                      label={`Move step ${String(index + 1)} up`}
                      size="sm"
                      disabled={index === 0}
                      icon={<ArrowUp size={13} strokeWidth={2} />}
                      onClick={() => moveStep(index, -1)}
                    />
                    <IconButton
                      label={`Move step ${String(index + 1)} down`}
                      size="sm"
                      disabled={index === form.steps.length - 1}
                      icon={<ArrowDown size={13} strokeWidth={2} />}
                      onClick={() => moveStep(index, 1)}
                    />
                    <IconButton
                      label={`Remove step ${String(index + 1)}`}
                      size="sm"
                      icon={<Trash2 size={13} strokeWidth={2} />}
                      onClick={() => removeStep(step.key)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      aria-label={`Step ${String(index + 1)} type`}
                      selectSize="sm"
                      options={STEP_TYPE_OPTIONS}
                      value={step.type}
                      onChange={(event) => {
                        const type = event.target.value as RoutineStepType
                        patchStep(step.key, {
                          type,
                          // A timer or focus step needs something to count.
                          durationMinutes:
                            type !== 'reminder' && step.durationMinutes === 0
                              ? 25
                              : step.durationMinutes,
                        })
                      }}
                    />
                    <Input
                      aria-label={`Step ${String(index + 1)} minutes`}
                      type="number"
                      inputMode="numeric"
                      inputSize="sm"
                      min={0}
                      max={MAX_STEP_MINUTES}
                      step={5}
                      value={String(step.durationMinutes)}
                      onChange={(event) => {
                        const parsed = Number(event.target.value)
                        patchStep(step.key, {
                          durationMinutes: Number.isFinite(parsed)
                            ? Math.max(
                                0,
                                Math.min(MAX_STEP_MINUTES, Math.round(parsed)),
                              )
                            : 0,
                        })
                      }}
                    />
                  </div>
                </li>
              ))}
            </ol>
          ) : null}

          {stepsError ? (
            <p className="text-2xs text-critical">{stepsError}</p>
          ) : (
            <p className="text-2xs text-muted">
              Each step becomes one scheduled activity that notifies you when it
              begins.
            </p>
          )}

          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            disabled={form.steps.length >= MAX_ROUTINE_STEPS}
            onClick={addStep}
            iconLeft={<Plus size={13} strokeWidth={2.5} aria-hidden="true" />}
          >
            Add step
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
