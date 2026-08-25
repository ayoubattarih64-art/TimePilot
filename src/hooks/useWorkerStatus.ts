import { useEffect, useState } from 'react'
import { send } from '../services/messaging'

export type WorkerStatus = {
  version: string | null
  connected: boolean
  error: string | null
}

/**
 * Pings the service worker once per mount to confirm the channel and read the
 * manifest version. Kept in a hook so no component calls chrome.* itself.
 */
export function useWorkerStatus(): WorkerStatus {
  const [status, setStatus] = useState<WorkerStatus>({
    version: null,
    connected: false,
    error: null,
  })

  useEffect(() => {
    let active = true
    send({ type: 'ping' }).then(
      (data) => {
        if (active) {
          setStatus({ version: data.version, connected: true, error: null })
        }
      },
      (cause: unknown) => {
        if (active) {
          setStatus({
            version: null,
            connected: false,
            error: cause instanceof Error ? cause.message : String(cause),
          })
        }
      },
    )
    return () => {
      active = false
    }
  }, [])

  return status
}
