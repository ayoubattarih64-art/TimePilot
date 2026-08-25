import { useState } from 'react'
import {
  ACTIVITY_CATEGORIES,
  CUSTOM_CATEGORY_ID,
  toDateKey,
  toInstant,
  toTimeKey,
  type ActivityType,
  type NewScheduledActivity,
  type NotifyLead,
  type RepeatRule,
  type ScheduledActivity,
} from '../../models'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Sheet } from '../ui/Sheet'

export type ActivityEditorProps = {
  open: boolean
  onClose: () => void
  onSubmit: (input: NewScheduledActivity) => Promise<void> | void
  /** Present when editing; absent when creating. */
  activity?: ScheduledActivity | null
  /** Pre-selects the type for the "+ Reminder" / "Timer" quick actions. */
  initialType?: ActivityType
  busy?: boolean
}

const TYPE_OPTIONS = [
  { value: 'reminder', label: 'Reminder' },
  { value: 'timer', label: 'Timer' },
] as const

const REPEAT_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)' },
  { value: 'weekly', label: 'Every week' },
] as const

const NOTIFY_OPTIONS = [
  { value: 'at-time', label: 'At the start time' },
  { value: 'min-5', label: '5 minutes before' },
  { value: 'min-15', label: '15 minutes before' },
  { value: 'none', label: 'No notification' },
] as const

const CATEGORY_OPTIONS = [
  ...ACTIVITY_CATEGORIES.map((category) => ({
    value: category.id,
    label: category.name,
  })),
  { value: CUSTOM_CATEGORY_ID, label: 'Custom…' },
]

type FormState = NewScheduledActivity

/** A sensible default: the next round half-hour, today. */
function defaultForm(type: ActivityType, now = Date.now()): FormState {
  const rounded = new Date(now)
  rounded.setSeconds(0, 0)
  rounded.setMinutes(rounded.getMinutes() + (30 - (rounded.getMinutes() % 30)))

  return {
    title: '',
    type,
    date: toDateKey(rounded.getTime()),
    time: toTimeKey(rounded.getTime()),
    repeat: 'none',
    durationMinutes: type === 'timer' ? 25 : 0,
    categoryId: 'personal',
    notify: 'at-time',
  }
}

function toForm(activity: ScheduledActivity): FormState {
  return {
    title: activity.title,
    type: activity.type,
    date: activity.date,
    time: activity.time,
    repeat: activity.repeat,
    durationMinutes: activity.durationMinutes,
    categoryId: activity.categoryId,
    customCategory: activity.customCategory,
    notify: activity.notify,
  }
}

/**
 * Create/edit form for an activity, in a bottom sheet.
 *
 * The fields live in a child that is remounted on every open (see the key), so
 * the form is initialised from props in `useState` and needs no effect copying
 * props into state — a cancelled edit leaves nothing behind either way.
 */
export function ActivityEditor(props: ActivityEditorProps) {
  const { open, activity = null, initialType = 'reminder' } = props
  const session = open ? `${activity?.id ?? 'new'}:${initialType}` : 'closed'
  return <ActivityEditorSheet key={session} {...props} />
}

/**
 * Validation is deliberately minimal and inline: a title and a parseable
 * date+time. Nothing else can be wrong, because every other field is a select
 * or a native date/time input.
 */
function ActivityEditorSheet({
  open,
  onClose,
  onSubmit,
  activity = null,
  initialType = 'reminder',
  busy = false,
}: ActivityEditorProps) {
  const [form, setForm] = useState<FormState>(() =>
    activity ? toForm(activity) : defaultForm(initialType),
  )
  const [titleError, setTitleError] = useState<string | null>(null)
  const [whenError, setWhenError] = useState<string | null>(null)

  const patch = (next: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...next }))
  }

  const handleSubmit = () => {
    const title = form.title.trim()
    const when = toInstant(form.date, form.time)

    setTitleError(title ? null : 'Give the activity a name')
    setWhenError(when === null ? 'Pick a valid date and time' : null)
    if (!title || when === null) return

    void onSubmit({
      ...form,
      title,
      // Custom text is meaningless unless the custom category is selected.
      customCategory:
        form.categoryId === CUSTOM_CATEGORY_ID
          ? form.customCategory?.trim()
          : undefined,
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={activity ? 'Edit activity' : 'New activity'}
      description={
        activity
          ? undefined
          : 'Reminders notify you at a time. Timers count down a duration.'
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={busy}
          >
            {activity ? 'Save changes' : 'Create activity'}
          </Button>
        </div>
      }
    >
      {/* Not a <form>: the sheet's footer buttons sit outside the field area,
          and there is no navigation-on-submit to preserve. */}
      <div className="flex flex-col gap-4 pb-2">
        <Input
          label="Activity name"
          placeholder="e.g. Study"
          value={form.title}
          error={titleError ?? undefined}
          onChange={(event) => {
            patch({ title: event.target.value })
            if (titleError) setTitleError(null)
          }}
        />

        <Select
          label="Type"
          options={TYPE_OPTIONS}
          value={form.type}
          onChange={(event) => {
            const type = event.target.value as ActivityType
            patch({
              type,
              // A timer without a length is meaningless; a reminder needs none.
              durationMinutes:
                type === 'timer' && form.durationMinutes === 0
                  ? 25
                  : form.durationMinutes,
            })
          }}
        />

        {/* Two columns at any panel width — date and time are both narrow. */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Date"
            type="date"
            value={form.date}
            error={whenError ?? undefined}
            onChange={(event) => {
              patch({ date: event.target.value })
              if (whenError) setWhenError(null)
            }}
          />
          <Input
            label="Time"
            type="time"
            value={form.time}
            onChange={(event) => {
              patch({ time: event.target.value })
              if (whenError) setWhenError(null)
            }}
          />
        </div>

        <Select
          label="Repeat"
          options={REPEAT_OPTIONS}
          value={form.repeat}
          onChange={(event) => {
            patch({ repeat: event.target.value as RepeatRule })
          }}
        />

        <Input
          label="Duration"
          type="number"
          min={0}
          max={1440}
          step={5}
          inputMode="numeric"
          hint={
            form.type === 'timer'
              ? 'Minutes to count down.'
              : 'Minutes. Leave 0 if the activity has no set length.'
          }
          value={String(form.durationMinutes)}
          onChange={(event) => {
            const parsed = Number(event.target.value)
            patch({
              durationMinutes: Number.isFinite(parsed)
                ? Math.max(0, Math.min(1440, Math.round(parsed)))
                : 0,
            })
          }}
        />

        <Select
          label="Category"
          options={CATEGORY_OPTIONS}
          value={form.categoryId}
          onChange={(event) => {
            patch({ categoryId: event.target.value })
          }}
        />

        {form.categoryId === CUSTOM_CATEGORY_ID ? (
          <Input
            label="Category name"
            placeholder="e.g. Volunteering"
            value={form.customCategory ?? ''}
            onChange={(event) => {
              patch({ customCategory: event.target.value })
            }}
          />
        ) : null}

        <Select
          label="Notification"
          options={NOTIFY_OPTIONS}
          value={form.notify}
          hint="Chrome shows the notification; TimePilot schedules it."
          onChange={(event) => {
            patch({ notify: event.target.value as NotifyLead })
          }}
        />
      </div>
    </Sheet>
  )
}
