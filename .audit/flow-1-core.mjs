import { browser, evaluate, ok, page, targets } from './harness.mjs'

/**
 * End-to-end runtime verification against the real built extension.
 *
 * Everything runs inside an extension page, so `chrome.runtime.sendMessage`
 * reaches the real worker and `chrome.alarms` / `chrome.declarativeNetRequest`
 * report what Chrome actually holds — no mocks anywhere.
 */

const EXT = process.argv[2]
const cdp = await browser()

const { sessionId } = await page(
  cdp,
  `chrome-extension://${EXT}/sidepanel.html`,
)
await new Promise((r) => setTimeout(r, 2500))

/** Run an async expression in the page and return its value. */
const run = (body) => evaluate(cdp, sessionId, `(async () => { ${body} })()`)

const send = (req) =>
  run(`return await chrome.runtime.sendMessage(${JSON.stringify(req)})`)

/** Local "YYYY-MM-DD" / "HH:MM" pair for an epoch, matching the model's keys. */
const keys = (at) => {
  const d = new Date(at)
  const p = (n) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  }
}

/** A complete NewScheduledActivity, as the UI would build it. */
const reminderInput = (at, title) => ({
  title,
  type: 'reminder',
  ...keys(at),
  repeat: 'none',
  durationMinutes: 0,
  categoryId: 'personal',
  notify: 'at-time',
  enabled: true,
})

/* --- 0. Baseline ---------------------------------------------------------- */

const ping = await send({ type: 'ping' })
ok('worker answers ping', ping?.ok === true, JSON.stringify(ping?.data))

const storeKeys = await run(
  `const all = await chrome.storage.local.get(null); return Object.keys(all).sort()`,
)
ok(
  'install seeded every storage key',
  ['blocklists', 'focusSessions', 'routines', 'scheduled', 'schemaVersion', 'settings', 'timers'].every(
    (k) => storeKeys.includes(k),
  ),
  storeKeys.join(','),
)

const seeded = await send({ type: 'blocklist/list' })
ok(
  'default blocklists seeded',
  Array.isArray(seeded?.data?.blocklists) && seeded.data.blocklists.length > 0,
  seeded?.data?.blocklists?.map((l) => `${l.name}(${l.domains.length},${l.mode},en=${l.enabled})`).join(' '),
)

const settings = await send({ type: 'settings/get' })
ok(
  'onboarding starts incomplete',
  settings?.data?.settings?.onboardingCompletedAt === null,
  JSON.stringify(settings?.data?.settings),
)

/* --- 1. Reminder flow ----------------------------------------------------- */

const soon = Date.now() + 5 * 60_000
const created = await send({
  type: 'scheduled/create',
  input: reminderInput(soon, 'Audit reminder'),
})
const activityId = created?.data?.activity?.id
ok(
  'reminder created',
  typeof activityId === 'string',
  created?.ok === false
    ? `error=${created?.error}`
    : `scheduledAt=${String(created?.data?.scheduledAt)}`,
)

const alarms1 = await run(
  `const a = await chrome.alarms.getAll(); return a.map(x => x.name + '@' + x.scheduledTime)`,
)
ok(
  'reminder produced an activity alarm',
  alarms1.some((n) => n.startsWith(`timepilot:activity:${activityId}`)),
  alarms1.join(' '),
)
ok(
  'periodic sweeps registered, no legacy tick',
  alarms1.some((n) => n.startsWith('timepilot:schedule-sweep')) &&
    alarms1.some((n) => n.startsWith('timepilot:routine-scan')) &&
    !alarms1.some((n) => n.startsWith('timepilot:tick')),
  alarms1.join(' '),
)

const disabled = await send({
  type: 'scheduled/set-enabled',
  id: activityId,
  enabled: false,
})
const alarms2 = await run(
  `const a = await chrome.alarms.getAll(); return a.map(x => x.name)`,
)
ok(
  'disabling clears the alarm',
  !alarms2.some((n) => n === `timepilot:activity:${activityId}`),
  `scheduledAt=${String(disabled?.data?.scheduledAt)} alarms=${alarms2.join(' ')}`,
)

await send({ type: 'scheduled/set-enabled', id: activityId, enabled: true })
const alarms3 = await run(
  `const a = await chrome.alarms.getAll(); return a.map(x => x.name)`,
)
ok(
  're-enabling restores the alarm',
  alarms3.includes(`timepilot:activity:${activityId}`),
  alarms3.join(' '),
)

/* --- 2. Duplicate clicks / simultaneous actions --------------------------- */

const raceInput = reminderInput(Date.now() + 9 * 60_000, 'Race')
const dupes = await run(`
  const reqs = Array.from({ length: 5 }, () => ({
    type: 'scheduled/create',
    input: ${JSON.stringify(raceInput)},
  }))
  const res = await Promise.all(reqs.map((r) => chrome.runtime.sendMessage(r)))
  const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  return {
    ids: res.map((r) => r.data?.activity?.id ?? null),
    errors: res.filter((r) => r.ok === false).map((r) => r.error),
    races: list.data.activities.filter((a) => a.title === 'Race').length,
  }
`)
ok(
  'five parallel creates all persisted (no lost write)',
  dupes.races === 5 && new Set(dupes.ids.filter(Boolean)).size === 5,
  `persisted=${dupes.races} unique=${new Set(dupes.ids.filter(Boolean)).size} errors=${dupes.errors.join('|')}`,
)

/* --- 3. Timer flow -------------------------------------------------------- */

const t1 = await send({ type: 'timer/start', input: { title: 'Audit timer', durationMinutes: 25 } })
const timerId = t1?.data?.timer?.id
ok('timer started', t1?.data?.started === true && !!timerId, t1?.data?.timer?.status)

const t2 = await send({ type: 'timer/start', input: { title: 'Second', durationMinutes: 5 } })
ok(
  'second timer refused, live one returned',
  t2?.data?.started === false && t2?.data?.timer?.id === timerId,
  JSON.stringify(t2?.data?.timer?.status),
)

const tAlarms = await run(
  `const a = await chrome.alarms.getAll(); return a.filter(x => x.name.startsWith('timepilot:timer:')).map(x => x.name)`,
)
ok('timer alarm exists', tAlarms.length === 1, tAlarms.join(' '))

const tp = await send({ type: 'timer/pause' })
const tAlarmsPaused = await run(
  `const a = await chrome.alarms.getAll(); return a.filter(x => x.name.startsWith('timepilot:timer:')).map(x => x.name)`,
)
ok(
  'pausing clears the timer alarm and freezes remaining',
  tp?.data?.timer?.status === 'paused' &&
    tp?.data?.timer?.endsAt === null &&
    typeof tp?.data?.timer?.remainingMs === 'number' &&
    tAlarmsPaused.length === 0,
  `status=${tp?.data?.timer?.status} remaining=${tp?.data?.timer?.remainingMs} alarms=${tAlarmsPaused.length}`,
)

// A paused timer must not lose time across a reload of the surface.
const frozen1 = tp.data.timer.remainingMs
await new Promise((r) => setTimeout(r, 1500))
const tc = await send({ type: 'timer/current' })
ok(
  'paused timer does not count down',
  tc?.data?.timer?.remainingMs === frozen1,
  `${String(frozen1)} -> ${String(tc?.data?.timer?.remainingMs)}`,
)

const tr = await send({ type: 'timer/resume' })
const tAlarmsResumed = await run(
  `const a = await chrome.alarms.getAll(); return a.filter(x => x.name.startsWith('timepilot:timer:')).length`,
)
ok(
  'resuming restores endsAt and the alarm',
  tr?.data?.timer?.status === 'running' &&
    typeof tr?.data?.timer?.endsAt === 'number' &&
    tAlarmsResumed === 1,
  `status=${tr?.data?.timer?.status} alarms=${String(tAlarmsResumed)}`,
)

const tAdd = await send({ type: 'timer/add', minutes: 5 })
ok(
  'add time extends the running timer',
  (tAdd?.data?.timer?.endsAt ?? 0) > (tr?.data?.timer?.endsAt ?? 0),
  `${String(tr?.data?.timer?.endsAt)} -> ${String(tAdd?.data?.timer?.endsAt)}`,
)

await send({ type: 'timer/cancel' })
const tAfterCancel = await send({ type: 'timer/current' })
const tAlarmsCancelled = await run(
  `const a = await chrome.alarms.getAll(); return a.filter(x => x.name.startsWith('timepilot:timer:')).length`,
)
ok(
  'cancel settles the timer and clears its alarm',
  tAfterCancel?.data?.timer === null &&
    tAfterCancel?.data?.last?.status === 'cancelled' &&
    tAlarmsCancelled === 0,
  `current=${String(tAfterCancel?.data?.timer)} last=${tAfterCancel?.data?.last?.status}`,
)

/* --- 4. Timer completion (real alarm, real notification) ------------------ */

// One minute is the model's floor (`clampTimerMinutes`), so this is the
// shortest timer the product can actually hold — and the alarm that ends it is
// a genuine Chrome delivery rather than an immediate fire.
const shortStart = await run(`
  const res = await chrome.runtime.sendMessage({
    type: 'timer/start', input: { title: 'Short', durationMinutes: 1 },
  })
  return res.data
`)
ok('short timer started', shortStart?.started === true, String(shortStart?.timer?.endsAt))

await new Promise((r) => setTimeout(r, 66_000))
const afterFire = await send({ type: 'timer/current' })
ok(
  'timer completed on its own alarm',
  afterFire?.data?.timer === null && afterFire?.data?.last?.status === 'completed',
  `current=${String(afterFire?.data?.timer)} last=${afterFire?.data?.last?.status}`,
)
const leftoverTimerAlarms = await run(
  `const a = await chrome.alarms.getAll(); return a.filter(x => x.name.startsWith('timepilot:timer:')).length`,
)
ok('no timer alarm left behind', leftoverTimerAlarms === 0, String(leftoverTimerAlarms))

console.log('--- targets at end ---')
for (const t of await targets(cdp)) console.log(`${t.type.padEnd(16)} ${t.url.slice(0, 80)}`)

cdp.close()
