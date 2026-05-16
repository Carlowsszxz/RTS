import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function NeoInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-14 w-full border-4 border-black bg-white px-4 text-lg font-bold text-black placeholder:text-black/40 transition duration-100 ease-linear focus-visible:bg-neo-secondary focus-visible:shadow-neo-sm focus-visible:outline-none focus-visible:ring-0',
        className,
      )}
      {...props}
    />
  )
}
