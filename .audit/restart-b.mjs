import { browser, evaluate, ok, page } from './harness.mjs'

/**
 * Part 2: the same profile, after a real browser close and relaunch.
 *
 * `restart-a.mjs`'s JSON line is passed in as argv[3]. Nothing here re-creates
 * state: every assertion is about what survived the restart and what
 * `onStartup` rebuilt.
 */

const EXT = process.argv[2]
const before = JSON.parse(process.argv[3])
const cdp = await browser()
const { sessionId } = await page(cdp, `chrome-extension://${EXT}/sidepanel.html`)
await new Promise((r) => setTimeout(r, 3000))

const run = (body) => evaluate(cdp, sessionId, `(async () => { ${body} })()`)
const send = (req) =>
  run(`return await chrome.runtime.sendMessage(${JSON.stringify(req)})`)

/* --- Storage survived ----------------------------------------------------- */

const activity = await run(`
  const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  return list.data.activities.find((a) => a.id === '${before.activityId}') ?? null
`)
ok(
  'the reminder survived the restart',
  activity !== null && activity.title === 'Survives restart',
  activity ? `${activity.title} ${activity.date} ${activity.time}` : 'missing',
)

/* --- Alarms were rebuilt by onStartup ------------------------------------- */

const alarms = await run(
  `const a = await chrome.alarms.getAll(); return a.map(x => x.name).sort()`,
)
ok(
  "the reminder's alarm is present after the restart",
  alarms.includes(`timepilot:activity:${before.activityId}`),
  alarms.join(' '),
)
ok(
  'the periodic sweeps were re-registered',
  alarms.includes('timepilot:routine-scan') &&
    alarms.includes('timepilot:schedule-sweep'),
  alarms.join(' '),
)
ok(
  'no legacy tick alarm reappeared',
  !alarms.some((n) => n === 'timepilot:tick'),
  alarms.filter((n) => n.startsWith('timepilot:tick')).join(' '),
)

/* --- The live focus session is still live, and still blocking ------------- */

const focus = await send({ type: 'focus/current' })
ok(
  'the running focus session is still running',
  focus?.data?.session?.id === before.focusId &&
    focus?.data?.session?.status === 'running',
  `id=${String(focus?.data?.session?.id)} status=${String(focus?.data?.session?.status)}`,
)
ok(
  'its countdown continued against the wall clock, not from zero',
  typeof focus?.data?.session?.endsAt === 'number' &&
    focus.data.session.endsAt === before.focusEndsAt,
  `${String(before.focusEndsAt)} -> ${String(focus?.data?.session?.endsAt)}`,
)

const dnr = await run(`
  const all = await chrome.declarativeNetRequest.getDynamicRules()
  return all.filter((r) => r.id >= 1000000 && r.id <= 1009999).length
`)
ok(
  'blocking is still in force for the surviving session',
  dnr === before.owned,
  `owned=${String(dnr)} before=${String(before.owned)}`,
)
ok(
  'and the session has its end alarm back',
  alarms.includes(`timepilot:focus:${before.focusId}`),
  alarms.filter((n) => n.startsWith('timepilot:focus:')).join(' '),
)

/* --- The live timer likewise --------------------------------------------- */

const timer = await send({ type: 'timer/current' })
ok(
  'the running timer is still running with the same end',
  timer?.data?.timer?.id === before.timerId &&
    timer?.data?.timer?.status === 'running' &&
    timer.data.timer.endsAt === before.timerEndsAt,
  `id=${String(timer?.data?.timer?.id)} status=${String(timer?.data?.timer?.status)} endsAt=${String(timer?.data?.timer?.endsAt)}`,
)
ok(
  'and has its alarm back',
  alarms.includes(`timepilot:timer:${before.timerId}`),
  alarms.filter((n) => n.startsWith('timepilot:timer:')).join(' '),
)

/* --- Onboarding state is not reset by a restart -------------------------- */

const settings = await send({ type: 'settings/get' })
ok(
  'settings survived (a restart is not a fresh install)',
  settings?.data?.settings !== undefined,
  JSON.stringify(settings?.data?.settings),
)

await send({ type: 'focus/cancel' })
await send({ type: 'timer/cancel' })
cdp.close()
