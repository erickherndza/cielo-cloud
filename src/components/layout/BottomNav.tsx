'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Calculator,
  FileBarChart2,
  Menu,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMobileMenu } from './MobileMenu'

const BOTTOM_ITEMS = [
  { href: '/',          icon: LayoutDashboard, label: 'Inicio' },
  { href: '/empleados', icon: Users,            label: 'Empleados' },
  { href: '/nomina',    icon: Calculator,       label: 'Nómina' },
  { href: '/reportes',  icon: FileBarChart2,    label: 'Reportería' },
]

export function BottomNav() {
  const pathname = usePathname()
  const { open } = useMobileMenu()

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex h-16 items-center border-t pb-[env(safe-area-inset-bottom)] box-content border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] px-1">
      {BOTTOM_ITEMS.map((item) => {
        const active = isActive(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors',
              active
                ? 'text-[#1B2980] dark:text-indigo-400'
                : 'text-zinc-400 dark:text-zinc-600'
            )}
          >
            <item.icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        )
      })}
      <button
        onClick={open}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-zinc-400 dark:text-zinc-600"
      >
        <Menu className="h-5 w-5" />
        <span className="text-[10px] font-medium">Más</span>
      </button>
    </nav>
  )
}
