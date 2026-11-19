import Link from 'next/link'
import { Tag } from 'lucide-react'

/** Botón "Planes" de las pantallas de acceso (antes de entrar al Dashboard). */
export function PlanesLink() {
  return (
    <Link
      href="/planes"
      className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-md border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] px-3 py-2 text-sm font-medium text-tabler-ink dark:text-zinc-200 shadow-[0_1px_2px_rgba(18,18,23,0.05)] hover:bg-black/[0.03] dark:hover:bg-[#262626] transition-colors"
    >
      <Tag className="h-4 w-4 text-[#1B2980] dark:text-indigo-400" />
      Planes
    </Link>
  )
}
