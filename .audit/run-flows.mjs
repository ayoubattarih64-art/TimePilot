import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchJSON } from './cdp.mjs'

/**
 * `npm run audit:flows` — every reusable flow, in order, against `dist/`.
 *
 * The flows themselves are unchanged: each is still a standalone script that
 * takes a port and an extension id, so any one of them can be run by hand while
 * debugging. This only launches a browser, finds the id, runs them, and reports.
 *
 * `restart-a.mjs` / `restart-b.mjs` are deliberately not included — they need a
 * real browser close between the two halves, which is a different shape from
 * "run a list of scripts against one browser". Run those two by hand.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PORT = process.env.PORT ?? '9470'
const PROFILE = resolve(HERE, 'run-profile')

// `close.mjs` and `harness.mjs` both read the port from the environment, so put
// the resolved value there rather than passing it down by argument.
process.env.PORT = PORT

const FLOWS = [
  'flow-1-core.mjs',
  'flow-2-races.mjs',
  'flow-3-orphans.mjs',
  'flow-4-samefire.mjs',
  'flow-5-focus.mjs',
  'flow-6-routines.mjs',
  'flow-7-recovery.mjs',
  'flow-8-responsive.mjs',
  'flow-9-insights-settings.mjs',
  'flow-10-a11y.mjs',
]

/**
 * Chromium builds that still honour `--load-extension`. Google Chrome does not:
 * it logs "--load-extension is not allowed in Google Chrome, ignoring" and
 * starts with no extension, so it is listed last and only as a long shot.
 */
const CANDIDATES = [
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]

function findBrowser() {
  const named = process.env.AUDIT_BROWSER
  if (named) {
    if (!existsSync(named)) {
      throw new Error(`AUDIT_BROWSER is set but does not exist: ${named}`)
    }
    return named
  }
  const found = CANDIDATES.find((path) => existsSync(path))
  if (!found) {
    throw new Error(
      'No Chromium browser found. Set AUDIT_BROWSER to a browser that accepts\n' +
        '--load-extension (Brave or Edge; Google Chrome refuses the flag).',
    )
  }
  return found
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Launch headless with `dist/` loaded, detached so a flow crash cannot orphan it. */
function launch(exe) {
  rmSync(PROFILE, { recursive: true, force: true })
  mkdirSync(PROFILE, { recursive: true })
  const child = spawn(
    exe,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      `--load-extension=${resolve(ROOT, 'dist')}`,
      `--disable-extensions-except=${resolve(ROOT, 'dist')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-component-update',
      '--disable-background-networking',
      '--disable-brave-update',
      'about:blank',
    ],
    { stdio: 'ignore', detached: true },
  )
  child.unref()
  return child
}

/** The extension's own id, read from the targets the browser reports. */
async function extensionId() {
  for (let i = 0; i < 40; i++) {
    const list = await fetchJSON(`http://127.0.0.1:${PORT}/json/list`).catch(
      () => null,
    )
    const hit = list?.find((t) => t.url?.startsWith('chrome-extension://'))
    if (hit) return new URL(hit.url).host
    await wait(500)
  }
  return null
}

/** Run one flow as a child process, counting its PASS/FAIL lines. */
function runFlow(name) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(HERE, name), ID], {
      env: { ...process.env, PORT },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('close', (code) => {
      const pass = (out.match(/^PASS/gm) ?? []).length
      const fail = (out.match(/^FAIL/gm) ?? []).length
      done({ name, code, pass, fail, out })
    })
  })
}

const exe = findBrowser()
console.log(`browser  ${exe}`)
console.log(`port     ${PORT}`)
launch(exe)

const ID = await extensionId()
if (!ID) {
  console.error(
    '\nThe browser started but never reported an extension target.\n' +
      'Google Chrome ignores --load-extension; use Brave or Edge, or set\n' +
      'AUDIT_BROWSER to one of them.',
  )
  await fetchJSON(`http://127.0.0.1:${PORT}/json/version`)
    .then(() => import('./close.mjs'))
    .catch(() => {})
  process.exit(1)
}
console.log(`extension ${ID}\n`)

let totalPass = 0
let totalFail = 0
const failed = []

for (const name of FLOWS) {
  const r = await runFlow(name)
  totalPass += r.pass
  totalFail += r.fail
  const mark = r.fail === 0 && r.code === 0 ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${name.padEnd(30)} ${r.pass} passed, ${r.fail} failed`)
  if (mark === 'FAIL') failed.push(r)
}

for (const r of failed) {
  console.log(`\n--- ${r.name} (exit ${r.code}) ---`)
  console.log(
    r.out
      .split('\n')
      .filter((l) => !l.startsWith('PASS'))
      .join('\n')
      .trim(),
  )
}

console.log(
  `\n${totalFail === 0 ? 'ALL FLOWS PASSED' : 'FLOWS FAILED'} — ` +
    `${totalPass} assertions passed, ${totalFail} failed across ${FLOWS.length} flows`,
)
console.log(
  'restart-a.mjs / restart-b.mjs need a manual browser close between halves ' +
    'and are not run here.',
)

await import('./close.mjs').catch(() => {})
process.exit(totalFail === 0 ? 0 : 1)
