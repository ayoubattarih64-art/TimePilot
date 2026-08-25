/**
 * Domain normalisation.
 *
 * Pure, and deliberately strict. What the user types is untrusted input that ends
 * up inside a network rule, so this is the only place a string becomes a domain:
 * everything downstream — storage, the rule planner, the DNR call — may assume it
 * is holding a bare, lowercase, validated hostname.
 *
 * Rejecting is the default. A pattern this cannot make sense of is refused with a
 * reason the UI can show, never accepted "as-is" and never widened into a
 * wildcard, because a rule built from a guess blocks the wrong thing.
 */

/** Why an input was refused. The UI turns these into sentences. */
export type DomainRejection =
  | 'empty'
  /** A scheme other than http/https — javascript:, data:, file:, chrome:, … */
  | 'scheme'
  /** Not a hostname: wildcards, spaces, an IP literal, a bad label. */
  | 'invalid'
  /** Longer than DNS allows. */
  | 'too-long'

export type DomainResult =
  | { ok: true; domain: string }
  | { ok: false; reason: DomainRejection }

/** The only schemes a blockable web request can have. */
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http', 'https'])

/** DNS limits. A label is 63 octets, a name 253. */
const MAX_LABEL = 63
const MAX_NAME = 253

/**
 * A hostname of two or more labels, letters/digits/hyphens only, no leading or
 * trailing hyphen in any label, and a non-numeric final label.
 *
 * Two labels minimum because a single one ("localhost", "intranet") is not
 * something a distraction list means, and a numeric last label is rejected so an
 * IP literal cannot slip in as a domain.
 */
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

/** A final label that is all digits means an IP literal, not a domain. */
const NUMERIC_TLD = /\.\d+$/

/**
 * Strip a scheme, if one is present, and report whether it was allowed.
 *
 * Done by hand rather than with `new URL()` for the refusal: `URL` happily parses
 * `javascript:alert(1)` and `data:text/html,…`, and the *point* here is to notice
 * that and say no.
 */
function splitScheme(
  input: string,
): { ok: true; rest: string } | { ok: false; reason: DomainRejection } {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(input)
  if (!match) return { ok: true, rest: input }
  if (!ALLOWED_SCHEMES.has(match[1].toLowerCase())) {
    return { ok: false, reason: 'scheme' }
  }
  return { ok: true, rest: input.slice(match[0].length) }
}

/**
 * Turn what the user typed into a bare domain.
 *
 * Accepts what a person actually pastes — `youtube.com`, `www.youtube.com`,
 * `https://youtube.com`, `https://www.youtube.com/watch?v=abc` — and reduces all
 * of them to the registrable host. `www.` is dropped because blocking a domain
 * covers its subdomains anyway (see `blockingRules`), so keeping it would be a
 * narrower rule than the user meant.
 */
export function normalizeDomain(input: string): DomainResult {
  const trimmed = input.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }

  const scheme = splitScheme(trimmed)
  if (!scheme.ok) return scheme

  // Everything after the authority is not part of the host: a path, a query, a
  // fragment. Credentials and a port are stripped for the same reason.
  let host = scheme.rest
    .replace(/^\/+/, '')
    .split(/[/?#]/, 1)[0]
    .split('@')
    .pop()
    ?.trim()
    .toLowerCase()

  if (host === undefined || host.length === 0) {
    return { ok: false, reason: 'empty' }
  }

  // Bracketed IPv6 literal. Rejected as "not a domain" rather than parsed.
  if (host.startsWith('[')) return { ok: false, reason: 'invalid' }

  host = host.split(':', 1)[0]
  // A trailing dot is the DNS root and legal, but not what we store.
  host = host.replace(/\.+$/, '')
  if (host.startsWith('www.')) host = host.slice('www.'.length)

  if (host.length === 0) return { ok: false, reason: 'empty' }
  if (host.length > MAX_NAME) return { ok: false, reason: 'too-long' }
  if (host.split('.').some((label) => label.length > MAX_LABEL)) {
    return { ok: false, reason: 'too-long' }
  }
  // Wildcards, underscores, spaces, and anything else non-hostname land here.
  if (!HOSTNAME.test(host)) return { ok: false, reason: 'invalid' }
  if (NUMERIC_TLD.test(host)) return { ok: false, reason: 'invalid' }

  return { ok: true, domain: host }
}

/** Whether a stored string is already a domain this module would produce. */
export function isNormalizedDomain(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const result = normalizeDomain(value)
  return result.ok && result.domain === value
}

/** A short reason to show beside the field. */
export function describeRejection(reason: DomainRejection): string {
  switch (reason) {
    case 'empty':
      return 'Enter a website address.'
    case 'scheme':
      return 'Only http and https websites can be blocked.'
    case 'too-long':
      return 'That address is too long to be a domain.'
    case 'invalid':
      return "That doesn't look like a website domain."
  }
}

/**
 * Normalise a list, keeping the first spelling of each domain and dropping
 * anything invalid. Used when repairing stored data, where a refusal has nobody
 * to report to — the alternative would be a blocklist that cannot be loaded.
 */
export function normalizeDomains(inputs: readonly unknown[]): string[] {
  const seen = new Set<string>()
  for (const input of inputs) {
    if (typeof input !== 'string') continue
    const result = normalizeDomain(input)
    if (result.ok) seen.add(result.domain)
  }
  return [...seen]
}
