import { useEffect, useState } from 'react'

/**
 * A clock that re-renders on a fixed interval.
 *
 * Relative labels ("Starts in 38 minutes") are computed from `Date.now()`, so
 * without this they would go stale while the panel sits open. The default 30s
 * period keeps minute-granularity text accurate without a per-second render.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(handle)
  }, [intervalMs])

  return now
}
