import { Monitor, Moon, PartyPopper, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../../lib/cn'
import { useTheme, type ThemePreference } from '../../../theme'
import {
  Button,
  Card,
  SectionHeader,
  Switch,
} from '../../../components/ui'
import { BlocklistsSection } from '../../../components/blocklists'

export type SettingsProps = {
  /** Manifest version, read once by the caller — not from chrome.* here. */
  version: string | null
  connected: boolean
  /** Whether TimePilot may raise notifications at all. */
  notificationsEnabled: boolean
  onSetNotificationsEnabled: (enabled: boolean) => void
  /** Reopens the welcome tour. */
  onOpenOnboarding: () => void
}

const THEMES: ReadonlyArray<{
  value: ThemePreference
  label: string
  icon: ReactNode
}> = [
  { value: 'light', label: 'Light', icon: <Sun size={16} strokeWidth={2} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={16} strokeWidth={2} /> },
  {
    value: 'system',
    label: 'System',
    icon: <Monitor size={16} strokeWidth={2} />,
  },
]

/**
 * Settings, grouped the way they are read: what it looks like, what it is
 * allowed to do, and what it is. Each group is a labelled section; only the
 * settings that actually do something today appear.
 */
export function Settings({
  version,
  connected,
  notificationsEnabled,
  onSetNotificationsEnabled,
  onOpenOnboarding,
}: SettingsProps) {
  const { preference, setPreference } = useTheme()

  return (
    <div className="flex flex-col gap-5 p-4">
      <h1 className="text-lg font-semibold text-primary">Settings</h1>

      <section className="flex flex-col gap-2.5">
        <SectionHeader title="Appearance" />
        <Card padding="sm">
          <div
            role="radiogroup"
            aria-label="Theme"
            className="grid grid-cols-3 gap-2"
          >
            {THEMES.map((theme) => {
              const active = preference === theme.value
              return (
                <button
                  key={theme.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPreference(theme.value)}
                  className={cn(
                    'flex min-w-0 flex-col items-center gap-1.5 rounded-md border px-2 py-2.5',
                    'transition-colors duration-150 ease-tp',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    active
                      ? 'border-accent bg-accent-subtle text-accent'
                      : 'border-transparent bg-surface-sunken text-secondary hover:text-primary',
                  )}
                >
                  <span aria-hidden="true" className="shrink-0">
                    {theme.icon}
                  </span>
                  <span className="w-full truncate text-center text-xs font-medium">
                    {theme.label}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-2.5 text-2xs text-muted">
            System follows your operating system's appearance setting.
          </p>
        </Card>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionHeader title="Website blocking" />
        <BlocklistsSection />
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionHeader title="Notifications" />
        <Card padding="sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-primary">
                Show notifications
              </p>
              <p className="mt-0.5 text-2xs text-muted">
                Reminders, and the end of a focus session or timer. Off means
                TimePilot stays silent — the schedule still advances, so a muted
                reminder is not replayed later.
              </p>
            </div>
            <Switch
              label="Show notifications"
              checked={notificationsEnabled}
              onChange={onSetNotificationsEnabled}
              className="mt-0.5"
            />
          </div>
          {!notificationsEnabled ? (
            <p
              role="status"
              className="mt-2.5 rounded-md bg-surface-sunken px-2.5 py-2 text-2xs text-secondary"
            >
              Nothing will be announced while this is off.
            </p>
          ) : null}
        </Card>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionHeader title="General" />
        <Card padding="sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-primary">Welcome tour</p>
              <p className="mt-0.5 text-2xs text-muted">
                Walk through the basics again.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={onOpenOnboarding}
              iconLeft={
                <PartyPopper size={13} strokeWidth={2} aria-hidden="true" />
              }
            >
              Show again
            </Button>
          </div>
        </Card>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionHeader title="About" />
        <Card padding="sm">
          <dl className="flex flex-col gap-2">
            <Row
              label="Version"
              value={version ? `TimePilot ${version}` : '—'}
            />
            <Row
              label="Background worker"
              value={connected ? 'Connected' : 'Not responding'}
            />
          </dl>
        </Card>
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-secondary">{label}</dt>
      <dd className="truncate text-xs font-medium text-primary">{value}</dd>
    </div>
  )
}
