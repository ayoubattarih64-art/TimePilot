import { useCallback, useEffect, useMemo, useState } from 'react'
import { send } from '../services/messaging'
import { onStateChanged } from '../services/storage'
import type { Settings } from '../models'

/**
 * The surfaces' single door to persisted settings.
 *
 * The worker owns the write; this hook asks and mirrors, exactly like every
 * other data hook, so no component ever touches chrome.* and a change made by
 * one surface reaches the others through the storage listener.
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => {
    setNonce((value) => value + 1)
  }, [])

  useEffect(() => {
    let active = true
    send({ type: 'settings/get' }).then(
      (data) => {
        if (active) setSettings(data.settings)
      },
      () => {
        /* Leave null: a gate keyed on settings waits rather than guessing. */
      },
    )
    return () => {
      active = false
    }
  }, [nonce])

  useEffect(() => {
    return onStateChanged((changes) => {
      if ('settings' in changes) refresh()
    })
  }, [refresh])

  const completeOnboarding = useCallback(async () => {
    const data = await send({ type: 'settings/complete-onboarding' })
    setSettings(data.settings)
  }, [])

  /**
   * Turn notifications on or off. Applied optimistically-free: the response is
   * the row the worker wrote, so the switch can never show a state storage
   * disagrees with.
   */
  const setNotificationsEnabled = useCallback(async (enabled: boolean) => {
    const data = await send({ type: 'settings/set-notifications', enabled })
    setSettings(data.settings)
  }, [])

  return useMemo(
    () => ({ settings, completeOnboarding, setNotificationsEnabled }),
    [settings, completeOnboarding, setNotificationsEnabled],
  )
}
