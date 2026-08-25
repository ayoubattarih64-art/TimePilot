import { browser, evaluate, ok, page } from './harness.mjs'

/**
 * Responsive sweep: every surface, at the three widths a side panel can be
 * dragged to, in light and dark.
 *
 * The assertion is the one thing that actually breaks a panel — content wider
 * than the viewport, which turns into a horizontal scrollbar and clipped
 * controls. Checked on the document and on every element, so an overflowing
 * child inside a scroll container is caught too.
 */

const EXT = process.argv[2]
const WIDTHS = [320, 360, 400]
const cdp = await browser()

const SECTIONS = [
  'home',
  'activities',
  'routines',
  'focus',
  'timer',
  'schedule',
  'insights',
  'settings',
]

/** Seed enough state that no page is measured empty. */
{
  const { sessionId } = await page(cdp, `chrome-extension://${EXT}/sidepanel.html`)
  await new Promise((r) => setTimeout(r, 2500))
  const seeded = await evaluate(
    cdp,
    sessionId,
    `(async () => {
      const send = (req) => chrome.runtime.sendMessage(req)
      const list = await send({ type: 'scheduled/list' })
      for (const a of list.data.activities) await send({ type: 'scheduled/remove', id: a.id })
      const rl = await send({ type: 'routine/list' })
      for (const r of rl.data.routines) await send({ type: 'routine/remove', id: r.id })

      const d = new Date(Date.now() + 45 * 60_000)
      const p = (n) => String(n).padStart(2, '0')
      const date = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      const time = p(d.getHours()) + ':' + p(d.getMinutes())

      // A long title is the realistic worst case for a narrow panel.
      await send({ type: 'scheduled/create', input: {
        title: 'Quarterly planning review with the whole extended team',
        type: 'reminder', date, time, repeat: 'weekdays', durationMinutes: 90,
        categoryId: 'work', notify: 'min-15', enabled: true,
      }})
      await send({ type: 'scheduled/create', input: {
        title: 'Short one', type: 'timer', date, time, repeat: 'none',
        durationMinutes: 15, categoryId: 'health', notify: 'at-time', enabled: false,
      }})
      await send({ type: 'routine/create', input: {
        name: 'Evening wind-down with a deliberately long name',
        description: 'Three steps', categoryId: 'personal', daysOfWeek: [],
        startTime: '21:00', enabled: true,
        steps: [
          { title: 'Tidy the desk and close every tab', durationMinutes: 10, type: 'reminder' },
          { title: 'Read', durationMinutes: 20, type: 'timer' },
          { title: 'Plan tomorrow', durationMinutes: 15, type: 'focus' },
        ],
      }})
      await send({ type: 'settings/complete-onboarding' })
      const after = await send({ type: 'scheduled/list' })
      return after.data.activities.length
    })()`,
  )
  ok('seeded state for the sweep', seeded >= 3, `activities=${String(seeded)}`)
  await cdp.send('Target.closeTarget', {
    targetId: (await cdp.send('Target.getTargets', { filter: [{}] })).targetInfos.find(
      (t) => t.url.includes('sidepanel.html'),
    ).targetId,
  })
}

/** Widest overflow on the page, plus the worst offender's identity. */
const OVERFLOW = `(() => {
  const docWidth = document.documentElement.clientWidth
  let worst = null
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    const over = Math.round(r.right - docWidth)
    if (over > 1 && (!worst || over > worst.over)) {
      worst = {
        over,
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 70),
        text: (el.textContent ?? '').trim().slice(0, 40),
      }
    }
  }
  return {
    docWidth,
    scrollOverflow: document.documentElement.scrollWidth - docWidth,
    bodyOverflow: document.body.scrollWidth - docWidth,
    worst,
  }
})()`

async function sweep(url, label, theme) {
  for (const width of WIDTHS) {
    const { sessionId, targetId } = await page(cdp, url, { width, height: 700 })
    await new Promise((r) => setTimeout(r, 1200))

    await evaluate(
      cdp,
      sessionId,
      `(() => {
         localStorage.setItem('timepilot.theme', '${theme}')
         document.documentElement.classList.toggle('dark', ${String(theme === 'dark')})
         return true
       })()`,
    )
    // The panel reads the preference on mount, so reload into the theme.
    await cdp.send('Page.reload', {}, sessionId)
    await new Promise((r) => setTimeout(r, 1600))

    if (label !== 'popup' && label !== 'blocked' && label !== 'onboarding') {
      // Navigate by clicking the bar, so what is measured is what a user sees.
      await evaluate(
        cdp,
        sessionId,
        `(() => {
           const b = document.querySelector('[data-nav-value="${label}"]')
           if (b) { b.click(); return true }
           const s = [...document.querySelectorAll('button')]
             .find((n) => n.getAttribute('aria-label') === 'Settings')
           if (s && '${label}' === 'settings') { s.click(); return true }
           return false
         })()`,
      )
      await new Promise((r) => setTimeout(r, 700))
    }

    const result = await evaluate(cdp, sessionId, OVERFLOW)
    const painted = await evaluate(
      cdp,
      sessionId,
      `(() => {
         const dark = document.documentElement.classList.contains('dark')
         const bg = getComputedStyle(document.body).backgroundColor
         return { dark, bg, chars: (document.body.innerText ?? '').trim().length }
       })()`,
    )

    ok(
      `${label} @${String(width)} ${theme}: no horizontal overflow`,
      result.scrollOverflow <= 1 && result.bodyOverflow <= 1 && result.worst === null,
      `scroll=${String(result.scrollOverflow)} body=${String(result.bodyOverflow)}` +
        (result.worst
          ? ` worst=+${String(result.worst.over)}px <${result.worst.tag}> "${result.worst.text}"`
          : ''),
    )
    ok(
      `${label} @${String(width)} ${theme}: rendered in the right theme`,
      painted.dark === (theme === 'dark') && painted.chars > 20,
      `dark=${String(painted.dark)} bg=${painted.bg} chars=${String(painted.chars)}`,
    )

    await cdp.send('Target.closeTarget', { targetId })
  }
}

for (const theme of ['light', 'dark']) {
  for (const section of SECTIONS) {
    await sweep(`chrome-extension://${EXT}/sidepanel.html`, section, theme)
  }
  await sweep(`chrome-extension://${EXT}/popup.html`, 'popup', theme)
  await sweep(
    `chrome-extension://${EXT}/blocked.html?d=instagram.com`,
    'blocked',
    theme,
  )
}

cdp.close()
