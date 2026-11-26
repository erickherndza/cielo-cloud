'use client'

import { CheckCircle2, ShieldCheck } from 'lucide-react'
import { CieloLogo } from '@/components/ui/CieloLogo'

const NOISE_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <CieloLogo variant="dark" className="h-14" />
  )
}

/** Mini vista previa flotante de un comprobante de nómina — muestra el
 *  producto real en vez de una cifra de "clientes" inventada (la app aún
 *  no tiene usuarios reales que reportar). */
function ComprobanteFloatCard() {
  return (
    <div className="animate-float-slow rounded-2xl border border-white/15 bg-white/[0.07] p-4 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/20">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
          </div>
          <span className="text-[11px] font-semibold text-white/70">Nómina de julio</span>
        </div>
        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-300">
          Procesada
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums text-white">RD$ 284,750.00</p>
      <p className="mt-0.5 text-[11px] text-white/40">24 empleados · TSS e ISR incluidos</p>
      <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-[62%] bg-white/30" />
        <div className="h-full w-[16%] bg-white/50" />
        <div className="h-full w-[22%] bg-emerald-400/70" />
      </div>
    </div>
  )
}

function CumplimientoFloatCard() {
  return (
    <div className="animate-float-slower ml-auto w-fit rounded-full border border-white/15 bg-white/[0.07] px-4 py-2.5 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5 text-white/70 shrink-0" />
        <span className="text-[11px] font-medium text-white/70">TSS, ISR y Ley 16-92 al día</span>
      </div>
    </div>
  )
}

interface AuthBrandPanelProps {
  eyebrow: string
  title: string
  description: string
  features: string[]
}

export function AuthBrandPanel({ eyebrow, title, description, features }: AuthBrandPanelProps) {
  return (
    <div className="hidden lg:flex w-[460px] shrink-0 flex-col relative overflow-hidden bg-[#0d1449]">
      {/* Fotografía real (Unsplash License — libre de uso comercial, sin atribución requerida) */}
      <div
        className="animate-ken-burns absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url('${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/images/auth/glass-facade.jpg')` }}
      />
      {/* Velos de marca para legibilidad y coherencia de color */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0d1449]/95 via-[#151f66]/78 to-[#0d1449]/96" />
      <div className="absolute inset-0 bg-gradient-to-tr from-[#1B2980]/50 via-transparent to-transparent" />
      {/* Grano sutil para textura premium */}
      <div
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
        style={{ backgroundImage: `url("${NOISE_SVG}")` }}
      />

      <div className="relative z-10 flex flex-col h-full p-10">
        <Logo />

        {/* Tarjetas flotantes — vista previa real del producto */}
        <div className="mt-14 flex flex-col gap-4 max-w-[300px]">
          <ComprobanteFloatCard />
          <CumplimientoFloatCard />
        </div>

        <div className="mt-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/40 mb-4">
            {eyebrow}
          </p>
          <h1 className="text-3xl font-bold text-white leading-tight">
            {title}
          </h1>
          <p className="mt-3 text-sm text-white/55 leading-relaxed">
            {description}
          </p>

          <div className="mt-9 space-y-3.5">
            {features.map(f => (
              <div key={f} className="flex items-center gap-3">
                <div className="h-1.5 w-1.5 rounded-full bg-white/40 shrink-0" />
                <span className="text-sm text-white/65">{f}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-10 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/25">
          Ley 16-92 · Ley 87-01 · Ley 11-92 · República Dominicana
        </p>
      </div>
    </div>
  )
}

export function MobileLogo() {
  return (
    <div className="flex lg:hidden items-center mb-10">
      <CieloLogo className="h-12" />
    </div>
  )
}
