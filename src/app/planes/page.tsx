'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Check, Star, Gift, Mail, Copy, X, ExternalLink } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  PLANES, INCLUYE, EMAIL_VENTAS, DIAS_GRATIS, DESCUENTO_ANUAL,
  mailtoCotizar, gmailCotizar, outlookCotizar,
  precioMensual, totalAnual, ahorroAnual, fmtUsd,
} from '@/lib/planes'
import { cn } from '@/lib/utils'
import { CieloLogo } from '@/components/ui/CieloLogo'

function Marca() {
  return (
    <Link href="/login" className="flex items-center gap-3" aria-label="Cielo Cloud Nómina">
      <CieloLogo className="h-10" />
    </Link>
  )
}

export default function PlanesPage() {
  const { user } = useAuth()
  const [anual, setAnual] = useState(false)
  const [cotizarAbierto, setCotizarAbierto] = useState(false)
  const [copiado, setCopiado] = useState(false)

  async function copiarCorreo() {
    try {
      await navigator.clipboard.writeText(EMAIL_VENTAS)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch { /* el navegador bloqueó el portapapeles */ }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-tabler-bg dark:bg-[#171717]">
      <header className="flex items-center justify-between border-b border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] px-4 py-3 md:px-8">
        <Marca />
        <div className="flex items-center gap-2">
          {user ? (
            <Link href="/" className="rounded-md bg-[#1B2980] px-3 py-2 text-sm font-medium text-white hover:bg-[#151f66] transition-colors">
              Ir al Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded-md border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] px-3 py-2 text-sm font-medium text-tabler-ink dark:text-zinc-200 hover:bg-black/[0.03] transition-colors whitespace-nowrap">
                <span className="sm:hidden">Entrar</span><span className="hidden sm:inline">Iniciar sesión</span>
              </Link>
              <Link href="/registro" className="whitespace-nowrap rounded-md bg-[#1B2980] px-3 py-2 text-sm font-medium text-white hover:bg-[#151f66] transition-colors">
                Crear cuenta
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 md:px-8 md:py-14">
        <div className="text-center">
          <p className="t-pretitle">Planes</p>
          <h1 className="mt-1 text-3xl font-semibold text-tabler-ink dark:text-zinc-100">Planes y precios</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-tabler-mute dark:text-zinc-400">
            Elige el plan según el número de empleados de tu empresa.
          </p>
          <p className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <Gift className="h-4 w-4" />
            {DIAS_GRATIS} días gratis en todos los planes
          </p>

          <div className="mt-6 flex justify-center">
            <div className="inline-flex rounded-md border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-0.5">
              <button type="button" onClick={() => setAnual(false)}
                className={cn('rounded px-4 py-1.5 text-sm font-medium transition-colors', !anual ? 'bg-[#1B2980] text-white' : 'text-tabler-mute dark:text-zinc-400 hover:text-tabler-ink')}>
                Mensual
              </button>
              <button type="button" onClick={() => setAnual(true)}
                className={cn('flex items-center gap-1.5 rounded px-4 py-1.5 text-sm font-medium transition-colors', anual ? 'bg-[#1B2980] text-white' : 'text-tabler-mute dark:text-zinc-400 hover:text-tabler-ink')}>
                Anual
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', anual ? 'bg-amber-400 text-[#1B2980]' : 'bg-emerald-100 text-emerald-700')}>
                  -{Math.round(DESCUENTO_ANUAL * 100)}%
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3 md:items-stretch">
          {PLANES.filter(p => !p.cotizar).map(plan => (
            <div
              key={plan.id}
              className={cn(
                't-card relative flex flex-col overflow-hidden p-6',
                plan.popular && 'border-2 border-amber-400 dark:border-amber-400/80 shadow-xl shadow-amber-400/25 md:-my-3',
              )}
            >
              {plan.popular && (
                <>
                  {/* línea superior dorada */}
                  <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-amber-300 via-yellow-500 to-amber-300" />
                  {/* brillo dorado de fondo */}
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(251,191,36,0.16),transparent_55%)]" />
                  {/* estrellas decorativas */}
                  <Star className="pointer-events-none absolute right-4 top-6 h-5 w-5 fill-amber-400 text-amber-500" />
                  <Star className="pointer-events-none absolute right-11 top-4 h-3 w-3 fill-amber-300 text-amber-400" />
                  <Star className="pointer-events-none absolute right-3 top-14 h-2.5 w-2.5 fill-amber-300 text-amber-400" />
                </>
              )}
              <p className="t-subheader relative">{plan.rango}</p>

              <p className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tabular-nums text-tabler-ink dark:text-zinc-100">{fmtUsd(precioMensual(plan.precio ?? 0, anual))}</span>
                <span className="text-sm text-tabler-mute dark:text-zinc-400">/mes</span>
              </p>
              <p className="mt-1 text-xs text-tabler-mute dark:text-zinc-400">
                {anual
                  ? `Facturado ${fmtUsd(totalAnual(plan.precio ?? 0))} al año · ahorras ${fmtUsd(ahorroAnual(plan.precio ?? 0))}`
                  : 'Precio fijo'}
              </p>

              <div className={cn('mt-3', plan.popular ? 'h-7' : 'hidden h-7 md:block')}>
                {plan.popular && (
                  <p className="relative inline-flex w-fit items-center gap-1.5 rounded-md border border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/40 dark:to-yellow-950/30 dark:border-amber-500/40 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
                    <span className="flex">
                      {[0, 1, 2, 3, 4].map(i => (
                        <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-500" />
                      ))}
                    </span>
                    Plan popular
                  </p>
                )}
              </div>

              <ul className={cn('relative mt-5 flex-1 space-y-2.5 border-t pt-5', plan.popular ? 'border-amber-300 dark:border-amber-500/40' : 'border-tabler-line dark:border-[#2e2e2e]')}>
                {INCLUYE.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-tabler-ink/80 dark:text-zinc-300">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-tabler-green" />
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href={user ? '/configuracion' : '/registro'}
                className={cn(
                  'mt-6 rounded-md px-4 py-2.5 text-center text-sm font-medium transition-colors',
                  plan.popular
                    ? 'relative bg-[#1B2980] text-white ring-2 ring-amber-400 ring-offset-2 ring-offset-white dark:ring-offset-[#1f1f1f] hover:bg-[#151f66]'
                    : 'border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] text-tabler-ink dark:text-zinc-200 hover:bg-black/[0.03] dark:hover:bg-[#262626]',
                )}
              >
                {user ? 'Contactar' : `Probar ${DIAS_GRATIS} días gratis`}
              </Link>
            </div>
          ))}
        </div>

        {/* Informaciones fuera de los 3 planes */}
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="t-card p-6">
            <p className="t-subheader">Más de 50 y hasta 100 empleados</p>
            <p className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-semibold tabular-nums text-tabler-ink dark:text-zinc-100">$2.50</span>
              <span className="text-sm text-tabler-mute dark:text-zinc-400">por empleado adicional / mes</span>
            </p>
            <p className="mt-2 text-sm text-tabler-mute dark:text-zinc-400">
              Las empresas con más de 50 empleados, hasta 100, pagan un fee de 2.50 dólares por cada empleado adicional.
            </p>
          </div>

          <div className="t-card flex flex-col items-start justify-between gap-4 p-6">
            <div>
              <p className="t-subheader">Más de 100 empleados</p>
              <p className="mt-2 text-xl font-semibold text-tabler-ink dark:text-zinc-100">Comunícate para cotizar</p>
              <p className="mt-2 text-sm text-tabler-mute dark:text-zinc-400">
                Te preparamos una propuesta a la medida de tu empresa.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCotizarAbierto(true)}
              className="rounded-md bg-[#1B2980] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#151f66] transition-colors"
            >
              Cotizar
            </button>
          </div>
        </div>
      </main>

      {cotizarAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdrop-in" onClick={() => setCotizarAbierto(false)}>
          <div className="t-card w-full max-w-md animate-modal-in p-6" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Cotizar">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="t-card-title">Cotizar para más de 100 empleados</p>
                <p className="mt-1 text-sm text-tabler-mute dark:text-zinc-400">
                  Envíanos un correo con el nombre de tu empresa, cuántos empleados tiene y un contacto. Te respondemos con una propuesta.
                </p>
              </div>
              <button type="button" onClick={() => setCotizarAbierto(false)} aria-label="Cerrar" className="rounded-md p-1 text-tabler-mute hover:bg-black/[0.05] dark:hover:bg-[#262626]">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-4 rounded-md border border-tabler-line dark:border-[#2e2e2e] bg-tabler-bg dark:bg-[#171717] px-3 py-2 text-sm font-medium text-tabler-ink dark:text-zinc-100">
              {EMAIL_VENTAS}
            </p>

            <div className="mt-4 grid gap-2">
              <a href={mailtoCotizar()} className="flex items-center justify-between rounded-md bg-[#1B2980] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#151f66] transition-colors">
                <span className="flex items-center gap-2"><Mail className="h-4 w-4" />Abrir mi app de correo</span>
              </a>
              <a href={gmailCotizar()} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-md border border-tabler-line dark:border-[#2e2e2e] px-4 py-2.5 text-sm font-medium text-tabler-ink dark:text-zinc-200 hover:bg-black/[0.03] dark:hover:bg-[#262626] transition-colors">
                Escribir con Gmail <ExternalLink className="h-4 w-4 text-tabler-mute" />
              </a>
              <a href={outlookCotizar()} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-md border border-tabler-line dark:border-[#2e2e2e] px-4 py-2.5 text-sm font-medium text-tabler-ink dark:text-zinc-200 hover:bg-black/[0.03] dark:hover:bg-[#262626] transition-colors">
                Escribir con Outlook <ExternalLink className="h-4 w-4 text-tabler-mute" />
              </a>
              <button type="button" onClick={copiarCorreo} className="flex items-center justify-between rounded-md border border-tabler-line dark:border-[#2e2e2e] px-4 py-2.5 text-sm font-medium text-tabler-ink dark:text-zinc-200 hover:bg-black/[0.03] dark:hover:bg-[#262626] transition-colors">
                {copiado ? 'Correo copiado' : 'Copiar el correo'} <Copy className="h-4 w-4 text-tabler-mute" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
