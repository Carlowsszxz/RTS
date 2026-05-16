import { Bell, CircleAlert, CircleCheck, Info } from 'lucide-react'
import type { InAppNotification } from '../../types'
import { cn } from '../../lib/cn'

interface NotificationCenterProps {
  notifications: InAppNotification[]
  onDismiss: (id: string) => void
}

const iconMap = {
  info: Info,
  success: CircleCheck,
  warning: CircleAlert,
} as const

const variantMap = {
  info: 'bg-neo-surface',
  success: 'bg-neo-secondary/35',
  warning: 'bg-neo-accent/25',
} as const

export function NotificationCenter({ notifications, onDismiss }: NotificationCenterProps) {
  return (
    <aside aria-live='polite' className='fixed right-3 top-20 z-30 flex w-[min(92vw,24rem)] flex-col gap-3'>
      {notifications.map((notification) => {
        const Icon = iconMap[notification.variant]

        return (
          <div
            key={notification.id}
            className={cn(
              'flex items-start gap-3 border-4 border-neo-ink p-3 text-neo-ink shadow-neo-sm transition duration-200 ease-linear',
              variantMap[notification.variant],
            )}
          >
            <Bell className='mt-0.5 h-5 w-5 stroke-[3px]' />
            <div className='flex-1'>
              <p className='text-sm font-black uppercase tracking-wide'>{notification.message}</p>
            </div>
            <button
              type='button'
              onClick={() => onDismiss(notification.id)}
              className='inline-flex h-8 w-8 items-center justify-center border-2 border-neo-ink bg-neo-surface font-black'
              aria-label='Dismiss notification'
            >
              <Icon className='h-4 w-4 stroke-[3px]' />
            </button>
          </div>
        )
      })}
    </aside>
  )
}
