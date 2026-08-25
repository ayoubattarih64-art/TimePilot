import { browser, evaluate, ok, page, targets } from './harness.mjs'

/**
 * Focus + website blocking, against Chrome's real declarativeNetRequest store.
 *
 * Rule counts come from `chrome.declarativeNetRequest.getDynamicRules()`, so
 * every assertion below is about what the network layer actually holds, not what
 * the extension believes it holds.
 */

const EXT = process.argv[2]
const cdp = await browser()
const { sessionId } = await page(cdp, `chrome-extension://${EXT}/sidepanel.html`)
await new Promise((r) => setTimeout(r, 2500))

const run = (body) => evaluate(cdp, sessionId, `(async () => { ${body} })()`)
const send = (req) =>
  run(`return await chrome.runtime.sendMessage(${JSON.stringify(req)})`)

/** Owned rules only: TimePilot's reserved id band. */
const rules = () =>
  run(`
    const all = await chrome.declarativeNetRequest.getDynamicRules()
    const owned = all.filter((r) => r.id >= 1000000 && r.id <= 1009999)
    return {
      total: all.length,
      owned: owned.length,
      sample: owned.slice(0, 2).map((r) => ({
        id: r.id,
        filter: r.condition.urlFilter ?? r.condition.requestDomains?.join(',') ?? '?',
        action: r.action.type,
        redirect: r.action.redirect?.extensionPath ?? null,
      })),
    }
  `)

/* --- 0. Baseline: nothing blocked before a session ------------------------ */

await send({ type: 'focus/cancel' })
const idle = await rules()
ok('no owned rules while idle', idle.owned === 0, `owned=${idle.owned} total=${idle.total}`)

const lists = await send({ type: 'blocklist/list' })
const focusList = lists?.data?.blocklists?.find((l) => l.mode === 'focus')
ok(
  'a focus-mode blocklist exists to enforce',
  !!focusList,
  lists?.data?.blocklists?.map((l) => `${l.name}:${l.mode}:${l.domains.length}`).join(' '),
)

/* --- 1. Start: rules appear, and they redirect to the blocked page -------- */

const started = await send({
  type: 'focus/start',
  input: {
    title: 'Audit focus',
    durationMinutes: 25,
    activityId: null,
    blocklistId: focusList.id,
  },
})
const sessionIdF = started?.data?.session?.id
ok(
  'focus session started',
  started?.data?.started === true && typeof sessionIdF === 'string',
  started?.ok === false ? `error=${started?.error}` : `status=${started?.data?.session?.status}`,
)

const running = await rules()
ok(
  'starting focus installs owned rules for the list',
  running.owned === focusList.domains.length,
  `owned=${running.owned} expected=${focusList.domains.length}`,
)
ok(
  'rules redirect to the extension blocked page',
  running.sample.every((r) => r.action === 'redirect' && r.redirect?.startsWith('/blocked.html')),
  JSON.stringify(running.sample),
)
ok(
  'reported status agrees with Chrome',
  started?.data?.blocking?.active === true &&
    started?.data?.blocking?.domainCount === running.owned &&
    started?.data?.blocking?.error === null,
  JSON.stringify(started?.data?.blocking),
)

const focusAlarms = await run(
  `const a = await chrome.alarms.getAll(); return a.filter(x => x.name.startsWith('timepilot:focus:')).map(x => x.name)`,
)
ok('focus alarm exists', focusAlarms.length === 1, focusAlarms.join(' '))

/* --- 2. A blocked domain actually redirects ------------------------------- */
// The rules are in force for real network requests, so navigating a tab to a
// listed domain must land on the extension's blocked page. The URL is read from
// the browser's own target list rather than `chrome.tabs`: TimePilot does not
// request the `tabs` permission, so `Tab.url` is withheld from the extension.

const blockedDomain = focusList.domains[0]
const { targetId: navTarget } = await cdp.send('Target.createTarget', {
  url: `https://${blockedDomain}/`,
})
await new Promise((r) => setTimeout(r, 4000))
const navUrl =
  (await targets(cdp)).find((t) => t.targetId === navTarget)?.url ?? ''
await cdp.send('Target.closeTarget', { targetId: navTarget })
ok(
  `navigating to ${blockedDomain} lands on the blocked page`,
  navUrl.includes('/blocked.html'),
  navUrl.slice(0, 120),
)

/* --- 3. Pause releases, resume restores ----------------------------------- */

const paused = await send({ type: 'focus/pause' })
const pausedRules = await rules()
const pausedAlarms = await run(
  `const a = await chrome.alarms.getAll(); return a.filter(x => x.name.startsWith('timepilot:focus:')).length`,
)
ok(
  'pausing releases every owned rule and clears the alarm',
  pausedRules.owned === 0 && paused?.data?.session?.status === 'paused' && pausedAlarms === 0,
  `owned=${pausedRules.owned} status=${paused?.data?.session?.status} alarms=${String(pausedAlarms)}`,
)

// And the paused session's countdown is frozen.
const frozen = paused?.data?.session?.remainingMs
await new Promise((r) => setTimeout(r, 1500))
const stillPaused = await send({ type: 'focus/current' })
ok(
  'paused focus does not count down',
  stillPaused?.data?.session?.remainingMs === frozen,
  `${String(frozen)} -> ${String(stillPaused?.data?.session?.remainingMs)}`,
)

// A domain added while paused must be blocked when the session resumes: the
// reconciler derives rules from the list, not from a snapshot taken at start.
await send({
  type: 'blocklist/add-domain',
  id: focusList.id,
  domain: 'audit-added-while-paused.example',
})
const resumed = await send({ type: 'focus/resume' })
const resumedRules = await rules()
ok(
  'resuming restores rules, including a domain added while paused',
  resumedRules.owned === focusList.domains.length + 1 &&
    resumed?.data?.session?.status === 'running',
  `owned=${resumedRules.owned} expected=${focusList.domains.length + 1} status=${resumed?.data?.session?.status}`,
)

/* --- 4. Editing the list during a live session reaches the network layer -- */

await send({
  type: 'blocklist/remove-domain',
  id: focusList.id,
  domain: 'audit-added-while-paused.example',
})
const afterRemove = await rules()
ok(
  'removing a domain mid-session drops its rule immediately',
  afterRemove.owned === focusList.domains.length,
  `owned=${afterRemove.owned} expected=${focusList.domains.length}`,
)

const disabledList = await send({
  type: 'blocklist/set-enabled',
  id: focusList.id,
  enabled: false,
})
const afterDisable = await rules()
ok(
  'disabling the list mid-session releases its rules',
  afterDisable.owned === 0 && disabledList?.data?.blocking?.active === false,
  `owned=${afterDisable.owned} reported=${JSON.stringify(disabledList?.data?.blocking?.active)}`,
)
await send({ type: 'blocklist/set-enabled', id: focusList.id, enabled: true })

/* --- 5. Cancel releases everything --------------------------------------- */

const cancelled = await send({ type: 'focus/cancel' })
const afterCancel = await rules()
const cancelAlarms = await run(
  `const a = await chrome.alarms.getAll(); return a.filter(x => x.name.startsWith('timepilot:focus:')).length`,
)
ok(
  'cancelling releases every rule and clears the alarm',
  afterCancel.owned === 0 &&
    cancelled?.data?.session?.status === 'cancelled' &&
    cancelAlarms === 0,
  `owned=${afterCancel.owned} status=${cancelled?.data?.session?.status} alarms=${String(cancelAlarms)}`,
)

/* --- 6. An `always` list blocks with no session at all ------------------- */

await send({ type: 'blocklist/set-mode', id: focusList.id, mode: 'always' })
const always = await rules()
ok(
  'an always-mode list blocks with no focus session running',
  always.owned === focusList.domains.length,
  `owned=${always.owned} expected=${focusList.domains.length}`,
)
await send({ type: 'blocklist/set-mode', id: focusList.id, mode: 'focus' })
const backToFocus = await rules()
ok(
  'switching it back to focus-mode releases the rules',
  backToFocus.owned === 0,
  `owned=${backToFocus.owned}`,
)

/* --- 7. Session completes on its own alarm ------------------------------- */

const short = await send({
  type: 'focus/start',
  input: {
    title: 'Short focus',
    durationMinutes: 1,
    activityId: null,
    blocklistId: focusList.id,
  },
})
ok('short focus started', short?.data?.started === true, String(short?.data?.session?.endsAt))
const shortRules = await rules()
ok('short focus is blocking', shortRules.owned > 0, `owned=${shortRules.owned}`)

await new Promise((r) => setTimeout(r, 66_000))
const completed = await send({ type: 'focus/current' })
const afterComplete = await rules()
const completeAlarms = await run(
  `const a = await chrome.alarms.getAll(); return a.filter(x => x.name.startsWith('timepilot:focus:')).length`,
)
ok(
  'focus completed on its own alarm',
  completed?.data?.session === null && completed?.data?.last?.status === 'completed',
  `current=${String(completed?.data?.session)} last=${completed?.data?.last?.status}`,
)
ok(
  'completion releases the rules and the alarm',
  afterComplete.owned === 0 && completeAlarms === 0,
  `owned=${afterComplete.owned} alarms=${String(completeAlarms)}`,
)

cdp.close()
