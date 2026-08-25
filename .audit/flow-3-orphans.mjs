import { browser, evaluate, ok, page } from './harness.mjs'

/**
 * Follow-up on flow-2: what the lost writes leave behind in chrome.alarms.
 *
 * A start that is acknowledged but whose row is erased by a concurrent write
 * still created its alarm, and nothing owns that alarm afterwards. This counts
 * the orphans directly rather than inferring them.
 */

const EXT = process.argv[2]
const cdp = await browser()
const { sessionId } = await page(cdp, `chrome-extension://${EXT}/sidepanel.html`)
await new Promise((r) => setTimeout(r, 2000))

const run = (body) => evaluate(cdp, sessionId, `(async () => { ${body} })()`)
const send = (req) =>
  run(`return await chrome.runtime.sendMessage(${JSON.stringify(req)})`)

await send({ type: 'timer/cancel' })
await send({ type: 'focus/cancel' })

const probe = await run(`
  // Clear every timer/focus alarm first so the count below is only this test's.
  for (const a of await chrome.alarms.getAll()) {
    if (a.name.startsWith('timepilot:timer:') || a.name.startsWith('timepilot:focus:')) {
      await chrome.alarms.clear(a.name)
    }
  }
  await chrome.storage.local.set({ timers: [], focusSessions: [] })

  const res = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      chrome.runtime.sendMessage({
        type: 'timer/start',
        input: { title: 'T' + i, durationMinutes: 10 },
      }),
    ),
  )
  const ackedIds = res.filter((r) => r.data?.started === true).map((r) => r.data.timer.id)
  const stored = (await chrome.storage.local.get('timers')).timers ?? []
  const alarms = (await chrome.alarms.getAll())
    .filter((a) => a.name.startsWith('timepilot:timer:'))
    .map((a) => a.name.slice('timepilot:timer:'.length))
  const storedIds = stored.map((t) => t.id)
  return {
    acked: ackedIds.length,
    storedIds,
    alarms,
    orphanAlarms: alarms.filter((id) => !storedIds.includes(id)),
    ackedButLost: ackedIds.filter((id) => !storedIds.includes(id)),
  }
`)

ok(
  'no timer is acknowledged and then lost',
  probe.ackedButLost.length === 0,
  `acked=${probe.acked} stored=${probe.storedIds.length} lost=${probe.ackedButLost.length}`,
)
ok(
  'no orphan timer alarm survives the race',
  probe.orphanAlarms.length === 0,
  `alarms=${probe.alarms.length} orphans=${probe.orphanAlarms.length}`,
)

// What a sweep does about it: reconcile should clear alarms with no owning row.
const afterSweep = await run(`
  await chrome.runtime.sendMessage({ type: 'timer/current' })
  const stored = (await chrome.storage.local.get('timers')).timers ?? []
  const alarms = (await chrome.alarms.getAll())
    .filter((a) => a.name.startsWith('timepilot:timer:'))
    .map((a) => a.name.slice('timepilot:timer:'.length))
  return { alarms, storedIds: stored.map((t) => t.id) }
`)
ok(
  'reconcile-on-read clears the orphan alarms',
  afterSweep.alarms.every((id) => afterSweep.storedIds.includes(id)),
  `alarms=${afterSweep.alarms.length} stored=${afterSweep.storedIds.length}`,
)

await send({ type: 'timer/cancel' })
cdp.close()
