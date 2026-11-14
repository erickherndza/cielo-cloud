import { cn } from '@/lib/utils'

/** Crédito de desarrollo, visible en la app y en las pantallas de acceso. */
export function DevCredit({ className }: { className?: string }) {
  return (
    <p className={cn('text-[10px] text-zinc-400 dark:text-zinc-500', className)}>
      Development:{' '}
      <a
        href="https://www.erickhernandezarias.net"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-zinc-500 hover:text-[#1B2980] hover:underline dark:text-zinc-400 dark:hover:text-indigo-400 transition-colors"
      >
        Erick Hernandez Arias
      </a>
    </p>
  )
}
