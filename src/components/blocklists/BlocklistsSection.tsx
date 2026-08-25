import { useCallback, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Input, SectionHeader } from '../ui'
import { describeRejection } from '../../lib/domain'
import { useBlocklists, type BlocklistOutcome } from '../../hooks/useBlocklists'
import { useBlockingStatus } from '../../hooks/useBlockingStatus'
import {
  MAX_BLOCKLIST_DOMAINS,
  MAX_BLOCKLIST_NAME,
  MAX_BLOCKLISTS,
} from '../../models'
import { BlocklistRow } from './BlocklistRow'

/**
 * Blocklist management.
 *
 * A list of names with a count and a mode, and one open at a time for editing.
 * No administration dashboard: the only operations are the ones the user needs —
 * create, rename, add a domain, remove a domain, switch the mode, turn it off,
 * delete.
 *
 * Nothing here knows what a DNR rule is. It edits lists through
 * `useBlocklists`, and the worker decides what that means for the network layer,
 * which is also why an edit made during a running focus session takes effect
 * without this component doing anything special.
 */

/** A refusal, as a sentence. Domain reasons come from `lib/domain`. */
function describeOutcome(outcome: BlocklistOutcome): string | null {
  if (outcome.ok) return null
  switch (outcome.reason) {
    case 'invalid-domain':
      // The worker collapses every domain rejection into one reason, so the
      // wording has to cover all of them.
      return describeRejection('invalid')
    case 'full':
      return `A list can hold ${String(MAX_BLOCKLIST_DOMAINS)} websites.`
    case 'limit':
      return `You can keep ${String(MAX_BLOCKLISTS)} blocklists.`
    case 'not-found':
      return 'That blocklist no longer exists.'
    case 'failed':
      return 'That could not be saved.'
  }
}

export function BlocklistsSection() {
  const {
    blocklists,
    loading,
    busy,
    create,
    rename,
    addDomain,
    removeDomain,
    setEnabled,
    setMode,
    remove,
  } = useBlocklists()
  const { activeIds } = useBlockingStatus()
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const submitNew = useCallback(async () => {
    const name = newName.trim()
    if (name.length === 0) return
    const outcome = await create(name)
    setMessage(describeOutcome(outcome))
    if (outcome.ok) {
      setNewName('')
      setCreating(false)
      // Open it straight away: a list with no domains blocks nothing, so the
      // next thing the user wants is the domain field.
      setOpenId(outcome.list.id)
    }
  }, [create, newName])

  return (
    <section className="flex flex-col gap-2.5">
      <SectionHeader title="Blocklists" />
      <p className="text-2xs text-muted">
        Websites TimePilot keeps away. A list blocks during Focus sessions that
        choose it, or always when you say so.
      </p>

      {message ? (
        <p role="status" className="text-2xs text-critical">
          {message}
        </p>
      ) : null}

      {loading ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : blocklists.length === 0 ? (
        <p className="text-xs text-secondary">No blocklists yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">
          {blocklists.map((list) => (
            <li key={list.id}>
              <BlocklistRow
                list={list}
                open={openId === list.id}
                busy={busy}
                active={activeIds.has(list.id)}
                onToggle={() => {
                  setMessage(null)
                  setOpenId(openId === list.id ? null : list.id)
                }}
                onRename={async (name) => {
                  setMessage(describeOutcome(await rename(list.id, name)))
                }}
                onAddDomain={async (domain) => {
                  const outcome = await addDomain(list.id, domain)
                  setMessage(describeOutcome(outcome))
                  return outcome.ok
                }}
                onRemoveDomain={async (domain) => {
                  setMessage(describeOutcome(await removeDomain(list.id, domain)))
                }}
                onSetMode={async (mode) => {
                  setMessage(describeOutcome(await setMode(list.id, mode)))
                }}
                onSetEnabled={(enabled) => {
                  void setEnabled(list.id, enabled)
                }}
                onDelete={async () => {
                  const ok = await remove(list.id)
                  setMessage(ok ? null : 'That blocklist could not be deleted.')
                  if (ok) setOpenId(null)
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-raised p-3">
          <Input
            label="Blocklist name"
            placeholder="Study distractions"
            value={newName}
            maxLength={MAX_BLOCKLIST_NAME}
            inputSize="sm"
            autoFocus
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submitNew()
              }
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={newName.trim().length === 0 || busy}
              onClick={() => void submitNew()}
            >
              Create
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCreating(false)
                setNewName('')
                setMessage(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={blocklists.length >= MAX_BLOCKLISTS}
          onClick={() => {
            setMessage(null)
            setCreating(true)
          }}
          iconLeft={<Plus size={14} strokeWidth={2.5} aria-hidden="true" />}
        >
          New blocklist
        </Button>
      )}
    </section>
  )
}
