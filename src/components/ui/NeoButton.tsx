import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost'

interface NeoButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  icon?: ReactNode
  fullWidth?: boolean
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-neo-accent text-neo-ink border-4 border-neo-ink shadow-neo-sm hover:brightness-95',
  secondary: 'bg-neo-secondary text-neo-ink border-4 border-neo-ink shadow-neo-sm hover:brightness-95',
  outline: 'bg-neo-surface text-neo-ink border-4 border-neo-ink shadow-neo-sm hover:bg-neo-canvas/80',
  ghost: 'bg-transparent text-neo-ink border-2 border-transparent hover:border-neo-ink hover:bg-neo-accent/20',
}

export function NeoButton({
  className,
  children,
  variant = 'primary',
  icon,
  fullWidth,
  ...props
}: NeoButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex h-12 items-center justify-center gap-2 px-5 font-bold uppercase tracking-wide transition duration-100 ease-linear active:translate-x-[2px] active:translate-y-[2px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neo-ink focus-visible:ring-offset-2 focus-visible:ring-offset-neo-canvas',
        fullWidth && 'w-full',
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}
