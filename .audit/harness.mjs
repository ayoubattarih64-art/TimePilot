import { CDP, fetchJSON } from './cdp.mjs'

const PORT = process.env.PORT ?? '9444'
const BASE = `http://127.0.0.1:${PORT}`

export async function browser() {
  const v = await fetchJSON(`${BASE}/json/version`)
  const cdp = await CDP.connect(v.webSocketDebuggerUrl)
  await cdp.send('Target.setDiscoverTargets', { discover: true })
  return cdp
}

/** All targets Chrome knows about, service workers included. */
export async function targets(cdp) {
  // The empty filter entry means "every type"; the default filter hides workers.
  const { targetInfos } = await cdp.send('Target.getTargets', {
    filter: [{}],
  })
  return targetInfos
}

/** Attach to the extension's service worker, waking it first if needed. */
export async function workerSession(cdp, extId, { wake = true } = {}) {
  for (let i = 0; i < 40; i++) {
    const all = await targets(cdp)
    const sw = all.find(
      (t) =>
        (t.type === 'service_worker' || t.type === 'worker') &&
        t.url.startsWith(`chrome-extension://${extId}/`),
    )
    if (sw) {
      const { sessionId } = await cdp.send('Target.attachToTarget', {
        targetId: sw.targetId,
        flatten: true,
      })
      await cdp.send('Runtime.enable', {}, sessionId)
      return sessionId
    }
    if (wake && i % 8 === 0) {
      // Opening an extension page sends a message the worker must answer, which
      // is what starts it when Chrome has evicted it.
      await cdp
        .send('Target.createTarget', {
          url: `chrome-extension://${extId}/popup.html`,
        })
        .catch(() => {})
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('service worker target never appeared')
}

/** Evaluate in a session and return the value, throwing on an exception. */
export async function evaluate(cdp, sessionId, expression) {
  const res = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  )
  if (res.exceptionDetails) {
    throw new Error(
      res.exceptionDetails.exception?.description ??
        JSON.stringify(res.exceptionDetails),
    )
  }
  return res.result.value
}

/** Open a page target and return its session id. */
export async function page(cdp, url, { width, height } = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url })
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  })
  await cdp.send('Runtime.enable', {}, sessionId)
  await cdp.send('Page.enable', {}, sessionId)
  if (width) {
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width, height: height ?? 720, deviceScaleFactor: 1, mobile: false },
      sessionId,
    )
  }
  return { sessionId, targetId }
}

export function ok(label, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) process.exitCode = 1
  return condition
}
