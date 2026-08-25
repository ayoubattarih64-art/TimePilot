import { browser, evaluate, ok, page } from './harness.mjs'

/**
 * Routines: create → generate → edit → disable → enable → delete.
 *
 * Routines own no alarms. Every assertion below therefore checks two things at
 * once: the generated `ScheduledActivity` rows, and the alarms the ordinary
 * scheduler derived from them. Ownership is `routineId` AND `routineStepId`.
 */

const EXT = process.argv[2]
const cdp = await browser()
const { sessionId } = await page(cdp, `chrome-extension://${EXT}/sidepanel.html`)
await new Promise((r) => setTimeout(r, 2500))

const run = (body) => evaluate(cdp, sessionId, `(async () => { ${body} })()`)
const send = (req) =>
  run(`return await chrome.runtime.sendMessage(${JSON.stringify(req)})`)

/** Generated rows for one routine, plus the alarms that exist for them. */
const owned = (routineId) =>
  run(`
    const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
    const rows = list.data.activities.filter(
      (a) => a.routineId === '${routineId}' && a.routineStepId,
    )
    const alarms = (await chrome.alarms.getAll()).map((a) => a.name)
    return {
      rows: rows.map((a) => ({
        id: a.id, title: a.title, time: a.time, date: a.date,
        type: a.type, enabled: a.enabled, repeat: a.repeat,
        stepType: a.routineStepType,
        hasAlarm: alarms.includes('timepilot:activity:' + a.id),
      })),
      total: list.data.activities.length,
    }
  `)

/* --- Clean slate ---------------------------------------------------------- */

await run(`
  const rl = await chrome.runtime.sendMessage({ type: 'routine/list' })
  for (const r of rl.data.routines) {
    await chrome.runtime.sendMessage({ type: 'routine/remove', id: r.id })
  }
  const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  for (const a of list.data.activities) {
    await chrome.runtime.sendMessage({ type: 'scheduled/remove', id: a.id })
  }
  return true
`)

/* --- 1. Create: three steps expand into three scheduled rows -------------- */

const created = await send({
  type: 'routine/create',
  input: {
    name: 'Audit morning',
    description: 'Three steps',
    categoryId: 'health',
    daysOfWeek: [],
    startTime: '07:00',
    steps: [
      { title: 'Stretch', durationMinutes: 10, type: 'reminder' },
      { title: 'Read', durationMinutes: 20, type: 'timer' },
      { title: 'Deep work', durationMinutes: 50, type: 'focus' },
    ],
    enabled: true,
  },
})
const routineId = created?.data?.routine?.id
ok(
  'routine created',
  created?.data?.ok === true && typeof routineId === 'string',
  created?.ok === false
    ? `error=${created?.error}`
    : `generated=${String(created?.data?.generated)}`,
)

const afterCreate = await owned(routineId)
ok(
  'every step generated one scheduled row',
  afterCreate.rows.length === 3,
  afterCreate.rows.map((r) => `${r.title}@${r.time}(${r.stepType})`).join(' '),
)
ok(
  'steps are laid out back to back from the start time',
  afterCreate.rows.some((r) => r.time === '07:00') &&
    afterCreate.rows.some((r) => r.time === '07:10') &&
    afterCreate.rows.some((r) => r.time === '07:30'),
  afterCreate.rows.map((r) => `${r.title}=${r.time}`).join(' '),
)
ok(
  'the reminder step got an alarm from the ordinary scheduler',
  afterCreate.rows.filter((r) => r.hasAlarm).length > 0,
  afterCreate.rows.map((r) => `${r.title}:${String(r.hasAlarm)}`).join(' '),
)

/* --- 2. Generation is idempotent ------------------------------------------ */

const regenerated = await send({ type: 'routine/list' })
ok('routine/list returns the routine', regenerated?.data?.routines?.length === 1, '')

const beforeIds = afterCreate.rows.map((r) => r.id).sort().join(',')
// A no-op mutation runs generate() again; the same rows must be reused, not
// deleted and re-created, or every regeneration would lose the fire marks.
await send({ type: 'routine/set-enabled', id: routineId, enabled: true })
const afterNoop = await owned(routineId)
ok(
  'regenerating reuses the same rows (no churn)',
  afterNoop.rows.map((r) => r.id).sort().join(',') === beforeIds,
  `${afterNoop.rows.length} rows`,
)

/* --- 3. Edit: retiming moves the rows, renaming updates in place ---------- */

const edited = await send({
  type: 'routine/update',
  id: routineId,
  input: {
    name: 'Audit morning',
    description: 'Three steps',
    categoryId: 'health',
    daysOfWeek: [],
    startTime: '08:15',
    steps: [
      { title: 'Stretch longer', durationMinutes: 15, type: 'reminder' },
      { title: 'Read', durationMinutes: 20, type: 'timer' },
    ],
    enabled: true,
  },
})
const afterEdit = await owned(routineId)
ok(
  'editing to two steps leaves exactly two rows',
  edited?.data?.ok === true && afterEdit.rows.length === 2,
  afterEdit.rows.map((r) => `${r.title}@${r.time}`).join(' '),
)
ok(
  'the retimed steps start at the new time',
  afterEdit.rows.some((r) => r.time === '08:15') &&
    afterEdit.rows.some((r) => r.time === '08:30'),
  afterEdit.rows.map((r) => r.time).join(' '),
)
ok(
  'the dropped step left no orphan alarm',
  await run(`
    const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
    const ids = new Set(list.data.activities.map((a) => a.id))
    const alarms = (await chrome.alarms.getAll())
      .filter((a) => a.name.startsWith('timepilot:activity:'))
      .map((a) => a.name.slice('timepilot:activity:'.length))
    return alarms.every((id) => ids.has(id))
  `),
  '',
)

/* --- 4. Disable: rows stop firing ---------------------------------------- */

const disabled = await send({
  type: 'routine/set-enabled',
  id: routineId,
  enabled: false,
})
const afterDisable = await owned(routineId)
ok(
  'disabling the routine removes its generated rows',
  disabled?.data?.ok === true && afterDisable.rows.length === 0,
  `rows=${afterDisable.rows.length} total=${afterDisable.total}`,
)
ok(
  'and leaves no activity alarms behind',
  await run(`
    const alarms = (await chrome.alarms.getAll()).filter((a) =>
      a.name.startsWith('timepilot:activity:'),
    )
    return alarms.length === 0
  `),
  '',
)

/* --- 5. Re-enable: rows come back ---------------------------------------- */

await send({ type: 'routine/set-enabled', id: routineId, enabled: true })
const afterEnable = await owned(routineId)
ok(
  're-enabling regenerates the rows',
  afterEnable.rows.length === 2,
  afterEnable.rows.map((r) => `${r.title}@${r.time}`).join(' '),
)

/* --- 6. Retire-not-delete: a row with history survives deletion ---------- */
// Mark one generated row completed, then delete the routine. The row must
// survive as a disabled, detached activity rather than be erased.

const historyId = afterEnable.rows[0].id
await send({ type: 'scheduled/complete', id: historyId })

const removed = await send({ type: 'routine/remove', id: routineId })
const afterRemove = await run(`
  const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  const rl = await chrome.runtime.sendMessage({ type: 'routine/list' })
  const kept = list.data.activities.find((a) => a.id === '${historyId}')
  return {
    routines: rl.data.routines.length,
    total: list.data.activities.length,
    kept: kept
      ? { enabled: kept.enabled, routineId: kept.routineId, completed: kept.lastCompletedAt }
      : null,
    stillGenerated: list.data.activities.filter((a) => a.routineId).length,
  }
`)
ok(
  'deleting the routine removes it',
  removed?.data?.removed === true && afterRemove.routines === 0,
  `routines=${afterRemove.routines}`,
)
ok(
  'a row that carries history is retired, not deleted',
  afterRemove.kept !== null &&
    afterRemove.kept.enabled === false &&
    afterRemove.kept.routineId === null &&
    typeof afterRemove.kept.completed === 'number',
  JSON.stringify(afterRemove.kept),
)
ok(
  'a row with no history is deleted outright',
  afterRemove.stillGenerated === 0 && afterRemove.total === 1,
  `total=${afterRemove.total} stillGenerated=${afterRemove.stillGenerated}`,
)
ok(
  'nothing is left scheduled for the retired row',
  await run(`
    const alarms = (await chrome.alarms.getAll()).filter((a) =>
      a.name.startsWith('timepilot:activity:'),
    )
    return alarms.length === 0
  `),
  '',
)

cdp.close()
