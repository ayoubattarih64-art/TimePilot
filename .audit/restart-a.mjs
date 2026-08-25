import { browser, evaluate, ok, page } from './harness.mjs'

/**
 * Part 1 of the restart test: leave live state behind, then close the browser.
 *
 * Writes a running focus session (blocking active), a running timer, and a
 * recurring reminder, prints what it created, and exits. `restart-b.mjs` reads
 * the same profile back after a relaunch.
 */

const EXT = process.argv[2]
const cdp = await browser()
const { sessionId } = await page(cdp, `chrome-extension://${EXT}/sidepanel.html`)
await new Promise((r) => setTimeout(r, 2500))

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

/* Clean slate, then the three live things a restart has to survive. */

await run(`
  const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  for (const a of list.data.activities) {
    await chrome.runtime.sendMessage({ type: 'scheduled/remove', id: a.id })
  }
  await chrome.runtime.sendMessage({ type: 'focus/cancel' })
  await chrome.runtime.sendMessage({ type: 'timer/cancel' })
  return true
`)

const lists = await send({ type: 'blocklist/list' })
const focusList = lists.data.blocklists.find((l) => l.mode === 'focus')

// A blocklist with no domains installs no rules — correctly, since there is
// nothing to block. flow-7 deliberately leaves a degraded `[{ id: 'x' }]` in
// storage to prove reads survive it, so whichever list is found here may be
// empty. Seed one domain so "blocking is in force" is a claim about the engine
// rather than about which flow ran last.
if (focusList.domains.length === 0) {
  await send({ type: 'blocklist/add-domain', id: focusList.id, domain: 'example.com' })
}

// Daily, an hour out: its alarm must be rebuilt after the restart.
const reminder = await send({
  type: 'scheduled/create',
  input: {
    title: 'Survives restart',
    type: 'reminder',
    ...keys(Date.now() + 60 * 60_000),
    repeat: 'daily',
    durationMinutes: 0,
    categoryId: 'personal',
    notify: 'at-time',
    enabled: true,
  },
})

const focus = await send({
  type: 'focus/start',
  input: {
    title: 'Restart focus',
    durationMinutes: 60,
    activityId: null,
    blocklistId: focusList.id,
  },
})

const timer = await send({
  type: 'timer/start',
  input: { title: 'Restart timer', durationMinutes: 45 },
})

const state = await run(`
  const alarms = (await chrome.alarms.getAll()).map((a) => a.name).sort()
  const dnr = await chrome.declarativeNetRequest.getDynamicRules()
  return {
    alarms,
    owned: dnr.filter((r) => r.id >= 1000000 && r.id <= 1009999).length,
  }
`)

ok('reminder, focus and timer are all live before the restart',
  typeof reminder?.data?.activity?.id === 'string' &&
    focus?.data?.started === true &&
    timer?.data?.started === true,
  `focus=${focus?.data?.session?.status} timer=${timer?.data?.timer?.status}`,
)
ok('blocking is in force before the restart', state.owned > 0, `owned=${state.owned}`)

console.log(
  JSON.stringify({
    activityId: reminder.data.activity.id,
    activityFiresAt: reminder.data.scheduledAt,
    focusId: focus.data.session.id,
    focusEndsAt: focus.data.session.endsAt,
    timerId: timer.data.timer.id,
    timerEndsAt: timer.data.timer.endsAt,
    owned: state.owned,
    alarms: state.alarms,
  }),
)

cdp.close()
