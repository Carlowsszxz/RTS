import type { WorkstationStatus } from '../../types'
import { cn } from '../../lib/cn'

const statusMap: Record<WorkstationStatus, { label: string; className: string }> = {
  closed: { label: 'Closed', className: 'bg-neo-muted' },
  booting: { label: 'Booting', className: 'bg-neo-secondary animate-pulse motion-reduce:animate-none' },
  ready: { label: 'Ready', className: 'bg-neo-accent' },
}

export function StatusBadge({ status }: { status: WorkstationStatus }) {
  const config = statusMap[status]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border-4 border-black px-4 py-1 text-sm font-black uppercase tracking-[0.2em] shadow-neo-sm',
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}
