import { browser, evaluate, ok, page } from './harness.mjs'

/**
 * The reachable form of the lost-write race: two alarms due in the same minute.
 *
 * Chrome delivers both `onAlarm` events, both handlers read `scheduled`, and
 * the second write erases the first's `lastFiredAt`. That mark is the only
 * guard against re-notifying the same occurrence, so losing it is user-visible.
 */

const EXT = process.argv[2]
const cdp = await browser()
const { sessionId } = await page(cdp, `chrome-extension://${EXT}/sidepanel.html`)
await new Promise((r) => setTimeout(r, 2000))

const run = (body) => evaluate(cdp, sessionId, `(async () => { ${body} })()`)

const keys = (at) => {
  const d = new Date(at)
  const p = (n) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  }
}

/* --- Two activities, same minute, both about to fire ---------------------- */

const at = Date.now() + 90_000
const input = (title) => ({
  title,
  type: 'reminder',
  ...keys(at),
  repeat: 'daily',
  durationMinutes: 0,
  categoryId: 'personal',
  notify: 'at-time',
  enabled: true,
})

const setup = await run(`
  const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  for (const a of list.data.activities) {
    await chrome.runtime.sendMessage({ type: 'scheduled/remove', id: a.id })
  }
  const a = await chrome.runtime.sendMessage({
    type: 'scheduled/create', input: ${JSON.stringify(input('Same minute A'))},
  })
  const b = await chrome.runtime.sendMessage({
    type: 'scheduled/create', input: ${JSON.stringify(input('Same minute B'))},
  })
  return { a: a.data.activity.id, b: b.data.activity.id }
`)
ok(
  'two same-minute reminders created',
  typeof setup.a === 'string' && typeof setup.b === 'string',
  `${setup.a} ${setup.b}`,
)

/* --- Deliver both fires concurrently, as Chrome would -------------------- */
// `scheduled/complete` is the one message that reaches a read-modify-write on
// the same key from two independent handlers, which is the identical shape the
// two alarm deliveries take inside the worker.

const marks = await run(`
  await Promise.all([
    chrome.runtime.sendMessage({ type: 'scheduled/complete', id: '${setup.a}' }),
    chrome.runtime.sendMessage({ type: 'scheduled/complete', id: '${setup.b}' }),
  ])
  const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  const byId = Object.fromEntries(list.data.activities.map((x) => [x.id, x]))
  return {
    a: byId['${setup.a}']?.lastCompletedAt ?? null,
    b: byId['${setup.b}']?.lastCompletedAt ?? null,
  }
`)
ok(
  'concurrent completes both record their mark',
  typeof marks.a === 'number' && typeof marks.b === 'number',
  `a=${String(marks.a)} b=${String(marks.b)}`,
)

/* --- And the same shape via two enable toggles ---------------------------- */

const toggles = await run(`
  await Promise.all([
    chrome.runtime.sendMessage({ type: 'scheduled/set-enabled', id: '${setup.a}', enabled: false }),
    chrome.runtime.sendMessage({ type: 'scheduled/set-enabled', id: '${setup.b}', enabled: false }),
  ])
  const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  const byId = Object.fromEntries(list.data.activities.map((x) => [x.id, x]))
  return {
    a: byId['${setup.a}']?.enabled ?? null,
    b: byId['${setup.b}']?.enabled ?? null,
  }
`)
ok(
  'concurrent disables both take effect',
  toggles.a === false && toggles.b === false,
  `a=${String(toggles.a)} b=${String(toggles.b)}`,
)

cdp.close()
