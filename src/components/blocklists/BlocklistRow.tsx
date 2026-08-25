import { useState } from 'react'
import { ChevronDown, ChevronRight, Trash2, X } from 'lucide-react'
import { Button, IconButton, Input, Switch } from '../ui'
import { cn } from '../../lib/cn'
import {
  MAX_BLOCKLIST_NAME,
  type Blocklist,
  type BlocklistMode,
} from '../../models'

export type BlocklistRowProps = {
  list: Blocklist
  open: boolean
  busy: boolean
  /** Whether this list's rules are in force right now, read back from Chrome. */
  active: boolean
  onToggle: () => void
  onRename: (name: string) => Promise<void>
  /** Resolves true when the domain was accepted, so the field can be cleared. */
  onAddDomain: (domain: string) => Promise<boolean>
  onRemoveDomain: (domain: string) => Promise<void>
  onSetMode: (mode: BlocklistMode) => void
  onSetEnabled: (enabled: boolean) => void
  onDelete: () => Promise<void>
}

const MODE_LABELS: Record<BlocklistMode, string> = {
  focus: 'During focus',
  always: 'Always',
}

/**
 * One blocklist: a name, a count and its mode, expanding to its domains.
 *
 * Collapsed by default so the section stays a short list however many domains a
 * list holds. The row reads at a glance the way the feature is thought about —
 * what it is called, how much it covers, whether it is enforcing right now —
 * and the switch is the master on/off, with the mode choosing *when* an enabled
 * list applies. Deletion asks once inline rather than opening a dialog — the
 * whole section is small, and a list is cheap to recreate.
 */
export function BlocklistRow({
  list,
  open,
  busy,
  active,
  onToggle,
  onRename,
  onAddDomain,
  onRemoveDomain,
  onSetMode,
  onSetEnabled,
  onDelete,
}: BlocklistRowProps) {
  const [name, setName] = useState(list.name)
  const [domain, setDomain] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const count = list.domains.length

  return (
    <div className="group relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-2.5 pr-14 text-left transition-colors duration-150 ease-tp hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="shrink-0 text-muted" aria-hidden="true">
          {open ? (
            <ChevronDown size={15} strokeWidth={2} />
          ) : (
            <ChevronRight size={15} strokeWidth={2} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-primary">
            {list.name}
          </span>
          <span className="block truncate text-2xs text-muted">
            {count === 1 ? '1 website' : `${String(count)} websites`}
            {!list.enabled
              ? ' · off'
              : ` · ${MODE_LABELS[list.mode]}`}
          </span>
        </span>
        {list.enabled && active ? (
          <span
            className="flex shrink-0 items-center gap-1 text-2xs font-medium text-good"
            title="Blocking right now"
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-good"
              aria-hidden="true"
            />
            Active
          </span>
        ) : null}
      </button>

      {/* The switch sits above the expanding button so it never fights the
          disclosure for the click. */}
      <div className="absolute top-2.5 right-3 flex items-center">
        <Switch
          label={
            list.enabled
              ? `Stop blocking with ${list.name}`
              : `Allow blocking with ${list.name}`
          }
          checked={list.enabled}
          disabled={busy}
          onChange={onSetEnabled}
        />
      </div>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3">
          <div
            role="radiogroup"
            aria-label={`When ${list.name} blocks`}
            className="grid grid-cols-2 gap-2"
          >
            {(['focus', 'always'] as const).map((mode) => {
              const selected = list.mode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={busy}
                  onClick={() => onSetMode(mode)}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-2xs font-medium',
                    'transition-colors duration-150 ease-tp',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    'disabled:pointer-events-none disabled:opacity-45',
                    selected
                      ? 'border-accent-border bg-accent-subtle text-accent'
                      : 'border-transparent bg-surface-sunken text-secondary hover:text-primary',
                  )}
                >
                  {MODE_LABELS[mode]}
                </button>
              )
            })}
          </div>

          <Input
            label="Name"
            value={name}
            inputSize="sm"
            maxLength={MAX_BLOCKLIST_NAME}
            onChange={(event) => setName(event.target.value)}
            // Committed on blur rather than per keystroke: every rename is a
            // storage write plus a reconcile, and one per character is waste.
            onBlur={() => {
              const next = name.trim()
              if (next.length > 0 && next !== list.name) void onRename(next)
            }}
          />

          {count > 0 ? (
            <ul className="flex flex-col gap-1">
              {list.domains.map((entry) => (
                <li
                  key={entry}
                  className="flex items-center gap-2 rounded-md bg-surface-sunken px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-primary">
                    {entry}
                  </span>
                  <IconButton
                    label={`Remove ${entry}`}
                    size="sm"
                    disabled={busy}
                    icon={<X size={13} strokeWidth={2.5} />}
                    onClick={() => void onRemoveDomain(entry)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-2xs text-muted">
              No websites yet. An empty list blocks nothing.
            </p>
          )}

          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const value = domain.trim()
              if (value.length === 0) return
              void onAddDomain(value).then((ok) => {
                if (ok) setDomain('')
              })
            }}
          >
            <div className="min-w-0 flex-1">
              <Input
                label="Add a website"
                placeholder="youtube.com"
                value={domain}
                inputSize="sm"
                onChange={(event) => setDomain(event.target.value)}
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={domain.trim().length === 0 || busy}
            >
              Add
            </Button>
          </form>

          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-2xs text-secondary">
                Delete "{list.name}"?
              </p>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => void onDelete()}
              >
                Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
              >
                Keep
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setConfirmDelete(true)}
              iconLeft={<Trash2 size={13} strokeWidth={2} aria-hidden="true" />}
            >
              Delete blocklist
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}
