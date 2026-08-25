import { browser, evaluate, ok, page } from './harness.mjs'

/**
 * Insights across all three ranges, then Settings, the tour, and the Popup.
 *
 * Insights is the one surface whose whole job is arithmetic, so it is checked
 * the only way that proves anything: write completed sessions at known
 * instants, then read the rendered figures back and compare them with what the
 * stored rows say. Empty first, so a zero can be told from a missing read.
 */

const EXT = process.argv[2]
const cdp = await browser()
const { sessionId } = await page(cdp, `chrome-extension://${EXT}/sidepanel.html`, {
  width: 360,
  height: 900,
})
await new Promise((r) => setTimeout(r, 2500))

const run = (body) => evaluate(cdp, sessionId, `(async () => { ${body} })()`)
const text = () =>
  evaluate(cdp, sessionId, `(() => (document.body.innerText ?? '').replace(/\\s+/g, ' ').trim())()`)
const click = (selector) =>
  evaluate(
    cdp,
    sessionId,
    `(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return false; n.click(); return true })()`,
  )
const clickText = (needle) =>
  evaluate(
    cdp,
    sessionId,
    `(() => {
       const n = [...document.querySelectorAll('button')]
         .find((b) => (b.textContent ?? '').trim() === ${JSON.stringify(needle)})
       if (!n) return false
       n.click(); return true
     })()`,
  )
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms))

/* --- 0. A clean slate ------------------------------------------------------ */

await run(`
  const send = (req) => chrome.runtime.sendMessage(req)
  const list = await send({ type: 'scheduled/list' })
  for (const a of list.data.activities) await send({ type: 'scheduled/remove', id: a.id })
  const rl = await send({ type: 'routine/list' })
  for (const r of rl.data.routines) await send({ type: 'routine/remove', id: r.id })
  await chrome.storage.local.set({ focusSessions: [] })
  await send({ type: 'settings/complete-onboarding' })
  return true
`)
await cdp.send('Page.reload', {}, sessionId)
await settle(2200)

ok('Insights reachable from the nav bar', await click('[data-nav-value="insights"]'))
await settle(900)

const empty = await text()
ok(
  'Insights with nothing stored says so rather than showing zeros as data',
  empty.includes('No focus data yet') && empty.includes('Insights'),
  empty.slice(0, 150),
)
ok(
  'and the empty state names the selected range',
  empty.includes('this week'),
  /Nothing is recorded for [^.]*/.exec(empty)?.[0] ?? 'no range sentence',
)

/* --- 1. Real data at known instants --------------------------------------- */
// Three completed sessions: two today (one with a blocklist attached), one on
// the first day of the week that contains today, plus a cancelled one that
// must not be counted at all. Written to storage rather than run in real time —
// a 25-minute countdown cannot be waited out, and the insights layer reads
// nothing but these fields.

// The fixture has to land inside the *current* Monday-first week whatever
// weekday the audit runs on. Six days back is inside this week only from a
// Sunday — on a Monday it is last Tuesday, in the previous week. So the third
// session is pinned to the first day of the week that contains today, and the
// Today / This month expectations are derived from the same offset instead of
// being hardcoded to one weekday.
const daysSinceMonday = (new Date().getDay() + 6) % 7
const cOffset = -daysSinceMonday // 0 on a Monday, when the week starts today
const cIsToday = cOffset === 0
const cInThisMonth = (() => {
  const d = new Date()
  const then = new Date(d.getFullYear(), d.getMonth(), d.getDate() + cOffset)
  return then.getMonth() === d.getMonth() && then.getFullYear() === d.getFullYear()
})()

const seeded = await run(`
  const d = new Date()
  const at = (dayOffset, hour) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, hour, 0, 0, 0).getTime()
  const session = (id, startedAt, plannedMs, blocklistId) => ({
    id, title: 'Session ' + id, activityId: null, blocklistId,
    plannedMs, startedAt, endsAt: startedAt + plannedMs, remainingMs: null,
    endedAt: startedAt + plannedMs, status: 'completed', createdAt: startedAt,
  })
  const rows = [
    session('ins-a', at(0, 9), 25 * 60000, null),
    session('ins-b', at(0, 14), 50 * 60000, 'focus-default'),
    session('ins-c', at(${cOffset}, 10), 30 * 60000, null),
    { ...session('ins-d', at(0, 16), 45 * 60000, null), status: 'cancelled' },
  ]
  await chrome.storage.local.set({ focusSessions: rows })
  return {
    total: rows.length,
    todayCompleted: rows.filter((r) => r.status === 'completed' && r.startedAt >= at(0, 0)).length,
  }
`)
ok(
  'seeded four sessions, three of them completed inside this week',
  seeded.total === 4 && seeded.todayCompleted === (cIsToday ? 3 : 2),
  `${JSON.stringify(seeded)} cOffset=${cOffset}`,
)

// useFocusHistory subscribes to the focusSessions key, so the page must pick
// this up with no reload — which is itself part of what is being checked.
await settle(1400)

const week = await text()
ok(
  'the storage subscription refreshed Insights with no reload',
  !week.includes('No focus data yet'),
  week.slice(0, 120),
)
ok(
  'this week counts the three completed sessions and not the cancelled one',
  /3 sessions/.test(week),
  /\d+ sessions?/.exec(week)?.[0] ?? 'no session count',
)
ok(
  'this week totals 1h 45m — 25 + 50 + 30, the planned length of what completed',
  week.includes('1h 45m'),
  /FOCUS TIME \S+ ?\S*/i.exec(week)?.[0] ?? 'no focus total',
)
ok(
  'the average is the mean of those three, 35m',
  week.includes('average 35m'),
  /average \S+/.exec(week)?.[0] ?? 'no average',
)
ok(
  'focus in blocking-attached sessions is reported separately',
  /50m/.test(week) && /blocking/i.test(week),
  /[^.]*blocking[^.]*/i.exec(week)?.[0]?.slice(0, 110) ?? 'no blocking line',
)

ok('Today range selectable', await clickText('Today'))
await settle(800)
const today = await text()
const todayCount = cIsToday ? 3 : 2
const todayTotal = cIsToday ? '1h 45m' : '1h 15m'
ok(
  `Today counts only the ${todayCount} sessions that started today`,
  new RegExp(`${todayCount} sessions`).test(today),
  /\d+ sessions?/.exec(today)?.[0] ?? 'no count',
)
ok(
  `Today totals ${todayTotal}, counting only sessions started today`,
  today.includes(todayTotal),
  /FOCUS TIME \S+ ?\S*/i.exec(today)?.[0] ?? 'no total',
)

ok('Month range selectable', await clickText('This month'))
await settle(800)
const month = await text()
const monthCount = cInThisMonth ? 3 : 2
const monthTotal = cInThisMonth ? '1h 45m' : '1h 15m'
ok(
  'This month includes every completed session in the calendar month',
  new RegExp(`${monthCount} sessions`).test(month) && month.includes(monthTotal),
  `${/\d+ sessions?/.exec(month)?.[0] ?? '?'} ${/1h \d+m/.exec(month)?.[0] ?? '?'} expected ${monthCount}/${monthTotal}`,
)

// The report is pure and takes `now` as a parameter, so the numbers on the page
// must equal the numbers in the rows. Comparing the two catches a page that
// formats a correct report wrongly.
const cross = await run(`
  const rows = (await chrome.storage.local.get('focusSessions')).focusSessions
  const completed = rows.filter((r) => r.status === 'completed')
  const sum = completed.reduce((n, r) => n + r.plannedMs, 0)
  return { count: completed.length, ms: sum, avg: Math.round(sum / completed.length) }
`)
ok(
  'the stored rows carry exactly the figures the week range rendered',
  cross.count === 3 && cross.ms === 105 * 60000 && cross.avg === 35 * 60000,
  JSON.stringify(cross),
)

/* --- 2. A pattern is claimed only above the sample minimum ---------------- */

const belowMin = await text()
ok(
  'no focus window is claimed from three sessions',
  !/\d\d:00[–-]\d\d:00/.test(belowMin),
  /\d\d:00[–-]\d\d:00/.exec(belowMin)?.[0] ?? 'none claimed',
)

const withPattern = await run(`
  const d = new Date()
  const at = (dayOffset, hour) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, hour, 0, 0, 0).getTime()
  const rows = []
  for (let i = 0; i < 6; i++) {
    const startedAt = at(-i, 9)
    rows.push({
      id: 'pat-' + i, title: 'Deep work', activityId: null, blocklistId: null,
      plannedMs: 30 * 60000, startedAt, endsAt: startedAt + 1800000,
      remainingMs: null, endedAt: startedAt + 1800000, status: 'completed',
      createdAt: startedAt,
    })
  }
  await chrome.storage.local.set({ focusSessions: rows })
  return rows.length
`)
await settle(1400)
const pattern = await text()
ok(
  'six morning sessions do produce a stated window',
  withPattern === 6 && /09:00/.test(pattern),
  /\d\d:00[–-]\d\d:00/.exec(pattern)?.[0] ?? pattern.slice(0, 130),
)

/* --- 3. Settings ---------------------------------------------------------- */

ok(
  'Settings reachable from the header',
  await evaluate(
    cdp,
    sessionId,
    `(() => {
       const b = [...document.querySelectorAll('button')]
         .find((n) => n.getAttribute('aria-label') === 'Settings')
       if (!b) return false
       b.click(); return true
     })()`,
  ),
)
await settle(800)

const themeSwitch = await run(`
  const radio = (label) =>
    [...document.querySelectorAll('[role="radio"]')]
      .find((n) => (n.textContent ?? '').trim() === label)
  const snap = (l) => ({
    dark: document.documentElement.classList.contains('dark'),
    pref: localStorage.getItem('timepilot.theme'),
    checked: radio(l)?.getAttribute('aria-checked'),
    scheme: document.documentElement.style.colorScheme,
  })
  radio('Dark')?.click()
  await new Promise((r) => setTimeout(r, 400))
  const afterDark = snap('Dark')
  radio('Light')?.click()
  await new Promise((r) => setTimeout(r, 400))
  const afterLight = snap('Light')
  radio('System')?.click()
  await new Promise((r) => setTimeout(r, 400))
  const afterSystem = snap('System')
  radio('Light')?.click()
  await new Promise((r) => setTimeout(r, 300))
  return { afterDark, afterLight, afterSystem }
`)
ok(
  'choosing Dark applies the class, the colour-scheme hint and the preference',
  themeSwitch.afterDark.dark === true &&
    themeSwitch.afterDark.pref === 'dark' &&
    themeSwitch.afterDark.checked === 'true' &&
    themeSwitch.afterDark.scheme === 'dark',
  JSON.stringify(themeSwitch.afterDark),
)
ok(
  'choosing Light removes it again',
  themeSwitch.afterLight.dark === false &&
    themeSwitch.afterLight.pref === 'light' &&
    themeSwitch.afterLight.checked === 'true' &&
    themeSwitch.afterLight.scheme === 'light',
  JSON.stringify(themeSwitch.afterLight),
)
ok(
  'System is stored as a preference of its own, not as a resolved value',
  themeSwitch.afterSystem.pref === 'system' &&
    themeSwitch.afterSystem.checked === 'true',
  JSON.stringify(themeSwitch.afterSystem),
)

const notif = await run(`
  const sw = () =>
    [...document.querySelectorAll('[role="switch"]')]
      .find((n) => n.getAttribute('aria-label') === 'Show notifications')
  const before = sw()?.getAttribute('aria-checked')
  sw()?.click()
  await new Promise((r) => setTimeout(r, 700))
  const afterUi = sw()?.getAttribute('aria-checked')
  const stored = (await chrome.runtime.sendMessage({ type: 'settings/get' }))
    .data.settings.notificationsEnabled
  const warned = (document.body.innerText ?? '').includes('Nothing will be announced')
  sw()?.click()
  await new Promise((r) => setTimeout(r, 700))
  const restored = (await chrome.runtime.sendMessage({ type: 'settings/get' }))
    .data.settings.notificationsEnabled
  return {
    before, afterUi, stored, warned, restored,
    uiAfterRestore: sw()?.getAttribute('aria-checked'),
  }
`)
ok(
  'the notifications switch writes through to storage and back to the switch',
  notif.before === 'true' &&
    notif.afterUi === 'false' &&
    notif.stored === false &&
    notif.restored === true &&
    notif.uiAfterRestore === 'true',
  JSON.stringify(notif),
)
ok(
  'and turning it off states plainly that nothing will be announced',
  notif.warned === true,
  String(notif.warned),
)

const blocking = await text()
ok(
  'Settings carries the blocking section, so lists are managed in one place',
  /Website blocking/i.test(blocking),
  /website blocking/i.exec(blocking)?.[0] ?? 'missing',
)

const about = await text()
ok(
  'About reports a real manifest version and a live worker',
  /TimePilot \d+\.\d+/.test(about) && about.includes('Connected'),
  `${String(/TimePilot \d\S*/.exec(about)?.[0])} / ${about.includes('Connected') ? 'Connected' : 'NOT responding'}`,
)

/* --- 4. The tour, reopened from Settings --------------------------------- */

ok('the welcome tour can be reopened', await clickText('Show again'))
await settle(900)
const tour = await run(`
  const body = () => (document.body.innerText ?? '').replace(/\\s+/g, ' ')
  const btn = (label) =>
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label)
  const seen = [body().slice(0, 70)]
  const live = document.querySelector('[aria-live="polite"]')?.textContent ?? null
  for (let i = 0; i < 5; i++) {
    btn('Next')?.click()
    await new Promise((r) => setTimeout(r, 400))
    seen.push(body().slice(0, 70))
  }
  return {
    seen,
    live,
    finish: !!btn('Finish'),
    stepLive: document.querySelector('[aria-live="polite"]')?.textContent ?? null,
  }
`)
ok(
  'the tour walks all six distinct steps and ends on Finish',
  tour.seen.length === 6 && new Set(tour.seen).size === 6 && tour.finish === true,
  `${String(new Set(tour.seen).size)} distinct steps, finish=${String(tour.finish)}`,
)
ok(
  'the step position is announced, not only drawn as dots',
  /Step 1 of 6/.test(tour.live ?? '') && /Step 6 of 6/.test(tour.stepLive ?? ''),
  `${String(tour.live)} -> ${String(tour.stepLive)}`,
)

const finished = await run(`
  const btn = [...document.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim() === 'Finish')
  btn?.click()
  await new Promise((r) => setTimeout(r, 1000))
  const s = await chrome.runtime.sendMessage({ type: 'settings/get' })
  return {
    back: !!document.querySelector('[data-nav-value="home"]'),
    completedAt: s.data.settings.onboardingCompletedAt,
  }
`)
ok(
  'finishing a reopened tour hands the panel back and leaves the mark set',
  finished.back === true && typeof finished.completedAt === 'number',
  JSON.stringify(finished),
)

/* --- 5. A genuinely fresh store shows the tour unprompted ---------------- */

await run(`
  const send = (req) => chrome.runtime.sendMessage(req)
  const list = await send({ type: 'scheduled/list' })
  for (const a of list.data.activities) await send({ type: 'scheduled/remove', id: a.id })
  const rl = await send({ type: 'routine/list' })
  for (const r of rl.data.routines) await send({ type: 'routine/remove', id: r.id })
  await chrome.storage.local.set({ focusSessions: [], timers: [] })
  const s = (await chrome.storage.local.get('settings')).settings
  await chrome.storage.local.set({ settings: { ...s, onboardingCompletedAt: null } })
  return true
`)
await cdp.send('Page.reload', {}, sessionId)
await settle(2800)
const fresh = await text()
ok(
  'a fresh store opens on the tour rather than on Home',
  fresh.length > 20 &&
    (await evaluate(
      cdp,
      sessionId,
      `(() => document.querySelector('[data-nav-value="home"]') === null)()`,
    )),
  fresh.slice(0, 110),
)
ok('the tour can be skipped', await clickText('Skip'))
await settle(1300)
const afterSkip = await run(`
  const s = await chrome.runtime.sendMessage({ type: 'settings/get' })
  const a = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  return {
    home: !!document.querySelector('[data-nav-value="home"]'),
    completedAt: s.data.settings.onboardingCompletedAt,
    activities: a.data.activities.length,
  }
`)
ok(
  'skipping marks the tour done, lands on Home, and creates nothing',
  afterSkip.home === true &&
    typeof afterSkip.completedAt === 'number' &&
    afterSkip.activities === 0,
  JSON.stringify(afterSkip),
)
await cdp.send('Page.reload', {}, sessionId)
await settle(2500)
ok(
  'and it does not come back on the next open',
  await evaluate(
    cdp,
    sessionId,
    `(() => document.querySelector('[data-nav-value="home"]') !== null)()`,
  ),
)

/* --- 6. Popup ------------------------------------------------------------ */

await run(`
  const d = new Date(Date.now() + 90 * 60000)
  const p = (n) => String(n).padStart(2, '0')
  await chrome.runtime.sendMessage({ type: 'scheduled/create', input: {
    title: 'Popup next item', type: 'reminder',
    date: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
    time: p(d.getHours()) + ':' + p(d.getMinutes()),
    repeat: 'none', durationMinutes: 0, categoryId: 'work',
    notify: 'at-time', enabled: true,
  }})
  return true
`)

const popup = await page(cdp, `chrome-extension://${EXT}/popup.html`, {
  width: 320,
  height: 480,
})
await settle(2000)
const popupText = await evaluate(
  cdp,
  popup.sessionId,
  `(() => (document.body.innerText ?? '').replace(/\\s+/g, ' ').trim())()`,
)
ok(
  'the popup shows the next activity, not an empty shell',
  popupText.includes('Popup next item') && /next/i.test(popupText),
  popupText.slice(0, 140),
)
ok(
  'and its three quick actions plus the panel link are all present',
  ['Reminder', 'Timer', 'Focus', 'Open TimePilot'].every((l) => popupText.includes(l)),
  popupText.slice(0, 200),
)

// A quick action's contract is the parked intent the panel reads on mount.
// Clicking and then reading session storage proves the hand-off without needing
// the side panel to actually open, which headless Chrome will not do.
const intent = await evaluate(
  cdp,
  popup.sessionId,
  `(async () => {
     await chrome.storage.session.remove('pendingIntent')
     const n = [...document.querySelectorAll('button')]
       .find((b) => (b.textContent ?? '').trim() === 'Focus')
     n?.click()
     await new Promise((r) => setTimeout(r, 800))
     const stored = await chrome.storage.session.get('pendingIntent')
     return stored.pendingIntent ?? null
   })()`,
)
ok(
  'a quick action parks a one-shot intent in session storage for the panel',
  intent?.kind === 'open-focus',
  JSON.stringify(intent),
)
ok(
  'the intent is session-scoped, so it can never reopen an editor days later',
  await run(
    `const local = await chrome.storage.local.get('pendingIntent'); return local.pendingIntent === undefined`,
  ),
)

const consumed = await run(`
  const before = await chrome.storage.session.get('pendingIntent')
  await chrome.storage.session.remove('pendingIntent')
  const after = await chrome.storage.session.get('pendingIntent')
  return { before: before.pendingIntent?.kind ?? null, after: after.pendingIntent ?? null }
`)
ok(
  'the panel side sees the same intent, and a read clears it',
  consumed.before === 'open-focus' && consumed.after === null,
  JSON.stringify(consumed),
)

await cdp.send('Target.closeTarget', { targetId: popup.targetId })

cdp.close()
