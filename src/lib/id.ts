/**
 * Stable id generation. `crypto.randomUUID` is available in extension pages and
 * in the service worker, both of which are secure contexts.
 */
export function createId(): string {
  return crypto.randomUUID()
}
