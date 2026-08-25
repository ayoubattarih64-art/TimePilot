# TimePilot

A personal time and activity assistant, built as a Chromium extension (Manifest V3)
with React, TypeScript, and Vite.

Everything runs on your machine. There is no account, no cloud, no backend, no
AI, no telemetry and no analytics — the extension makes no network requests at
all, and its only storage is `chrome.storage.local` in your own browser profile.

## Features

- **Activities** — one-off and repeating scheduled items (reminders and events)
  with categories, durations, and per-item notification settings.
- **Reminders** — a `chrome.alarms`-backed scheduler with notifications that
  carry *Done* and *Snooze* actions, plus reconciliation that repairs alarms
  after a restart, a time-zone change, or a DST transition.
- **Focus sessions** — a countdown with pause, resume, add-time and cancel, and
  an optional website blocklist attached for the length of the session.
- **Timer** — a standalone countdown sharing the same countdown layer.
- **Routines** — reusable multi-step day plans that generate ordinary scheduled
  activities; editing or disabling a routine reconciles the rows it owns.
- **Schedule** — the day and week view over everything scheduled.
- **Website blocking** — `declarativeNetRequest` blocklists in two modes:
  *focus* (enforced only while a Focus session runs) and *always*. Blocked
  navigations land on the extension's own `blocked.html`.
- **Insights** — focus totals, session counts, averages and per-day figures for
  today, this week or this month, computed locally from your stored sessions.
- **Onboarding** — a six-step tour on first run, reopenable from Settings.
- **Popup** — the next scheduled item and quick actions from the toolbar.
- **Light and dark themes** — plus *System*, all three verified for WCAG AA
  contrast.

## Install from source

```
npm install
npm run build
```

Then load `dist/` as an unpacked extension:

- **Chrome** — `chrome://extensions` → enable **Developer mode** → **Load unpacked**
- **Brave** — `brave://extensions` → same steps
- **Edge** — `edge://extensions` → enable **Developer mode** → **Load unpacked**

Reload from the extensions page after each rebuild. The service worker's console
is behind the "service worker" link on the extension's card.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Type-check and build the unpacked extension into `dist/` |
| `npm test` | Run the unit suite (Vitest) |
| `npm run lint` | Run ESLint |
| `npm run dev` | Vite dev server for UI iteration only — see the caveat below |
| `npm run icons` | Regenerate `public/icons/*.png` |
| `npm run audit:flows` | Run the browser audit flows against `dist/` — see below |

`npm run dev` serves the surfaces over HTTP for fast UI iteration, but the
`chrome.*` APIs are absent there, so anything that talks to the background
worker will fail. Build and load unpacked to exercise the real extension.

## Browser audit flows

`.audit/` holds a small Chrome DevTools Protocol harness that drives the **real
built extension** in a headless Chromium browser — no mocks, with alarms and
blocking rules read back from the browser itself.

```
npm run build
npm run audit:flows
```

**Prerequisite:** a Chromium browser that accepts `--load-extension` on the
command line. The script looks for Brave, then Edge, then Chrome, and you can
point it at a specific binary:

```
AUDIT_BROWSER="/c/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe" npm run audit:flows
```

Google Chrome refuses `--load-extension` and `--disable-extensions-except`
unless an enterprise policy re-enables them, logging *"not allowed in Google
Chrome, ignoring"*. Brave and Edge accept both, so they are the practical
targets; for Chrome, load `dist/` by hand from `chrome://extensions`.

The flows cover core scheduling, concurrency, orphaned alarms, same-minute
alarm delivery, focus + blocking, routines, failure recovery, responsive layout
at 320/360/400px in both themes, insights arithmetic, and accessibility.
`restart-a.mjs` / `restart-b.mjs` verify a real browser restart across the same
profile and are run manually, since they need a browser close in between.

## Permissions

| Permission | Why |
|---|---|
| `alarms` | Every reminder, focus session and timer end is a `chrome.alarms` entry, plus two periodic reconciliation sweeps. MV3 workers are evicted, so alarms are the only durable way to fire on time. |
| `storage` | All data lives in `chrome.storage.local`. `local` rather than `sync` because a running session's write rate would exceed `sync`'s quota. |
| `notifications` | Reminder, focus-completion and timer-completion notifications, with their *Done* / *Snooze* actions. |
| `sidePanel` | The main UI is a side panel. |
| `declarativeNetRequest` | Website blocking. Rules are declarative, so the extension never sees your browsing — it does not read requests, it only tells the browser which hosts to redirect. |
| `host_permissions: <all_urls>` | Required to redirect a blocked navigation to the extension's own `blocked.html`. A DNR redirect rule needs host access for the hosts it matches, and a user may add any host to a blocklist. |

No `tabs`, no `history`, no `webRequest`, no remote code, no content scripts.

## Architecture

```
public/manifest.json        MV3 manifest (copied to dist/ verbatim)
public/icons/               generated PNG icons
popup.html, sidepanel.html  extension page entry points
blocked.html                the page a blocked navigation is redirected to

src/surfaces/popup/         popup UI
src/surfaces/sidepanel/     side panel UI and its pages
src/surfaces/blocked/       blocked-page UI
src/components/             design-system components and feature components
src/theme/                  light/dark/system theme provider
src/hooks/                  React hooks over the worker and storage

src/background/             service worker
  service-worker.ts           entry: listener registration only
  router.ts                   request → feature dispatch (37 message types)
  features/                   scheduler, focus, timers, routines, blocking

src/services/               Chrome API wrappers (storage, alarms,
                            notifications, messaging, blocking, side panel)
src/models/                 domain types, no Chrome dependencies
src/lib/                    pure logic (insights, rule planning, plans, time)
```

The layering rule: `models` and `lib` are dependency-free and unit-tested,
`services` wrap Chrome APIs, `background/features` hold logic, and surfaces
talk to the worker only through `services/messaging`.

Two design decisions worth knowing:

- **Every worker entry point is serialised.** Mutations are `read a storage key
  → modify → write it back`, which is only safe if two never overlap. Chrome
  makes no such promise — two alarms due in the same minute arrive as
  independent callbacks. `src/lib/serial.ts` queues them.
- **Blocking rule ids are a namespace, not a guess.** TimePilot owns
  `declarativeNetRequest` dynamic rule ids 1,000,000–1,009,999 and touches
  nothing outside that band, so it can reconcile its own rules without
  disturbing another extension's.

## Browser compatibility

| Browser | Status |
|---|---|
| Brave | Verified — full audit-flow suite passes |
| Edge | Verified — full audit-flow suite passes |
| Chrome | Not verified end-to-end. `minimum_chrome_version` is 116 and every API used is standard Chromium MV3, but Chrome blocks command-line extension loading, so the automated flows could not be run against it in this environment. |

## Known limitations

- Blocking is enforced by `declarativeNetRequest`, so it stops navigations to a
  listed host and its subdomains. It is not a content filter and does not block
  a page already open before the session started.
- One Focus session at a time, and one blocklist enforced per session.
- Data is per-browser-profile. There is no export, import, or sync, and
  uninstalling the extension removes it.
- Notifications are delivered by the operating system, so a system-level Do Not
  Disturb or a denied notification permission suppresses them; Settings says so
  when notifications are off.
- Work queued but not yet started when Chrome evicts the service worker is
  dropped. The reconciliation sweeps repair the resulting state, but it is a
  real window.
- `npm run dev` cannot exercise anything that talks to the worker.

## Not implemented, deliberately

No AI, no accounts, no cloud sync, no backend, no external APIs, no telemetry or
analytics, no subscriptions or paid services, no social features. Prayer-time
calculations, custom motivational blocked pages, simultaneous blocklists and
concurrent Focus sessions are out of scope for this release.
