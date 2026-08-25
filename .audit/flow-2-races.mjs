import { browser, evaluate, ok, page } from './harness.mjs'

/**
 * Concurrency probe: how far the read-modify-write race on a storage key goes.
 *
 * Every mutation in the worker is `read whole key -> modify -> write whole key`
 * with no serialisation, so two handlers that overlap both read the same array
 * and the second write erases the first. This measures it on each collection.
 */

const EXT = process.argv[2]
const cdp = await browser()
const { sessionId } = await page(cdp, `chrome-extension://${EXT}/sidepanel.html`)
await new Promise((r) => setTimeout(r, 2000))

const run = (body) => evaluate(cdp, sessionId, `(async () => { ${body} })()`)
const send = (req) =>
  run(`return await chrome.runtime.sendMessage(${JSON.stringify(req)})`)

const keys = (at) => {
  const d = new Date(at)
  const p = (n) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  }
}
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

/* --- Clean slate ---------------------------------------------------------- */

await run(`
  const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  for (const a of list.data.activities) {
    await chrome.runtime.sendMessage({ type: 'scheduled/remove', id: a.id })
  }
  const rl = await chrome.runtime.sendMessage({ type: 'routine/list' })
  for (const r of rl.data.routines) {
    await chrome.runtime.sendMessage({ type: 'routine/remove', id: r.id })
  }
  return true
`)

/* --- 1. Parallel creates on one key --------------------------------------- */

const parallel = await run(`
  const input = ${JSON.stringify(reminderInput(Date.now() + 20 * 60_000, 'P'))}
  const res = await Promise.all(
    Array.from({ length: 5 }, () =>
      chrome.runtime.sendMessage({ type: 'scheduled/create', input }),
    ),
  )
  const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  return {
    acked: res.filter((r) => r.ok).length,
    persisted: list.data.activities.filter((a) => a.title === 'P').length,
  }
`)
ok(
  'parallel scheduled/create: every acked activity is persisted',
  parallel.acked === parallel.persisted,
  `acked=${parallel.acked} persisted=${parallel.persisted}`,
)

/* --- 2. Sequential creates are fine (isolates the cause) ------------------ */

const sequential = await run(`
  const base = ${JSON.stringify(reminderInput(Date.now() + 25 * 60_000, 'S'))}
  for (let i = 0; i < 5; i++) {
    await chrome.runtime.sendMessage({ type: 'scheduled/create', input: base })
  }
  const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  return list.data.activities.filter((a) => a.title === 'S').length
`)
ok(
  'sequential scheduled/create: all five persist',
  sequential === 5,
  `persisted=${String(sequential)}`,
)

/* --- 3. Create racing a routine sweep ------------------------------------- */
// routines.generate() rewrites the whole `scheduled` key, and the 30-minute
// routine-scan alarm calls it. A user create that overlaps it can be erased.

const sweepRace = await run(`
  const input = ${JSON.stringify(reminderInput(Date.now() + 30 * 60_000, 'SweepRace'))}
  const [created] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'scheduled/create', input }),
    chrome.runtime.sendMessage({ type: 'routine/list' }),
    chrome.runtime.sendMessage({ type: 'scheduled/list' }),
  ])
  const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  return {
    id: created.data?.activity?.id ?? null,
    survives: list.data.activities.some((a) => a.id === created.data?.activity?.id),
  }
`)
ok(
  'a create that overlaps reads survives',
  sweepRace.survives === true,
  `id=${String(sweepRace.id)} survives=${String(sweepRace.survives)}`,
)

/* --- 4. Parallel timer starts --------------------------------------------- */

await send({ type: 'timer/cancel' })
const timerRace = await run(`
  const res = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      chrome.runtime.sendMessage({
        type: 'timer/start',
        input: { title: 'Race' + i, durationMinutes: 10 },
      }),
    ),
  )
  const all = await chrome.storage.local.get('timers')
  const live = (all.timers ?? []).filter(
    (t) => t.status === 'running' || t.status === 'paused',
  )
  const alarms = await chrome.alarms.getAll()
  return {
    startedTrue: res.filter((r) => r.data?.started === true).length,
    live: live.length,
    stored: (all.timers ?? []).length,
    timerAlarms: alarms.filter((a) => a.name.startsWith('timepilot:timer:')).length,
  }
`)
ok(
  'parallel timer/start leaves exactly one live timer',
  timerRace.live === 1,
  `startedTrue=${timerRace.startedTrue} live=${timerRace.live} stored=${timerRace.stored} alarms=${timerRace.timerAlarms}`,
)
ok(
  'parallel timer/start leaves exactly one timer alarm',
  timerRace.timerAlarms === 1,
  `alarms=${timerRace.timerAlarms}`,
)
await send({ type: 'timer/cancel' })

/* --- 5. Parallel focus starts --------------------------------------------- */

await send({ type: 'focus/cancel' })
const focusRace = await run(`
  const res = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      chrome.runtime.sendMessage({
        type: 'focus/start',
        input: { title: 'F' + i, durationMinutes: 25, activityId: null },
      }),
    ),
  )
  const all = await chrome.storage.local.get('focusSessions')
  const live = (all.focusSessions ?? []).filter(
    (s) => s.status === 'running' || s.status === 'paused',
  )
  const alarms = await chrome.alarms.getAll()
  return {
    startedTrue: res.filter((r) => r.data?.started === true).length,
    errors: res.filter((r) => r.ok === false).map((r) => r.error),
    live: live.length,
    focusAlarms: alarms.filter((a) => a.name.startsWith('timepilot:focus:')).length,
  }
`)
ok(
  'parallel focus/start leaves exactly one live session',
  focusRace.live === 1,
  `startedTrue=${focusRace.startedTrue} live=${focusRace.live} alarms=${focusRace.focusAlarms} errors=${focusRace.errors.join('|')}`,
)
await send({ type: 'focus/cancel' })

/* --- 6. Parallel settings writes ------------------------------------------ */
// Two independent fields on one key: the classic lost-update shape.

const settingsRace = await run(`
  await chrome.runtime.sendMessage({ type: 'settings/set-notifications', enabled: true })
  const [a] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'settings/set-notifications', enabled: false }),
    chrome.runtime.sendMessage({ type: 'settings/complete-onboarding' }),
  ])
  const got = await chrome.runtime.sendMessage({ type: 'settings/get' })
  return { ...got.data.settings, acked: a.data?.settings }
`)
ok(
  'parallel settings writes keep both fields',
  settingsRace.notificationsEnabled === false &&
    typeof settingsRace.onboardingCompletedAt === 'number',
  `notificationsEnabled=${String(settingsRace.notificationsEnabled)} onboardingCompletedAt=${String(settingsRace.onboardingCompletedAt)}`,
)

cdp.close()
