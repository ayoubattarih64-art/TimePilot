/**
 * Minimal class-name joiner. Falsy entries are dropped so conditional classes
 * can be written inline without a `clsx` dependency.
 *
 * Note: this concatenates, it does not resolve Tailwind conflicts. Components
 * therefore place the caller's `className` last, letting later utilities win
 * on equal specificity.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
