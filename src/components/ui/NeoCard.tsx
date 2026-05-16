import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface NeoCardProps {
  title?: string
  accent?: 'muted' | 'secondary' | 'accent' | 'white'
  children: ReactNode
  className?: string
}

const accentClasses: Record<NonNullable<NeoCardProps['accent']>, string> = {
  muted: 'bg-neo-muted/35',
  secondary: 'bg-neo-secondary/55',
  accent: 'bg-neo-accent/25',
  white: 'bg-neo-canvas/70',
}

export function NeoCard({ title, accent = 'white', children, className }: NeoCardProps) {
  return (
    <article
      className={cn(
        'border-4 border-neo-ink bg-neo-surface text-neo-ink shadow-neo-md transition duration-200 ease-out hover:-translate-y-1 hover:shadow-neo-lg',
        className,
      )}
    >
      {title ? (
        <header
          className={cn(
            'border-b-2 border-neo-ink/60 px-4 py-2 text-[0.7rem] font-black uppercase tracking-[0.28em] sm:text-xs',
            accentClasses[accent],
          )}
        >
          {title}
        </header>
      ) : null}
      <div className='p-4 sm:p-6'>{children}</div>
    </article>
  )
}
