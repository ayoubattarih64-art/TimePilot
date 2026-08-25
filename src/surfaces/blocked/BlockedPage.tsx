import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Compass, ShieldCheck } from 'lucide-react'
import { Button } from '../../components/ui'
import { formatClock } from '../../lib/time'
import { useNow } from '../../hooks/useNow'
import { focusRemainingMs, type Blocklist, type FocusSession } from '../../models'
import { send } from '../../services/messaging'

/**
 * The page a blocked website lands on.
 *
 * DNR redirects the request here with the blocked domain in the query, so the
 * page knows exactly what was stopped and can say so calmly — the opposite of a
 * browser error. Everything it shows is read back from the engines' own state:
 * the live focus session for the remaining time, the blocklists for the name of
 * the list doing the blocking. Nothing is tracked, sent anywhere, or remembered;
 * the page is as local as the rules that point at it.
 *
 * There is no redirect loop by construction: the rules match the blocklisted
 * domains, and this page lives on the extension's own origin, which no rule in
 * TimePilot's range ever matches. Chrome's internal pages are likewise outside
 * the rules' reach — they are not web requests to a blocklisted domain.
 */

export function BlockedPage() {
  const now = useNow(1000)
  const domain = useMemo(() => {
    const param = new URLSearchParams(window.location.search).get('d')
    return param ? param.trim() : ''
  }, [])

  const [session, setSession] = useState<FocusSession | null>(null)
  const [lists, setLists] = useState<Blocklist[]>([])

  useEffect(() => {
    let active = true
    void send({ type: 'focus/current' }).then(
      (data) => {
        if (active) setSession(data.session)
      },
      () => {
        /* The page renders fine without the session; the copy simply drops
           the countdown. */
      },
    )
    void send({ type: 'blocklist/list' }).then(
      (data) => {
        if (active) setLists(data.blocklists)
      },
      () => {
        /* Same: the list name is a courtesy, not a dependency. */
      },
    )
    return () => {
      active = false
    }
  }, [])

  const focusing =
    session !== null &&
    session.status === 'running' &&
    session.blocklistId !== null

  const remaining = focusing ? formatClock(focusRemainingMs(session, now)) : null

  // The first saved list that contains this domain, for a name to show. A
  // domain can live in more than one list; naming one is enough — the page
  // explains, it does not audit.
  const listName =
    lists.find((list) => list.domains.includes(domain))?.name ?? null

  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      // Opened as the tab's first entry (a redirect with no history to return
      // to). Closing is the only honest way out.
      window.close()
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface px-6 py-10 text-center">
      <span
        className="grid h-9 w-9 place-items-center rounded-md bg-accent text-on-accent"
        aria-hidden="true"
      >
        <Compass size={18} strokeWidth={2.25} />
      </span>

      <div className="flex max-w-md flex-col gap-2">
        <p className="text-lg font-semibold text-primary">Stay focused.</p>
        <p className="text-sm leading-relaxed text-secondary">
          {domain ? (
            <span className="font-medium text-primary">{domain}</span>
          ) : (
            'This site'
          )}{' '}
          {focusing && remaining !== null
            ? 'is blocked while your focus session is active.'
            : 'is blocked by a TimePilot blocklist.'}
        </p>
        {listName ? (
          <p className="flex items-center justify-center gap-1.5 text-2xs text-muted">
            <ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />
            {listName}
          </p>
        ) : null}
      </div>

      {focusing && remaining !== null ? (
        <p
          className="tabular rounded-lg bg-surface-sunken px-4 py-2 text-sm font-medium text-secondary"
          role="timer"
          aria-label={`${remaining} remaining in your focus session`}
        >
          {remaining} remaining
        </p>
      ) : null}

      <Button
        variant="secondary"
        size="md"
        onClick={goBack}
        iconLeft={<ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />}
      >
        Go back
      </Button>
    </div>
  )
}
