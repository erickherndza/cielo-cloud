'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { X, Search, LogOut, ShieldAlert, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { useRemoteStore } from '@/lib/remote-store'
import { salirDeEmpresa } from '@/lib/storage'
import { NAV_ITEMS, CONFIGURACION_ITEM } from '@/lib/nav-items'
import { useCommandPalette } from '@/lib/command-palette-context'

interface MobileMenuCtx {
  open: () => void
  close: () => void
}

const Ctx = createContext<MobileMenuCtx>({ open: () => {}, close: () => {} })
export const useMobileMenu = () => useContext(Ctx)

export function MobileMenuProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      <MobileMenu open={isOpen} onClose={close} />
    </Ctx.Provider>
  )
}

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()
  const { acceso } = useRemoteStore()
  const palette = useCommandPalette()

  // Cierra al navegar y bloquea el scroll del fondo mientras está abierto.
  useEffect(() => { onClose() }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  const items = [...NAV_ITEMS, CONFIGURACION_ITEM]
  const activeHref = items
    .map(i => i.href)
    .filter(h => h === '/' ? pathname === '/' : (pathname === h || pathname.startsWith(`${h}/`)))
    .sort((a, b) => b.length - a.length)[0]

  const fila = 'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[15px] text-zinc-700 dark:text-zinc-300 active:bg-zinc-100 dark:active:bg-[#1a1d2e]'

  async function handleLogout() {
    onClose()
    await logout()
    router.replace('/login')
  }

  return (
    <div className="md:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Menú de navegación">
      <div className="absolute inset-0 bg-black/40 animate-backdrop-in" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 flex w-[84%] max-w-sm flex-col bg-white dark:bg-[#141722] shadow-2xl animate-content-in">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 dark:border-[#252840] px-4 pt-[env(safe-area-inset-top)]">
          <span className="text-lg font-bold tracking-tight text-[#1B2980] dark:text-indigo-400">Cielo Cloud</span>
          <button onClick={onClose} aria-label="Cerrar menú"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-[#1a1d2e]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-3 pt-3">
          <button onClick={() => { onClose(); palette.open() }}
            className="flex w-full items-center gap-2 rounded-xl border border-zinc-200 dark:border-[#252840] bg-zinc-50 dark:bg-[#1a1d2e] px-3 py-3 text-sm text-zinc-400">
            <Search className="h-4 w-4" /> Buscar módulo o acción…
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {items.map(item => {
            const active = item.href === activeHref
            return (
              <Link key={item.href} href={item.href} prefetch={false}
                className={cn(fila, active && 'bg-[#eef0fb] dark:bg-indigo-950/40 font-semibold text-[#1B2980] dark:text-indigo-400')}>
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="min-w-0 flex-1">{item.label}</span>
              </Link>
            )
          })}
          {acceso?.activa && acceso.esSuperadmin && (
            <Link href="/admin" prefetch={false} className={cn(fila, pathname.startsWith('/admin') && 'bg-[#eef0fb] font-semibold text-[#1B2980]')}>
              <ShieldAlert className="h-5 w-5 shrink-0" /> Administración
            </Link>
          )}
          {acceso?.activa && (acceso.empresas.length > 1 || acceso.esSuperadmin) && (
            <button onClick={salirDeEmpresa} className={fila}>
              <Building2 className="h-5 w-5 shrink-0" /> Cambiar de empresa
            </button>
          )}
        </nav>

        <div className="shrink-0 border-t border-zinc-200 dark:border-[#252840] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1B2980] text-sm font-bold text-white">
              {user?.displayName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{user?.displayName ?? 'Mi cuenta'}</p>
              <p className="truncate text-xs text-zinc-400">{user?.email ?? ''}</p>
            </div>
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30">
              <LogOut className="h-4 w-4" /> Salir
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
