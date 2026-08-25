import { browser, evaluate, ok, page } from './harness.mjs'

/**
 * Accessibility, measured in the running product rather than read off the
 * source.
 *
 * Three things are checked, because they are the three that actually stop a
 * keyboard or screen-reader user: every interactive control has an accessible
 * name; the navigation bar and the segmented controls can be *walked* (the
 * defect fixed in this audit was that selection moved while focus did not);
 * and a modal traps focus, closes on Escape, and gives focus back.
 *
 * Contrast is measured too — computed foreground against computed background,
 * in both themes, for every text node the panel actually paints.
 */

const EXT = process.argv[2]
const cdp = await browser()
const { sessionId } = await page(cdp, `chrome-extension://${EXT}/sidepanel.html`, {
  width: 360,
  height: 900,
})
await new Promise((r) => setTimeout(r, 2500))

const run = (body) => evaluate(cdp, sessionId, `(async () => { ${body} })()`)
const evalx = (expr) => evaluate(cdp, sessionId, expr)
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms))
const key = async (type, k, code, extra = {}) =>
  cdp.send(
    'Input.dispatchKeyEvent',
    { type, key: k, code, windowsVirtualKeyCode: extra.vk ?? 0, ...extra },
    sessionId,
  )
const press = async (k, code, vk) => {
  await key('keyDown', k, code, { vk })
  await key('keyUp', k, code, { vk })
  await settle(220)
}

/* --- 0. State, and past the tour ------------------------------------------ */

await run(`
  const send = (req) => chrome.runtime.sendMessage(req)
  await send({ type: 'settings/complete-onboarding' })
  const list = await send({ type: 'scheduled/list' })
  for (const a of list.data.activities) await send({ type: 'scheduled/remove', id: a.id })
  const d = new Date(Date.now() + 60 * 60000)
  const p = (n) => String(n).padStart(2, '0')
  await send({ type: 'scheduled/create', input: {
    title: 'A11y reminder', type: 'reminder',
    date: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
    time: p(d.getHours()) + ':' + p(d.getMinutes()),
    repeat: 'none', durationMinutes: 0, categoryId: 'work',
    notify: 'at-time', enabled: true,
  }})
  return true
`)
await cdp.send('Page.reload', {}, sessionId)
await settle(2500)

/* --- 1. Every control has an accessible name, on every surface ----------- */
// Approximated the way a screen reader resolves it: aria-label, then
// aria-labelledby, then the associated <label>, then the trimmed text content,
// then title/alt. A control that resolves to nothing is announced as "button".

const NAMELESS = `(() => {
  const named = (el) => {
    const aria = el.getAttribute('aria-label')
    if (aria && aria.trim()) return aria.trim()
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const parts = by.split(/\\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim()
      if (parts) return parts
    }
    if (el.id) {
      const lab = document.querySelector('label[for="' + el.id + '"]')
      if (lab && (lab.textContent ?? '').trim()) return lab.textContent.trim()
    }
    if (el.closest('label') && (el.closest('label').textContent ?? '').trim()) {
      return el.closest('label').textContent.trim()
    }
    const text = (el.textContent ?? '').trim()
    if (text) return text
    const title = el.getAttribute('title')
    if (title && title.trim()) return title.trim()
    return null
  }
  const controls = [...document.querySelectorAll(
    'button, a[href], input, select, textarea, [role="switch"], [role="radio"], [role="tab"]',
  )].filter((el) => {
    if (el.hasAttribute('aria-hidden')) return false
    if (el.type === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 || r.height > 0
  })
  return {
    total: controls.length,
    nameless: controls
      .filter((el) => named(el) === null)
      .map((el) => el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 40)),
  }
})()`

const SECTIONS = [
  'home',
  'activities',
  'routines',
  'focus',
  'timer',
  'schedule',
  'insights',
]
/** Settings is reached from the header, so it is not in the bar. */
const ALL_SECTIONS = [...SECTIONS, 'settings']
const goto = (section) =>
  evalx(`(() => {
     const b = document.querySelector('[data-nav-value="${section}"]')
     if (b) { b.click(); return true }
     const s = [...document.querySelectorAll('button')]
       .find((n) => n.getAttribute('aria-label') === 'Settings')
     if (s) { s.click(); return true }
     return false
   })()`)

let controlsChecked = 0
for (const section of SECTIONS) {
  await evalx(`(() => {
     document.querySelector('[data-nav-value="${section}"]')?.click(); return true
   })()`)
  await settle(750)
  const named = await evalx(NAMELESS)
  controlsChecked += named.total
  ok(
    `${section}: every visible control has an accessible name`,
    named.nameless.length === 0 && named.total > 0,
    `${String(named.total)} controls${named.nameless.length ? ` · nameless: ${named.nameless.join(', ')}` : ''}`,
  )
}
ok(
  'the name check actually covered a realistic number of controls',
  controlsChecked > 60,
  `${String(controlsChecked)} controls across ${String(SECTIONS.length)} sections`,
)

/* --- 2. The navigation bar can be walked end to end ---------------------- */
// The regression this guards: arrow keys changed the section but left focus on
// the first button, so every further press restarted from the same place and the
// bar could not be walked past the second item. Real key events, so the fix is
// proven through the same path a user takes.

await evalx(`(() => { document.querySelector('[data-nav-value="home"]')?.click(); return true })()`)
await settle(600)
await evalx(`(() => { document.querySelector('[data-nav-value="home"]')?.focus(); return true })()`)

// The bar carries seven items; Settings is reached from the header, not here.
const NAV_COUNT = 7
const walk = []
for (let i = 0; i < NAV_COUNT; i++) {
  walk.push(
    await evalx(
      `(() => {
         const el = document.activeElement
         const nav = el?.dataset?.navValue ?? null
         const current = document.querySelector('[aria-current="page"]')?.dataset?.navValue ?? null
         return { focused: nav, current }
       })()`,
    ),
  )
  await press('ArrowRight', 'ArrowRight', 39)
}
const focusedPath = walk.map((w) => w.focused)
ok(
  'ArrowRight walks the whole nav bar, focus following selection',
  new Set(focusedPath).size === NAV_COUNT && focusedPath.every((v) => v !== null),
  focusedPath.join(' → '),
)
ok(
  'and the focused button is always the selected one',
  walk.every((w) => w.focused === w.current),
  walk.map((w) => `${String(w.focused)}/${String(w.current)}`).join(' '),
)

// One more press must wrap to the first item, not fall off the end.
const wrapped = await evalx(
  `(() => document.activeElement?.dataset?.navValue ?? null)()`,
)
ok(
  'the bar wraps rather than dead-ending',
  wrapped === 'home',
  String(wrapped),
)

await press('ArrowLeft', 'ArrowLeft', 37)
const back = await evalx(`(() => document.activeElement?.dataset?.navValue ?? null)()`)
ok(
  'ArrowLeft walks the other way, to the last item',
  back === 'insights',
  String(back),
)

/* --- 3. The segmented control follows the ARIA tabs pattern --------------- */

await evalx(`(() => { document.querySelector('[data-nav-value="insights"]')?.click(); return true })()`)
await settle(800)
const tabs = await evalx(`(() => {
  const list = document.querySelector('[role="tablist"]')
  const items = [...(list?.querySelectorAll('[role="tab"]') ?? [])]
  return {
    count: items.length,
    inTabOrder: items.filter((t) => t.tabIndex === 0).length,
    selected: items.filter((t) => t.getAttribute('aria-selected') === 'true').length,
  }
})()`)
ok(
  'exactly one tab is selected and exactly one is in the tab sequence',
  tabs.count === 3 && tabs.inTabOrder === 1 && tabs.selected === 1,
  JSON.stringify(tabs),
)

await evalx(`(() => {
   document.querySelector('[role="tab"][aria-selected="true"]')?.focus(); return true
 })()`)
await press('ArrowRight', 'ArrowRight', 39)
const tabAfter = await evalx(`(() => {
  const active = document.activeElement
  return {
    focusedIsTab: active?.getAttribute('role') === 'tab',
    focusedSelected: active?.getAttribute('aria-selected'),
    label: (active?.textContent ?? '').trim(),
  }
})()`)
ok(
  'ArrowRight moves the tab selection and takes focus with it',
  tabAfter.focusedIsTab === true && tabAfter.focusedSelected === 'true',
  JSON.stringify(tabAfter),
)

/* --- 4. A modal traps focus, closes on Escape, and hands focus back ------ */
// Sheet and Dialog are built on native <dialog>, so this is really a check that
// they are opened with showModal() rather than shown as a styled div — the
// difference between a real focus trap and a decorative one.

const opened = await evalx(`(() => {
  const opener = [...document.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim() === 'New activity')
  if (!opener) return { ok: false }
  opener.setAttribute('data-a11y-opener', '1')
  opener.focus()
  opener.click()
  return { ok: true }
})()`)
ok('the activity editor opens from the header', opened.ok === true)
await settle(1000)

const modal = await evalx(`(() => {
  const dlg = document.querySelector('dialog[open]')
  if (!dlg) return { present: false }
  const focusables = [...dlg.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter((el) => !el.disabled)
  return {
    present: true,
    isModal: dlg.matches(':modal'),
    inertBackground: document.body.inert === true || dlg.matches(':modal'),
    focusInside: dlg.contains(document.activeElement),
    focusables: focusables.length,
    labelled:
      !!dlg.getAttribute('aria-label') ||
      !!dlg.querySelector('h1, h2, h3'),
  }
})()`)
ok(
  'it is a real modal dialog, not a styled div',
  modal.present === true && modal.isModal === true,
  JSON.stringify(modal),
)
ok(
  'focus moves inside it and it has focusable content',
  modal.focusInside === true && modal.focusables > 2,
  `focusInside=${String(modal.focusInside)} focusables=${String(modal.focusables)}`,
)
ok(
  'and it carries a name, so it is announced as more than "dialog"',
  modal.labelled === true,
  String(modal.labelled),
)

// Tab must not escape a modal: enough presses to cycle past the last control.
for (let i = 0; i < 24; i++) await press('Tab', 'Tab', 9)
const trapped = await evalx(`(() => {
  const dlg = document.querySelector('dialog[open]')
  return dlg ? dlg.contains(document.activeElement) : null
})()`)
ok(
  'Tab cannot leave the open modal',
  trapped === true,
  `focus inside after 24 Tabs: ${String(trapped)}`,
)

await press('Escape', 'Escape', 27)
await settle(900)
const afterEscape = await evalx(`(() => ({
  stillOpen: !!document.querySelector('dialog[open]'),
  focusBackOnOpener:
    document.activeElement?.getAttribute('data-a11y-opener') === '1',
  focusedTag: document.activeElement?.tagName.toLowerCase() ?? null,
}))()`)
ok(
  'Escape closes it',
  afterEscape.stillOpen === false,
  JSON.stringify(afterEscape),
)
ok(
  'and focus returns to the control that opened it',
  afterEscape.focusBackOnOpener === true,
  `focus is on <${String(afterEscape.focusedTag)}>`,
)

/* --- 5. Switches and progress bars carry their state in ARIA ------------- */

await evalx(`(() => {
   const b = [...document.querySelectorAll('button')]
     .find((n) => n.getAttribute('aria-label') === 'Settings')
   b?.click(); return true
 })()`)
await settle(800)
const switchKeyboard = await evalx(`(() => {
  const sw = [...document.querySelectorAll('[role="switch"]')]
    .find((n) => n.getAttribute('aria-label') === 'Show notifications')
  if (!sw) return { found: false }
  return {
    found: true,
    tag: sw.tagName.toLowerCase(),
    checked: sw.getAttribute('aria-checked'),
    named: !!sw.getAttribute('aria-label'),
  }
})()`)
ok(
  'the switch is a real button with role=switch and aria-checked',
  switchKeyboard.found === true &&
    switchKeyboard.tag === 'button' &&
    switchKeyboard.checked !== null &&
    switchKeyboard.named === true,
  JSON.stringify(switchKeyboard),
)

// Space on a <button role="switch"> must toggle it — free with a real button,
// broken with a div, which is the whole reason the primitive uses one.
await evalx(`(() => {
   [...document.querySelectorAll('[role="switch"]')]
     .find((n) => n.getAttribute('aria-label') === 'Show notifications')?.focus()
   return true
 })()`)
const beforeSpace = await evalx(
  `(() => document.activeElement?.getAttribute('aria-checked') ?? null)()`,
)
await key('keyDown', ' ', 'Space', { vk: 32, text: ' ' })
await key('keyUp', ' ', 'Space', { vk: 32 })
await settle(900)
const afterSpace = await evalx(
  `(() => [...document.querySelectorAll('[role="switch"]')]
     .find((n) => n.getAttribute('aria-label') === 'Show notifications')
     ?.getAttribute('aria-checked') ?? null)()`,
)
ok(
  'Space toggles the switch from the keyboard',
  beforeSpace !== null && afterSpace !== null && beforeSpace !== afterSpace,
  `${String(beforeSpace)} → ${String(afterSpace)}`,
)
// Put it back, so later flows are not left with notifications off.
await run(`
  await chrome.runtime.sendMessage({ type: 'settings/set-notifications', enabled: true })
  return true
`)

/* --- 6. A live countdown is exposed as a progress bar with a value ------- */

await run(`
  await chrome.runtime.sendMessage({ type: 'timer/cancel' })
  await chrome.runtime.sendMessage({
    type: 'timer/start',
    input: { title: 'A11y countdown', durationMinutes: 25 },
  })
  return true
`)
await evalx(`(() => { document.querySelector('[data-nav-value="timer"]')?.click(); return true })()`)
await settle(1400)
const progress = await evalx(`(() => {
  const bars = [...document.querySelectorAll('[role="progressbar"]')]
  return bars.map((b) => ({
    now: b.getAttribute('aria-valuenow'),
    min: b.getAttribute('aria-valuemin'),
    max: b.getAttribute('aria-valuemax'),
    label: b.getAttribute('aria-label'),
  }))
})()`)
ok(
  'the countdown is a progressbar with a value, bounds and a spoken label',
  progress.length > 0 &&
    progress.every(
      (b) =>
        b.now !== null &&
        b.min === '0' &&
        b.max === '100' &&
        (b.label ?? '').length > 4,
    ),
  JSON.stringify(progress),
)
ok(
  'and the label states the remaining time, not just a percentage',
  progress.some((b) => /\d+:\d\d/.test(b.label ?? '')),
  progress[0]?.label ?? 'none',
)
await run(`await chrome.runtime.sendMessage({ type: 'timer/cancel' }); return true`)

/* --- 7. Text contrast, computed, in both themes -------------------------- */
// WCAG 2.1 relative luminance on the *computed* colours, with the background
// resolved by walking up to the first non-transparent ancestor — the only way
// to measure what a user actually sees rather than what a token claims.

const CONTRAST = `(() => {
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c)
    if (!m) return null
    const p = m[1].split(',').map((n) => parseFloat(n))
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }
  }
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  })
  const bgOf = (el) => {
    let node = el
    while (node && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor)
      if (c && c.a > 0.95) return c
      node = node.parentElement
    }
    return parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
  }
  const ratio = (a, b) => {
    const l1 = lum(a)
    const l2 = lum(b)
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  }
  const failures = []
  let measured = 0
  for (const el of document.querySelectorAll('*')) {
    // Only elements with their own visible text, so a container is not measured
    // for its children's colour.
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('')
    if (!own) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    if (parseFloat(style.opacity) < 0.4) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const fg = parse(style.color)
    if (!fg) continue
    const bg = bgOf(el)
    const effective = fg.a < 1 ? over(fg, bg) : fg
    const size = parseFloat(style.fontSize)
    const weight = parseInt(style.fontWeight, 10) || 400
    // WCAG large text: >=24px, or >=18.66px bold.
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const need = large ? 3 : 4.5
    const got = ratio(effective, bg)
    measured++
    if (got + 0.05 < need) {
      failures.push({
        text: own.slice(0, 28),
        ratio: Math.round(got * 100) / 100,
        need,
        size: Math.round(size * 10) / 10,
        color: style.color,
        bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
      })
    }
  }
  return { measured, failures: failures.slice(0, 6), failureCount: failures.length }
})()`

for (const theme of ['light', 'dark']) {
  await evalx(`(() => {
     localStorage.setItem('timepilot.theme', '${theme}')
     return true
   })()`)
  await cdp.send('Page.reload', {}, sessionId)
  await settle(2400)
  let totalMeasured = 0
  let totalFailures = 0
  const worst = []
  for (const section of ALL_SECTIONS) {
    await goto(section)
    await settle(700)
    const c = await evalx(CONTRAST)
    totalMeasured += c.measured
    totalFailures += c.failureCount
    for (const f of c.failures) worst.push(`${section}:"${f.text}" ${String(f.ratio)}<${String(f.need)}`)
  }
  ok(
    `${theme}: every text node meets its WCAG AA contrast minimum`,
    totalFailures === 0 && totalMeasured > 100,
    `${String(totalMeasured)} nodes measured${worst.length ? ` · ${worst.slice(0, 5).join(' | ')}` : ''}`,
  )
}

/* --- 8. Reduced motion is honoured -------------------------------------- */

// Emulation.setEmulatedMedia is a *page* domain command, not a browser one, and
// is absent from some headless builds — so it is attempted on the page session
// and the result of the attempt is reported rather than assumed.
const emulated = await cdp
  .send(
    'Emulation.setEmulatedMedia',
    { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] },
    sessionId,
  )
  .then(() => true)
  .catch(() => false)
ok(
  'prefers-reduced-motion can be emulated, so the claim below is measured',
  emulated === true,
  emulated ? 'Emulation.setEmulatedMedia accepted' : 'not available in this build',
)
await cdp.send('Page.reload', {}, sessionId)
await settle(2200)
const reduced = await evalx(`(() => {
  const els = [...document.querySelectorAll('*')].slice(0, 400)
  const slow = els.filter((el) => {
    const s = getComputedStyle(el)
    const dur = (v) => Math.max(0, ...v.split(',').map((x) => parseFloat(x) || 0))
    return dur(s.animationDuration) > 0.05 || dur(s.transitionDuration) > 0.05
  }).length
  return { queryMatches: matchMedia('(prefers-reduced-motion: reduce)').matches, slow }
})()`)
ok(
  'with reduced motion asked for, no animation or transition still runs',
  reduced.queryMatches === true && reduced.slow === 0,
  JSON.stringify(reduced),
)
await cdp
  .send('Emulation.setEmulatedMedia', { features: [] }, sessionId)
  .catch(() => {})

/* --- 9. Focus is always visible ----------------------------------------- */
// Measured by actually tabbing. `:focus-visible` is defined by the input
// modality Chrome last observed, so a programmatic .focus() after a synthetic
// click can legitimately paint nothing — asserting on that would be asserting
// on the harness. Real Tab presses are the case that matters: a keyboard user
// must always be able to see where they are.

await cdp.send('Page.reload', {}, sessionId)
await settle(2200)
await evalx(`(() => { document.body.focus(); return true })()`)

const stops = []
for (let i = 0; i < 22; i++) {
  await press('Tab', 'Tab', 9)
  stops.push(
    await evalx(`(() => {
      const a = document.activeElement
      if (!a || a === document.body) return null
      const s = getComputedStyle(a)
      const outline = parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== 'none'
      const ring =
        s.boxShadow !== 'none' && s.boxShadow !== 'rgba(0, 0, 0, 0) 0px 0px 0px 0px'
      return {
        label:
          a.getAttribute('aria-label') ??
          (a.textContent ?? '').trim().slice(0, 18) ??
          a.tagName.toLowerCase(),
        visible: outline || ring,
        focusVisible: a.matches(':focus-visible'),
      }
    })()`),
  )
}
const reached = stops.filter(Boolean)
const bare = reached.filter((s) => !s.visible)
ok(
  'tabbing through the panel always paints a visible focus indicator',
  bare.length === 0 && reached.length > 8,
  `${String(reached.length)} stops${bare.length ? ` · bare: ${bare.map((b) => b.label).join(', ')}` : ''}`,
)

/* --- 10. Landmarks and one heading per surface --------------------------- */

const structure = []
for (const section of ALL_SECTIONS) {
  await goto(section)
  await settle(600)
  structure.push(
    await evalx(`(() => ({
       section: '${section}',
       h1: document.querySelectorAll('h1').length,
       nav: document.querySelectorAll('nav[aria-label]').length,
       main: document.querySelectorAll('main').length,
     }))()`),
  )
}
ok(
  'every surface has exactly one h1, a named nav landmark, and a main region',
  structure.every((s) => s.h1 === 1 && s.nav >= 1 && s.main >= 1),
  structure
    .filter((s) => s.h1 !== 1 || s.nav < 1 || s.main < 1)
    .map((s) => `${s.section}: h1=${String(s.h1)} nav=${String(s.nav)} main=${String(s.main)}`)
    .join(' | ') || 'all correct',
)

cdp.close()
