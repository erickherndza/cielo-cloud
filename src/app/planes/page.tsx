'use client'

import Link from 'next/link'
import { Check, Star } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { PLANES, INCLUYE } from '@/lib/planes'
import { cn } from '@/lib/utils'

function Marca() {
  return (
    <Link href="/login" className="flex items-center gap-3" aria-label="Cielo Cloud Nómina">
      <svg viewBox="0 0 32 32" fill="none" className="h-9 w-9 shrink-0">
        <circle cx="16" cy="16" r="9" strokeWidth="5.5" strokeDasharray="47.12 9.43" strokeLinecap="round"
          transform="rotate(30 16 16)" className="stroke-[#1B2980] dark:stroke-white" />
        <circle cx="16" cy="16" r="2.8" className="fill-[#1B2980] dark:fill-white" />
      </svg>
      <span className="flex items-baseline gap-1.5">
        <span className="text-lg font-bold text-tabler-ink dark:text-white">Cielo</span>
        <span className="text-lg font-extralight text-tabler-mute dark:text-zinc-300">Cloud</span>
      </span>
    </Link>
  )
}

export default function PlanesPage() {
  const { user } = useAuth()

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
        </div>

        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3 md:items-stretch">
          {PLANES.map(plan => (
            <div
              key={plan.id}
              className={cn(
                't-card flex flex-col p-6',
                plan.popular && 'border-2 border-[#1B2980] dark:border-indigo-500 shadow-lg shadow-[#1B2980]/10 md:-my-2',
              )}
            >
              <p className="t-subheader">{plan.rango}</p>

              <p className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tabular-nums text-tabler-ink dark:text-zinc-100">${plan.precio}</span>
                <span className="text-sm text-tabler-mute dark:text-zinc-400">/mes</span>
              </p>
              <p className="mt-1 min-h-[2.25rem] text-xs text-tabler-mute dark:text-zinc-400">
                {plan.extra ?? 'Precio fijo'}
              </p>

              <div className={cn('mt-3', plan.popular ? 'h-7' : 'hidden h-7 md:block')}>
                {plan.popular && (
                  <p className="inline-flex w-fit items-center gap-1.5 rounded-md bg-[#1B2980]/[0.07] dark:bg-indigo-950/40 px-2.5 py-1 text-xs font-semibold text-[#1B2980] dark:text-indigo-300">
                    <Star className="h-3.5 w-3.5 fill-current" />
                    Plan popular
                  </p>
                )}
              </div>

              <ul className="mt-5 flex-1 space-y-2.5 border-t border-tabler-line dark:border-[#2e2e2e] pt-5">
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
                    ? 'bg-[#1B2980] text-white hover:bg-[#151f66]'
                    : 'border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] text-tabler-ink dark:text-zinc-200 hover:bg-black/[0.03] dark:hover:bg-[#262626]',
                )}
              >
                {user ? 'Contactar' : 'Empezar'}
              </Link>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
