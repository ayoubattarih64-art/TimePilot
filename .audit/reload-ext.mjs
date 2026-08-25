import { browser, evaluate, workerSession } from './harness.mjs'
const EXT = process.argv[2]
const cdp = await browser()
const sw = await workerSession(cdp, EXT)
await evaluate(cdp, sw, `chrome.runtime.reload()`).catch(() => {})
await new Promise((r) => setTimeout(r, 3000))
const sw2 = await workerSession(cdp, EXT)
console.log(await evaluate(cdp, sw2, `chrome.runtime.getManifest().version`))
cdp.close()
