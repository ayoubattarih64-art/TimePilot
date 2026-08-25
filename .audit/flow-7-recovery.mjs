import { browser, evaluate, ok, page, targets } from './harness.mjs'

/**
 * Failure and recovery: the states a real machine produces that no happy path
 * covers. Everything here corrupts or removes state deliberately and then asks
 * whether the extension repairs it rather than breaking.
 */

const EXT = process.argv[2]
const cdp = await browser()
const { sessionId } = await page(cdp, `chrome-extension://${EXT}/sidepanel.html`)
await new Promise((r) => setTimeout(r, 2500))

const run = (body) => evaluate(cdp, sessionId, `(async () => { ${body} })()`)
const send = (req) =>
  run(`return await chrome.runtime.sendMessage(${JSON.stringify(req)})`)

/* --- 1. Worker eviction ---------------------------------------------------- */
// Stopping the service worker over CDP is the real eviction, not a simulation:
// Chrome tears the worker down and must start a *new* one on the next message.
// The proof is the target id: a restarted worker is a different target, so a
// matching id would mean nothing was ever torn down.

const swBefore = (await targets(cdp)).find(
  (t) => t.type === 'service_worker' && t.url.includes(EXT),
)
ok('service worker target found', !!swBefore, swBefore?.url ?? 'missing')

const timerBefore = await send({
  type: 'timer/start',
  input: { title: 'Eviction timer', durationMinutes: 30 },
})
const timerId = timerBefore?.data?.timer?.id

await cdp.send('Target.closeTarget', { targetId: swBefore.targetId })
await new Promise((r) => setTimeout(r, 1500))

// The next message must wake it and get a correct answer from storage alone.
const afterEviction = await send({ type: 'timer/current' })
ok(
  'a message wakes the evicted worker',
  afterEviction?.ok === true,
  afterEviction?.ok === false ? `error=${afterEviction?.error}` : 'ok',
)

const swAfter = (await targets(cdp)).find(
  (t) => t.type === 'service_worker' && t.url.includes(EXT),
)
ok(
  'the worker that answered is a fresh one, so it really was torn down',
  !!swAfter && swAfter.targetId !== swBefore.targetId,
  `${String(swBefore?.targetId)} -> ${String(swAfter?.targetId)}`,
)
ok(
  'the live timer survived the eviction with its end intact',
  afterEviction?.data?.timer?.id === timerId &&
    afterEviction?.data?.timer?.endsAt === timerBefore?.data?.timer?.endsAt,
  `id=${String(afterEviction?.data?.timer?.id)} endsAt=${String(afterEviction?.data?.timer?.endsAt)}`,
)
ok(
  'and its alarm is still in Chrome, so it will still complete',
  (await run(
    `const a = await chrome.alarms.getAll(); return a.filter(x => x.name === 'timepilot:timer:${timerId}').length`,
  )) === 1,
  '',
)
await send({ type: 'timer/cancel' })

/* --- 2. A stale alarm with nothing behind it ------------------------------ */
// Written directly into Chrome's alarm store, as an eviction mid-write would
// leave. Firing it must be quiet, and it must be cleared rather than retried.

await run(`
  await chrome.alarms.create('timepilot:activity:ghost-' + Date.now(), {
    when: Date.now() + 1000,
  })
  await chrome.alarms.create('timepilot:timer:ghost', { when: Date.now() + 1000 })
  await chrome.alarms.create('timepilot:focus:ghost', { when: Date.now() + 1000 })
  return true
`)
await new Promise((r) => setTimeout(r, 4000))
const ghosts = await run(`
  const a = await chrome.alarms.getAll()
  return a.filter((x) => x.name.includes('ghost')).map((x) => x.name)
`)
ok(
  'alarms for entities that do not exist clear themselves',
  ghosts.length === 0,
  ghosts.join(' '),
)

/* --- 3. A foreign alarm is left alone ------------------------------------- */

await run(`await chrome.alarms.create('someone-elses-alarm', { when: Date.now() + 600000 }); return true`)
await send({ type: 'scheduled/list' })
const foreign = await run(
  `const a = await chrome.alarms.getAll(); return a.some((x) => x.name === 'someone-elses-alarm')`,
)
ok('an alarm outside the namespace is never touched', foreign === true, String(foreign))
await run(`await chrome.alarms.clear('someone-elses-alarm'); return true`)

/* --- 4. Malformed storage ------------------------------------------------- */
// Storage is writable by anything running as the extension. Garbage must be
// dropped on read, not crash a surface or the worker.

const malformed = await run(`
  await chrome.storage.local.set({
    scheduled: [
      null,
      42,
      'nonsense',
      { id: 'no-time' },
      { title: 'no id', date: '2026-01-01', time: '09:00' },
    ],
    timers: [{ id: 'broken' }, null, 7],
    focusSessions: 'not-an-array',
    routines: [{ nope: true }],
    blocklists: [{ id: 'x' }, null],
    settings: 'garbage',
  })
  const out = {}
  for (const type of ['scheduled/list', 'timer/current', 'focus/current', 'routine/list', 'blocklist/list', 'settings/get']) {
    const res = await chrome.runtime.sendMessage({ type })
    out[type] = res.ok ? 'ok' : 'ERROR: ' + res.error
  }
  return out
`)
ok(
  'every read survives malformed storage',
  Object.values(malformed).every((v) => v === 'ok'),
  JSON.stringify(malformed),
)

const recovered = await send({ type: 'settings/get' })
ok(
  'a garbage settings value reads back as usable defaults',
  recovered?.data?.settings?.notificationsEnabled === true &&
    recovered?.data?.settings?.onboardingCompletedAt === null,
  JSON.stringify(recovered?.data?.settings),
)

/* --- 5. Missing storage keys --------------------------------------------- */
// A partially cleared store, as a failed migration or a manual wipe leaves.

const missing = await run(`
  await chrome.storage.local.remove(['timers', 'settings', 'schemaVersion'])
  const out = {}
  for (const type of ['timer/current', 'settings/get', 'scheduled/list']) {
    const res = await chrome.runtime.sendMessage({ type })
    out[type] = res.ok ? 'ok' : 'ERROR: ' + res.error
  }
  const keys = Object.keys(await chrome.storage.local.get(null)).sort()
  return { out, keys }
`)
ok(
  'reads still work with keys missing entirely',
  Object.values(missing.out).every((v) => v === 'ok'),
  JSON.stringify(missing.out),
)

/* --- 6. An end that passed while nothing was listening ------------------- */
// Write a running timer whose `endsAt` is in the past, exactly as a browser
// closed over the end would leave it, then read the surface.

const closedOver = await run(`
  const past = Date.now() - 10 * 60_000
  await chrome.storage.local.set({
    timers: [{
      id: 'closed-over', title: 'Closed over', plannedMs: 1_500_000,
      startedAt: past - 1_500_000, endsAt: past, remainingMs: null,
      endedAt: null, status: 'running', createdAt: past - 1_500_000,
    }],
  })
  const res = await chrome.runtime.sendMessage({ type: 'timer/current' })
  const stored = (await chrome.storage.local.get('timers')).timers ?? []
  const alarms = (await chrome.alarms.getAll())
    .filter((a) => a.name.startsWith('timepilot:timer:')).length
  return {
    current: res.data?.timer,
    last: res.data?.last?.status ?? null,
    storedStatus: stored[0]?.status ?? null,
    alarms,
  }
`)
ok(
  'a timer whose end passed while closed is completed, not left running',
  closedOver.current === null &&
    closedOver.last === 'completed' &&
    closedOver.storedStatus === 'completed' &&
    closedOver.alarms === 0,
  `current=${String(closedOver.current)} last=${String(closedOver.last)} stored=${String(closedOver.storedStatus)} alarms=${String(closedOver.alarms)}`,
)

const closedFocus = await run(`
  const past = Date.now() - 10 * 60_000
  await chrome.storage.local.set({
    focusSessions: [{
      id: 'closed-focus', title: 'Closed focus', activityId: null,
      blocklistId: null, plannedMs: 1_500_000,
      startedAt: past - 1_500_000, endsAt: past, remainingMs: null,
      endedAt: null, status: 'running', createdAt: past - 1_500_000,
    }],
  })
  const res = await chrome.runtime.sendMessage({ type: 'focus/current' })
  const dnr = await chrome.declarativeNetRequest.getDynamicRules()
  return {
    current: res.data?.session,
    last: res.data?.last?.status ?? null,
    owned: dnr.filter((r) => r.id >= 1000000 && r.id <= 1009999).length,
  }
`)
ok(
  'a focus session whose end passed while closed is completed and unblocked',
  closedFocus.current === null &&
    closedFocus.last === 'completed' &&
    closedFocus.owned === 0,
  `current=${String(closedFocus.current)} last=${String(closedFocus.last)} owned=${String(closedFocus.owned)}`,
)

/* --- 7. Orphan blocking rules ------------------------------------------- */
// Rules in TimePilot's band with no session and no always-list behind them:
// what a crash mid-session leaves. They must be released, and reported as
// stale rather than as protection.
//
// The settle wait is about this harness, not the product: an open side panel
// refreshes on every storage change, and section 6 wrote `focusSessions`, so a
// `focus/current` from the page — which reconciles blocking — would otherwise
// land between the add and the read and release the rule first.

await new Promise((r) => setTimeout(r, 2000))

const orphan = await run(`
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [{
      id: 1009999,
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: 'orphan-audit.example', resourceTypes: ['main_frame'] },
    }],
  })
  const installed = (await chrome.declarativeNetRequest.getDynamicRules())
    .filter((r) => r.id >= 1000000 && r.id <= 1009999).length
  const status = await chrome.runtime.sendMessage({ type: 'blocking/status' })
  const afterStatus = (await chrome.declarativeNetRequest.getDynamicRules())
    .filter((r) => r.id >= 1000000 && r.id <= 1009999).length
  const reconciled = await chrome.runtime.sendMessage({ type: 'focus/current' })
  const after = (await chrome.declarativeNetRequest.getDynamicRules())
    .filter((r) => r.id >= 1000000 && r.id <= 1009999).length
  return {
    installed,
    reportedActive: status.data?.blocking?.active,
    reportedError: status.data?.blocking?.error,
    reportedCount: status.data?.blocking?.domainCount,
    afterStatus,
    after,
  }
`)
ok(
  'an orphan rule is never reported as protection',
  // Either the read caught it — in force, and said so — or a reconcile had
  // already released it. What must never happen is "blocked, no reason given".
  orphan.reportedActive === true
    ? orphan.reportedError !== null && orphan.reportedCount > 0
    : orphan.reportedCount === 0 && orphan.reportedError === null,
  `installed=${String(orphan.installed)} active=${String(orphan.reportedActive)} count=${String(orphan.reportedCount)} error=${String(orphan.reportedError)}`,
)
ok(
  'and the next reconcile releases it',
  orphan.after === 0,
  `afterStatus=${String(orphan.afterStatus)} afterReconcile=${String(orphan.after)}`,
)

/* --- 8. Notification action for an entity that no longer exists ---------- */

const deadNotification = await run(`
  const list = await chrome.runtime.sendMessage({ type: 'scheduled/list' })
  for (const a of list.data.activities) {
    await chrome.runtime.sendMessage({ type: 'scheduled/remove', id: a.id })
  }
  const out = []
  for (const req of [
    { type: 'scheduled/complete', id: 'does-not-exist' },
    { type: 'scheduled/snooze', id: 'does-not-exist', minutes: 5 },
    { type: 'scheduled/set-enabled', id: 'does-not-exist', enabled: true },
    { type: 'timer/pause' },
    { type: 'timer/resume' },
    { type: 'focus/pause' },
    { type: 'focus/resume' },
  ]) {
    const res = await chrome.runtime.sendMessage(req)
    out.push(req.type + '=' + (res.ok ? 'ok' : 'ERROR:' + res.error))
  }
  return out
`)
ok(
  'actions on entities that no longer exist are refused, not thrown',
  deadNotification.every((line) => line.endsWith('=ok')),
  deadNotification.join(' '),
)

/* --- 9. The worker is still healthy after all of that ------------------- */

const finalPing = await send({ type: 'ping' })
ok('worker still healthy at the end', finalPing?.ok === true, JSON.stringify(finalPing?.data))

cdp.close()
