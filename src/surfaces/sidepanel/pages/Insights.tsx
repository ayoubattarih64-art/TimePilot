import { useMemo, useState, type ReactNode } from 'react'
import { BarChart3, Clock } from 'lucide-react'
import { Badge, Card, EmptyState, SectionHeader, Tabs } from '../../../components/ui'
import { FocusChart, type ChartBar } from '../../../components/insights'
import { cn } from '../../../lib/cn'
import { formatDuration } from '../../../lib/time'
import {
  INSIGHTS_PERIODS,
  insightsReport,
  type InsightsPeriod,
} from '../../../lib/insights'
import { useFocusHistory } from '../../../hooks/useFocusHistory'
import type { Routine, ScheduledActivity } from '../../../models'

/**
 * Insights: where the time actually went, measured from what TimePilot stored.
 *
 * Every number on this page is produced by `lib/insights` from persisted rows —
 * the page only formats and lays it out. Sections with nothing real to say say
 * so with an empty state instead of a zero-filled chart, and anything that
 * cannot be measured from storage (a "blocked time" the engines never wrote
 * down, a pattern from one session) is simply not claimed.
 */

export type InsightsProps = {
  activities: ScheduledActivity[]
  routines: Routine[]
  now: number
  loading: boolean
}

const PERIOD_LABELS: Record<InsightsPeriod, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
}

const SUMMARY_TITLES: Record<InsightsPeriod, string> = {
  today: 'Today',
  week: 'Your week',
  month: 'Your month',
}

const PREVIOUS_LABELS: Record<InsightsPeriod, string> = {
  today: 'yesterday',
  week: 'last week',
  month: 'last month',
}

/** "82%" from a 0–1 rate. */
function percentOf(rate: number): string {
  return `${String(Math.round(rate * 100))}%`
}

/** "18:00–21:00" from hour numbers. */
function hourRange(startHour: number, endHour: number): string {
  const pad = (hour: number) => String(hour).padStart(2, '0')
  return `${pad(startHour)}:00–${pad(endHour)}:00`
}

/**
 * "+18% vs last week", or nothing when the previous period holds no data to
 * compare against. The sign carries the direction, so colour is never the only
 * signal.
 */
function DeltaLine({
  delta,
  format,
  vs,
}: {
  delta: number
  format: (magnitude: number) => string
  vs: string
}) {
  if (delta === 0) {
    return (
      <p className="mt-1 text-2xs text-muted">No change vs {vs}</p>
    )
  }
  const up = delta > 0
  return (
    <p
      className={cn(
        'mt-1 text-2xs tabular',
        up ? 'text-good' : 'text-critical',
      )}
    >
      {up ? '+' : '−'}
      {format(Math.abs(delta))} vs {vs}
    </p>
  )
}

/**
 * One summary figure: label, value, optional comparison line. Sits in a
 * divided cell rather than its own box — three tiles in a row read as a
 * dashboard, one card with hairlines reads as a summary.
 */
function StatCell({
  label,
  value,
  footer,
}: {
  label: string
  value: string
  footer?: ReactNode
}) {
  return (
    <div className="min-w-0 px-3 py-3 first:pl-4 last:pr-4">
      <p className="truncate text-2xs font-semibold tracking-wider text-muted uppercase">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular text-primary">{value}</p>
      {/* Fixed height whether or not a delta is shown, so cells align. */}
      <div className="min-h-4">{footer}</div>
    </div>
  )
}

/** A "6 of 9 done" row with the completion bar under it. */
function RoutineRow({
  name,
  completed,
  missed,
  isBest,
}: {
  name: string
  completed: number
  missed: number
  isBest: boolean
}) {
  const settled = completed + missed
  const rate = settled > 0 ? completed / settled : null
  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-primary">
          {name}
        </p>
        <p className="shrink-0 text-2xs tabular text-secondary">
          {settled > 0
            ? `${String(completed)} of ${String(settled)} done`
            : 'Nothing settled yet'}
        </p>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken"
        role="presentation"
      >
        <div
          className={cn(
            'h-full rounded-full',
            isBest ? 'bg-good' : 'bg-accent',
          )}
          style={{ width: rate === null ? '0%' : `${Math.round(rate * 100)}%` }}
        />
      </div>
    </div>
  )
}

export function Insights({ activities, routines, now, loading }: InsightsProps) {
  const [period, setPeriod] = useState<InsightsPeriod>('week')
  const history = useFocusHistory()

  const report = useMemo(
    () =>
      insightsReport(
        { activities, focusSessions: history.sessions, routines, now },
        period,
      ),
    [activities, history.sessions, routines, now, period],
  )

  const bars = useMemo<ChartBar[]>(() => {
    if (period === 'today') {
      return report.focus.hourly.map((ms, hour) => ({
        label: hour % 6 === 0 ? String(hour).padStart(2, '0') : '',
        name: hourRange(hour, hour + 1),
        valueMs: ms,
      }))
    }
    return report.focus.daily.map((day) => ({
      label: day.label,
      name: day.label,
      valueMs: day.ms,
    }))
  }, [report, period])

  const vs = PREVIOUS_LABELS[period]
  const focus = report.focus
  const noFocus = focus.sessionCount === 0
  const noActivities =
    report.activities.completed +
      report.activities.missed +
      report.activities.pending ===
    0
  const noRoutines =
    report.routines.perRoutine.length === 0 &&
    report.routines.completed +
      report.routines.missed +
      report.routines.pending ===
      0

  const focusDelta =
    report.comparison.focusDeltaPercent !== null ? (
      <DeltaLine
        delta={report.comparison.focusDeltaPercent * 100}
        format={(n) => `${String(Math.round(n))}%`}
        vs={vs}
      />
    ) : report.comparison.focusDeltaMs !== null ? (
      <DeltaLine
        delta={report.comparison.focusDeltaMs}
        format={(n) => formatDuration(n)}
        vs={vs}
      />
    ) : null

  const completedDelta =
    report.comparison.completedDelta !== null ? (
      <DeltaLine
        delta={report.comparison.completedDelta}
        format={(n) => String(n)}
        vs={vs}
      />
    ) : null

  if (history.error) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-semibold text-primary">Insights</h1>
        <p
          role="status"
          className="mt-4 rounded-md border border-critical/40 bg-critical-subtle px-3 py-2 text-xs text-critical"
        >
          {history.error}
        </p>
      </div>
    )
  }

  if (loading || history.loading) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-semibold text-primary">Insights</h1>
        <p className="mt-4 text-sm text-secondary">Loading your data…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      <h1 className="text-lg font-semibold text-primary">Insights</h1>

      <Tabs
        items={INSIGHTS_PERIODS.map((value) => ({
          value,
          label: PERIOD_LABELS[value],
        }))}
        value={period}
        onChange={setPeriod}
      />

      {/* --- Summary ------------------------------------------------------- */}

      <section className="flex flex-col gap-3">
        <SectionHeader title={SUMMARY_TITLES[period]} />
        <Card padding="none" className="grid grid-cols-3 divide-x divide-border-subtle">
          <StatCell
            label="Focus time"
            value={noFocus ? '0m' : formatDuration(focus.totalMs)}
            footer={focusDelta}
          />
          <StatCell
            label="Completed"
            value={String(report.activities.completed)}
            footer={completedDelta}
          />
          <StatCell
            label="Routines"
            value={
              report.routines.completionRate === null
                ? '—'
                : percentOf(report.routines.completionRate)
            }
          />
        </Card>
      </section>

      {/* --- Focus --------------------------------------------------------- */}

      <section className="flex flex-col gap-3">
        <SectionHeader title="Focus" />
        {noFocus ? (
          <EmptyState
            size="compact"
            icon={<BarChart3 size={22} strokeWidth={1.75} />}
            title="No focus data yet"
            description={`Complete your first Focus session and TimePilot will start learning your patterns. Nothing is recorded for ${PERIOD_LABELS[period].toLowerCase()} so far.`}
          />
        ) : (
          <Card padding="sm">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-secondary">
              <span className="tabular">
                {String(focus.sessionCount)}{' '}
                {focus.sessionCount === 1 ? 'session' : 'sessions'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                average{' '}
                <span className="tabular">
                  {focus.averageMs === null
                    ? '—'
                    : formatDuration(focus.averageMs)}
                </span>
              </span>
              {focus.withBlockingCount > 0 ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    <span className="tabular">
                      {formatDuration(focus.withBlockingMs)}
                    </span>{' '}
                    with blocking
                  </span>
                </>
              ) : null}
            </div>

            <FocusChart
              className="mt-4"
              bars={bars}
              ariaLabel={
                period === 'today'
                  ? 'Focus time by hour today'
                  : `Focus time per day, ${PERIOD_LABELS[period].toLowerCase()}`
              }
            />

            {focus.withBlockingCount > 0 ? (
              <p className="mt-3 text-2xs leading-relaxed text-muted">
                “With blocking” is time in completed sessions that had a
                blocklist attached. Whether blocking held for every minute is
                not recorded, so it is the requested measure, not a verified
                one.
              </p>
            ) : null}
          </Card>
        )}
      </section>

      {/* --- Activities ---------------------------------------------------- */}

      <section className="flex flex-col gap-3">
        <SectionHeader title="Activities" />
        {noActivities ? (
          <EmptyState
            size="compact"
            icon={<BarChart3 size={22} strokeWidth={1.75} />}
            title="No activity data yet"
            description={`Reminders and timers you complete will be counted here. Nothing fired in ${PERIOD_LABELS[period].toLowerCase()}.`}
          />
        ) : (
          <Card padding="sm">
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-2xs text-muted">Completed</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular text-primary">
                  {String(report.activities.completed)}
                </dd>
              </div>
              <div>
                <dt className="text-2xs text-muted">Missed</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular text-primary">
                  {String(report.activities.missed)}
                </dd>
              </div>
              <div>
                <dt className="text-2xs text-muted">Rate</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular text-primary">
                  {report.activities.completionRate === null
                    ? '—'
                    : percentOf(report.activities.completionRate)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-2xs leading-relaxed text-muted">
              The rate counts fired activities you marked done against those
              left undone past their reminder window. A repeating activity
              contributes its most recent fired occurrence.
            </p>
          </Card>
        )}
      </section>

      {/* --- Habits -------------------------------------------------------- */}

      <section className="flex flex-col gap-3">
        <SectionHeader title="Habits" />
        {noRoutines ? (
          <EmptyState
            size="compact"
            icon={<BarChart3 size={22} strokeWidth={1.75} />}
            title="No routine data yet"
            description="Steps from your routines are counted here once a routine has scheduled them."
          />
        ) : (
          <Card padding="sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-secondary">
                Routine completion{' '}
                <span className="font-semibold tabular text-primary">
                  {report.routines.completionRate === null
                    ? '—'
                    : percentOf(report.routines.completionRate)}
                </span>
              </p>
              {report.routines.mostConsistent ? (
                <Badge tone="good" dot>
                  Most consistent · {report.routines.mostConsistent.name}
                </Badge>
              ) : null}
            </div>

            <div
              className={cn(
                'divide-y divide-border-subtle',
                report.routines.perRoutine.length > 0 && 'mt-3',
              )}
            >
              {report.routines.perRoutine.map((routine) => (
                <RoutineRow
                  key={routine.routineId}
                  name={routine.name}
                  completed={routine.completed}
                  missed={routine.missed}
                  isBest={
                    report.routines.mostConsistent?.routineId ===
                    routine.routineId
                  }
                />
              ))}
            </div>
          </Card>
        )}
      </section>

      {/* --- Best time ----------------------------------------------------- */}

      {focus.bestTime ? (
        <section className="flex flex-col gap-3">
          <SectionHeader title="Your best time" />
          <Card padding="sm" className="flex items-center gap-3.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent"
              aria-hidden="true"
            >
              <Clock size={18} strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-lg font-semibold tabular text-primary">
                {hourRange(focus.bestTime.startHour, focus.bestTime.endHour)}
              </p>
              <p className="text-xs text-secondary">
                Your strongest focus period ·{' '}
                {String(focus.bestTime.sessionCount)}{' '}
                {focus.bestTime.sessionCount === 1
                  ? 'session'
                  : 'sessions'}{' '}
                started here
              </p>
            </div>
          </Card>
        </section>
      ) : null}
    </div>
  )
}
