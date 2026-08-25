import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type SectionHeaderProps = {
  /** Short, uppercase-styled label: "NEXT", "TODAY", "QUICK ACTIONS". */
  title: string
  /** Right-aligned secondary text or control. */
  trailing?: ReactNode
  /**
   * 2 by default. Pass 1 where this label *is* the surface's title rather than
   * one section within it (Focus and Timer are laid out that way), so the page
   * still has exactly one h1 and its outline does not start at h2.
   */
  level?: 1 | 2
  className?: string
}

/**
 * The small all-caps label that opens a section. Uppercasing is done with CSS,
 * not in the string, so screen readers still receive normal-case text.
 */
export function SectionHeader({
  title,
  trailing,
  level = 2,
  className,
}: SectionHeaderProps) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <div className={cn('flex items-baseline justify-between gap-3', className)}>
      <Heading className="text-2xs font-semibold tracking-wider text-muted uppercase">
        {title}
      </Heading>
      {trailing ? (
        <div className="shrink-0 text-2xs text-muted">{trailing}</div>
      ) : null}
    </div>
  )
}
