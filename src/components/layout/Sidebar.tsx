'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  LogOut,
  Check,
  Plus,
  X,
  ShieldAlert,
  Building2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth, type CuentaVinculada } from '@/lib/auth-context'
import { AgregarCuentaModal } from '@/components/auth/AgregarCuentaModal'
import { NAV_ITEMS, CONFIGURACION_ITEM } from '@/lib/nav-items'
import { DevCredit } from '@/components/ui/DevCredit'
import { useRemoteStore } from '@/lib/remote-store'
import { salirDeEmpresa } from '@/lib/storage'

// Accesos de multiempresa: panel del super admin y cambio de empresa para
// quien trabaja con más de una (contadores).
function EmpresaLinks({ wide }: { wide: boolean }) {
  const { acceso } = useRemoteStore()
  const pathname = usePathname()
  if (!acceso?.activa) return null
  const fila = 'flex items-center py-2 mx-2 rounded-md text-sm text-tabler-ink/80 dark:text-zinc-400 hover:bg-black/[0.04] dark:hover:bg-[#262626] '
  return (
    <>
      {acceso.esSuperadmin && (
        <Link href="/admin" prefetch={false} title={wide ? undefined : 'Administración'}
          className={cn(fila, wide ? 'gap-3 px-3' : 'justify-center', pathname.startsWith('/admin') && 'bg-[#1B2980]/[0.07] dark:bg-indigo-950/40 text-[#1B2980] dark:text-indigo-400 font-medium')}>
          <ShieldAlert strokeWidth={1.75} className="h-5 w-5 shrink-0 text-tabler-mute" />
          {wide && <span className="min-w-0 flex-1 truncate">Administración</span>}
        </Link>
      )}
      {(acceso.empresas.length > 1 || acceso.esSuperadmin) && (
        <button onClick={salirDeEmpresa} title={wide ? undefined : 'Cambiar de empresa'}
          className={cn(fila, wide ? 'gap-3 px-3 text-left w-[calc(100%-1rem)]' : 'justify-center w-[calc(100%-1rem)]')}>
          <Building2 strokeWidth={1.75} className="h-5 w-5 shrink-0 text-tabler-mute" />
          {wide && <span className="min-w-0 flex-1 truncate">Cambiar de empresa</span>}
        </button>
      )}
    </>
  )
}

// Lee el nombre de empresa guardado para OTRA cuenta vinculada, directo de
// localStorage — sin pasar por React ni "cambiar" de cuenta de verdad, solo
// para poder mostrar algo mejor que el correo en la lista del selector.
function nombreEmpresaDe(uid: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`cielo-empresa::${uid}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { nombre?: string }
    return parsed.nombre || null
  } catch {
    return null
  }
}

function CuentaSwitcher({ collapsed }: { collapsed: boolean }) {
  const { user, cuentasVinculadas, cuentaActivaAppName, cambiarCuenta, quitarCuenta } = useAuth()
  const [open, setOpen] = useState(false)
  const [mostrarModal, setMostrarModal] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // La cuenta activa puede no estar todavía en `cuentasVinculadas` (caso de
  // siempre — una sola cuenta, nunca se usó "agregar empresa") — se arma una
  // fila para ella igual, usando `user` directo.
  const activaComoFila: CuentaVinculada | null = user
    ? { appName: cuentaActivaAppName, uid: user.uid, email: user.email, displayName: user.displayName, photoURL: user.photoURL }
    : null
  const filas: CuentaVinculada[] = cuentasVinculadas.some(c => c.appName === cuentaActivaAppName)
    ? cuentasVinculadas
    : activaComoFila ? [activaComoFila, ...cuentasVinculadas] : cuentasVinculadas

  const activa = filas.find(c => c.appName === cuentaActivaAppName) ?? null
  const nombreActivo = (activa && nombreEmpresaDe(activa.uid)) || activa?.displayName || activa?.email || 'Mi cuenta'

  return (
    <div ref={ref} className="relative border-b border-tabler-line dark:border-[#2e2e2e] p-2">
      <button
        onClick={() => setOpen(v => !v)}
        title={collapsed ? nombreActivo : undefined}
        className={cn(
          'flex w-full items-center rounded-lg py-2 transition-all duration-200 ease-in-out hover:bg-zinc-50 dark:hover:bg-[#262626]',
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-2',
        )}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#eef0fb] dark:bg-indigo-950/40 text-[10px] font-bold text-[#1B2980] dark:text-indigo-400">
          {activa?.photoURL ? <img src={activa.photoURL} alt="" className="h-full w-full object-cover" /> : nombreActivo[0]?.toUpperCase()}
        </div>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">{nombreActivo}</p>
              <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                {filas.length > 1 ? `${filas.length} empresas` : 'Cambiar de empresa'}
              </p>
            </div>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" />
          </>
        )}
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-50 top-full mt-1 w-72 overflow-hidden rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] shadow-lg shadow-zinc-200/60 dark:shadow-none',
            collapsed ? 'left-full ml-2' : 'left-2',
          )}
        >
          <div className="max-h-64 overflow-y-auto py-1">
            {filas.map(c => {
              const nombreFila = nombreEmpresaDe(c.uid) || c.displayName || c.email || 'Sin nombre'
              return (
                <div key={c.appName} className="group flex items-center gap-1 px-2">
                  <button
                    onClick={() => { cambiarCuenta(c.appName); setOpen(false) }}
                    className="flex flex-1 min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-2 text-left hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100 dark:bg-[#262626] text-[9px] font-bold text-zinc-500 dark:text-zinc-400">
                      {c.photoURL ? <img src={c.photoURL} alt="" className="h-full w-full object-cover" /> : nombreFila[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-zinc-700 dark:text-zinc-300">{nombreFila}</p>
                      {c.email && <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">{c.email}</p>}
                    </div>
                    {c.appName === cuentaActivaAppName && <Check className="h-3.5 w-3.5 shrink-0 text-[#1B2980] dark:text-indigo-400" />}
                  </button>
                  {filas.length > 1 && (
                    <button
                      onClick={() => quitarCuenta(c.appName)}
                      title="Quitar de este dispositivo"
                      className="shrink-0 rounded-lg p-1.5 text-zinc-300 opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-500 dark:text-zinc-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-400 transition-all"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <div className="border-t border-zinc-100 dark:border-[#2a2a2a] p-1">
            <button
              onClick={() => { setMostrarModal(true); setOpen(false) }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#1B2980] dark:text-indigo-400 hover:bg-[#eef0fb] dark:hover:bg-indigo-950/30 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar empresa
            </button>
          </div>
        </div>
      )}

      {mostrarModal && <AgregarCuentaModal onClose={() => setMostrarModal(false)} />}
    </div>
  )
}

export function Sidebar() {
  const pathname  = usePathname()
  const router    = useRouter()
  const { user, logout } = useAuth()

  const [collapsed, setCollapsed] = useState(false)
  const [mounted,   setMounted]   = useState(false)
  const [hovering,  setHovering]  = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function handleLogout() {
    await logout()
    router.replace('/login')
  }

  useEffect(() => {
    setMounted(true)
    if (localStorage.getItem('cielo-sidebar') === '1') setCollapsed(true)
  }, [])

  useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
  }, [])

  const toggle = () =>
    setCollapsed(v => {
      localStorage.setItem('cielo-sidebar', v ? '0' : '1')
      return !v
    })

  // El ítem activo es el href MÁS ESPECÍFICO (más largo) que hace match con
  // la ruta actual — sin esto, "/nomina" (Cálculo de Nómina) quedaba activo
  // también al estar en "/nomina/envios" (Gestión de Envíos), ya que ambos
  // comparten el mismo prefijo de ruta.
  const activeHref = [...NAV_ITEMS, CONFIGURACION_ITEM]
    .map(item => item.href)
    .filter(href => href === '/' ? pathname === '/' : (pathname === href || pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0]
  const isActive = (href: string) => href === activeHref

  // Avoid hydration flash — render expanded until client mounts
  const c = mounted && collapsed

  // Mientras está colapsado, posicionar el mouse sobre el riel lo expande
  // temporalmente como un flyout flotante (no empuja el contenido de la
  // página) — al sacar el mouse vuelve a colapsarse, con un pequeño margen
  // para evitar parpadeo si el cursor sale y entra de nuevo muy rápido.
  const flyout = c && hovering
  // `wide` sigue a `flyout` de inmediato — se probó retrasarlo (para que el
  // cambio de layout, que usa `justify-content`/`flex-direction` y por eso
  // no se puede animar con CSS, ocurriera con el riel ya ensanchado) pero
  // eso empeoraba el salto: cuanto más ancho está el riel cuando el ícono
  // pasa de "centrado" a "alineado a la izquierda", MÁS lejos tiene que
  // saltar (el centrado se aleja del borde a medida que crece el
  // contenedor). Es preferible que el cambio de layout ocurra apenas
  // empieza a crecer el riel (salto pequeño, casi imperceptible) en vez de
  // tarde (salto grande). Lo que sí ayuda de verdad es que padding/gap/
  // tamaño de ícono tengan su propia transición CSS (ver className de cada
  // elemento) — eso es animable y sí se anima suave junto con el ancho.
  const wide = !c || flyout

  function handleMouseEnter() {
    if (!c) return
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null }
    setHovering(true)
  }
  function handleMouseLeave() {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => setHovering(false), 150)
  }

  return (
    <>
      {/* Espaciador — conserva el ancho colapsado en el layout mientras el
          riel real "flota" encima como flyout, para que el contenido de la
          página no se desplace al pasar el mouse. Se mantiene montado todo
          el tiempo que está colapsado (no solo durante el flyout) para que
          el riel real pueda quedarse siempre `fixed` — cambiar `position`
          a la vez que el ancho es lo que rompía la transición (saltaba en
          vez de animarse suavemente al entrar/salir con el mouse). */}
      {c && <div className="hidden md:block h-screen w-[68px] shrink-0" />}

      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(
          'hidden md:flex h-screen flex-col bg-white dark:bg-[#1f1f1f]',
          'border-r border-tabler-line dark:border-[#2e2e2e]',
          'transition-[width] duration-200 ease-in-out overflow-hidden',
          c ? 'fixed left-0 top-0 z-40' : 'relative shrink-0',
          c ? (flyout ? 'w-64' : 'w-[68px]') : 'w-64',
          // La sombra vive con `c` (no con `flyout`) — el riel ya está
          // `fixed`/flotando sobre el contenido en AMBOS estados mientras
          // está colapsado, así que tenerla solo durante el flyout hacía
          // que apareciera de golpe (box-shadow sin transición) justo al
          // empezar el hover. Con `c` está presente desde el reposo, sin
          // aparición súbita.
          c && 'shadow-2xl shadow-zinc-900/10 dark:shadow-black/50',
        )}
      >
        {/* ── Logo / Brand ─────────────────────────────────────────── */}
        <div
          className={cn(
            'flex h-[80px] shrink-0 items-center border-b border-tabler-line dark:border-[#2e2e2e]',
            'transition-[padding,gap] duration-200 ease-in-out',
            wide ? 'px-5 gap-4' : 'flex-col justify-center gap-2.5 px-0',
          )}
        >
          {/* Logo de Cielo Cloud Nómina: completo al expandir, solo isotipo al colapsar */}
          {wide ? (
            <div className="flex min-w-0 flex-1 items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/cielo-erp-logo.png`}
                alt="Cielo Cloud Nómina"
                className="h-11 w-auto max-w-full object-contain dark:rounded-lg dark:bg-white dark:px-2 dark:py-1"
              />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/cielo-erp-isotipo.png`}
              alt="Cielo Cloud"
              className="h-[40px] w-[40px] shrink-0 object-contain"
            />
          )}

          {/* Toggle — colapsa/expande de forma persistente (independiente del flyout) */}
          <button
            onClick={toggle}
            title={c ? 'Expandir' : 'Colapsar'}
            className={cn(
              'flex items-center justify-center rounded-lg transition-all duration-200 ease-in-out shrink-0',
              'text-zinc-300 hover:text-[#1B2980] hover:bg-[#eef0fb]',
              'dark:text-zinc-600 dark:hover:text-indigo-400 dark:hover:bg-indigo-950/30',
              wide ? 'h-6 w-6' : 'h-5 w-5',
            )}
          >
            {c
              ? <ChevronRight className="h-3.5 w-3.5" />
              : <ChevronLeft  className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* ── Selector de empresa/cuenta ───────────────────────────── */}
        <CuentaSwitcher collapsed={!wide} />

        {/* ── Navigation ───────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto py-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                title={wide ? undefined : item.label}
                className={cn(
                  'flex items-center py-2 text-sm transition-all duration-200 ease-in-out rounded-md',
                  wide ? 'gap-3 px-3 mx-2' : 'justify-center px-0 mx-2',
                  active
                    ? 'bg-[#1B2980]/[0.07] dark:bg-indigo-950/40 text-[#1B2980] dark:text-indigo-400 font-medium'
                    : 'text-tabler-ink/80 dark:text-zinc-400 hover:bg-black/[0.04] dark:hover:bg-[#262626] hover:text-tabler-ink dark:hover:text-zinc-100',
                )}
              >
                <item.icon
                  strokeWidth={1.75}
                  className={cn(
                    'h-5 w-5 shrink-0',
                    active
                      ? 'text-[#1B2980] dark:text-indigo-400'
                      : 'text-tabler-mute dark:text-zinc-500',
                  )}
                />
                {wide && (
                  <>
                    <span className="min-w-0 flex-1 truncate leading-none">{item.label}</span>
                  </>
                )}
              </Link>
            )
          })}
        </nav>

        {/* ── Footer ───────────────────────────────────────────────── */}
        <div className="border-t border-tabler-line dark:border-[#2e2e2e] py-1">
          <EmpresaLinks wide={wide} />
          <Link
            href={CONFIGURACION_ITEM.href}
            prefetch={false}
            title={wide ? undefined : CONFIGURACION_ITEM.label}
            className={cn(
              'flex items-center py-2 text-sm transition-all duration-200 ease-in-out rounded-md',
              wide ? 'gap-3 px-3 mx-2' : 'justify-center px-0 mx-2',
              isActive(CONFIGURACION_ITEM.href)
                ? 'bg-[#1B2980]/[0.07] dark:bg-indigo-950/40 text-[#1B2980] dark:text-indigo-400 font-medium'
                : 'text-tabler-ink/80 dark:text-zinc-400 hover:bg-black/[0.04] dark:hover:bg-[#262626] hover:text-tabler-ink dark:hover:text-zinc-100',
            )}
          >
            <CONFIGURACION_ITEM.icon
              strokeWidth={1.75}
              className={cn(
                'h-5 w-5 shrink-0',
                isActive(CONFIGURACION_ITEM.href)
                  ? 'text-[#1B2980] dark:text-indigo-400'
                  : 'text-tabler-mute dark:text-zinc-500',
              )}
            />
            {wide && (
              <>
                <span className="min-w-0 flex-1 truncate">Configuración</span>
              </>
            )}
          </Link>

          {/* User profile + logout */}
          <div
            className={cn(
              'flex items-center py-2.5 transition-[padding,gap] duration-200 ease-in-out',
              wide ? 'gap-2.5 px-4' : 'flex-col gap-1.5 px-0',
            )}
          >
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: '#1B2980' }}
            >
              {user?.displayName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? 'U'}
            </div>
            {wide && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {user?.displayName ?? 'Mi cuenta'}
                </p>
                <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                  {user?.email ?? ''}
                </p>
              </div>
            )}
            {wide ? (
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-zinc-400 dark:text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Salir</span>
              </button>
            ) : (
              <button
                onClick={handleLogout}
                title="Cerrar sesión"
                className="shrink-0 flex h-6 w-6 items-center justify-center rounded-lg text-zinc-300 hover:text-rose-500 hover:bg-rose-50 dark:text-zinc-600 dark:hover:text-rose-400 dark:hover:bg-rose-950/30 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {wide && <DevCredit className="px-4 pb-2.5 -mt-1" />}
        </div>
      </aside>
    </>
  )
}
