'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Building2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { useEmpleados } from '@/lib/empleados-context'
import { calcularNomina } from '@/lib/dominican-labor'
import { fullName } from '@/lib/utils'
import { useEmpresa } from '@/lib/empresa-context'
import { usePeriodos } from '@/lib/periodos-context'
import { useAuth } from '@/lib/auth-context'
import { useAlertas, SEVERIDAD_ORDEN } from '@/lib/alertas'
import { labelPeriodo } from '@/lib/nomina-shared'
import { AgendaNomina } from '@/components/dashboard/AgendaNomina'
import { ChartSkeleton } from '@/components/charts/ChartSkeleton'

const PayrollBarChart = dynamic(
  () => import('@/components/charts/PayrollBarChart').then(m => m.PayrollBarChart),
  { ssr: false, loading: () => <ChartSkeleton variant="bars" height={120} /> }
)
const CostDonutChart = dynamic(
  () => import('@/components/charts/CostDonutChart').then(m => m.CostDonutChart),
  { ssr: false, loading: () => <ChartSkeleton variant="donut" height={110} /> }
)
const TrendLineChart = dynamic(
  () => import('@/components/charts/TrendLineChart').then(m => m.TrendLineChart),
  { ssr: false, loading: () => <ChartSkeleton variant="line" height={120} /> }
)

const hoy = new Date()
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function formatK(v: number) {
  if (v >= 1_000_000) return `RD$${(v / 1_000_000).toFixed(1)}M`
  return `RD$${(v / 1_000).toFixed(0)}K`
}

// ── Bento: todas las tarjetas comparten forma (radio 28px, sin borde, sombra mínima) ──
const TILE = 'rounded-3xl sm:rounded-[28px] bg-white dark:bg-[#141722] shadow-[0_1px_2px_rgba(15,27,61,0.05)] p-5 sm:p-6'

function TileTitle({ children }: { children: React.ReactNode }) {
  return <p className="font-display text-[15px] font-semibold text-[#0F1B3D] dark:text-zinc-100">{children}</p>
}

function DeltaPill({ delta }: { delta: { pct: number; positive: boolean } }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
      delta.positive
        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
        : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
    }`}>
      {delta.positive ? '↑' : '↓'} {Math.abs(delta.pct).toFixed(1)}% vs anterior
    </span>
  )
}

function ChartCard({
  label,
  value,
  subtitle,
  delta,
  children,
  className = '',
}: {
  label: string
  value: string
  subtitle: string
  delta?: { pct: number; positive: boolean }
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`${TILE} flex flex-col gap-4 ${className}`}>
      <TileTitle>{label}</TileTitle>
      <div className="flex flex-col gap-1.5">
        <p className="font-cifras text-4xl font-medium leading-none tracking-tight text-[#0F1B3D] dark:text-zinc-100">{value}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        {delta && <div className="mt-1"><DeltaPill delta={delta} /></div>}
      </div>
      {children}
    </div>
  )
}

const RANGO_OPCIONES = [3, 6, 12] as const
type RangoMeses = typeof RANGO_OPCIONES[number]

function RangoSelector({ value, onChange }: { value: RangoMeses; onChange: (v: RangoMeses) => void }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-[#252840] bg-white dark:bg-[#141722] p-0.5">
      {RANGO_OPCIONES.map(opcion => (
        <button
          key={opcion}
          type="button"
          onClick={() => onChange(opcion)}
          className={`rounded-md px-3.5 py-2 sm:px-2.5 sm:py-1 text-xs font-semibold transition-colors ${
            value === opcion
              ? 'bg-[#1B2980] text-white'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          {opcion}M
        </button>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const { empresa } = useEmpresa()
  const { periodos } = usePeriodos()
  const nombreEmpresa = empresa.nombre || 'Mi Empresa'
  const infoEmpresa = [
    empresa.ciudad || 'República Dominicana',
    empresa.rnc ? `RNC ${empresa.rnc}` : null,
  ].filter(Boolean).join(' · ')

  const { empleadosActivos } = useEmpleados()
  const nominas = empleadosActivos.map(e => calcularNomina(e))
  const totalBruto        = nominas.reduce((s, n) => s + n.totalBruto, 0)
  const totalNeto         = nominas.reduce((s, n) => s + n.salarioNeto, 0)
  const totalISR          = nominas.reduce((s, n) => s + n.isrMensual, 0)
  const totalTSSEmpleador = nominas.reduce((s, n) => s + n.totalAportesEmpleador, 0)
  const totalRegalia      = nominas.reduce((s, n) => s + n.regaliaPascual, 0)
  const afpEmpleador      = nominas.reduce((s, n) => s + n.afpEmpleador, 0)
  const sfsEmpleador      = nominas.reduce((s, n) => s + n.sfsEmpleador, 0)
  const srlEmpleador      = nominas.reduce((s, n) => s + n.srlEmpleador, 0)
  const infotepEmpleador  = nominas.reduce((s, n) => s + n.infotepEmpleador, 0)
  const costoTotal        = totalBruto + totalTSSEmpleador

  const periodo = `${MES_LARGO[hoy.getMonth()]} ${hoy.getFullYear()}`

  // ── Historial de nómina para los gráficos ─────────────────────────────────
  // Antes solo consideraba tipo==='mensual' — cualquier empresa en modalidad
  // quincenal (Empresa.modalidadNomina==='quincenal') nunca tenía períodos
  // 'mensual' reales, así que sus gráficos siempre caían al relleno sintético
  // sin importar cuántos períodos hubiera procesado. Ahora se agregan ambos
  // tipos, sumando las 2 quincenas de un mismo mes en un solo total mensual.
  const [rangoMeses, setRangoMeses] = useState<RangoMeses>(6)

  const periodosPorMes = useMemo(() => {
    const acumulado = new Map<string, { anio: number; mes: number; bruto: number; aportes: number }>()
    for (const p of periodos) {
      if (p.estado === 'en_proceso') continue
      if (p.tipo !== 'mensual' && p.tipo !== 'quincenal') continue
      const key = `${p.anio}-${p.mes}`
      const fila = acumulado.get(key) ?? { anio: p.anio, mes: p.mes, bruto: 0, aportes: 0 }
      fila.bruto   += p.totales.bruto
      fila.aportes += p.totales.aportes
      acumulado.set(key, fila)
    }
    return Array.from(acumulado.values()).sort((a, b) => a.anio !== b.anio ? a.anio - b.anio : a.mes - b.mes)
  }, [periodos])

  const periodosReales = periodosPorMes.slice(-rangoMeses)
  // Distingue año en la etiqueta solo si el rango visible cruza más de un año
  // calendario — evita ambigüedad tipo "Ene" repetido para 2025 y 2026 en un
  // rango de 12 meses, sin ensuciar la etiqueta cuando no hace falta.
  const multiAnio = new Set(periodosReales.map(p => p.anio)).size > 1
  const labelMes = (p: { anio: number; mes: number }) => multiAnio ? `${MESES[p.mes - 1]} ${String(p.anio).slice(2)}` : MESES[p.mes - 1]

  const BAR_DATA = periodosReales.length >= 1
    ? periodosReales.map(p => ({ mes: labelMes(p), nomina: p.bruto, tss: p.aportes }))
    : Array.from({ length: rangoMeses }, (_, i) => {
        const offset = rangoMeses - 1 - i
        const ratio  = 0.85 + (i / (rangoMeses - 1)) * 0.15
        return {
          mes: MESES[((hoy.getMonth() - offset) % 12 + 12) % 12],
          nomina: Math.round(totalBruto * ratio),
          tss: Math.round(totalTSSEmpleador * ratio),
        }
      })

  const netoRatio  = totalBruto > 0 ? totalNeto / totalBruto : 0
  const LINE_DATA  = BAR_DATA.map(d => ({ mes: d.mes, valor: Math.round(d.nomina * netoRatio) }))

  // BAR_DATA/LINE_DATA tienen entre 1 y `rangoMeses` elementos según cuántos
  // períodos reales existan — nunca asumir una cantidad fija.
  const ultimoIdx  = BAR_DATA.length - 1
  const anteriorIdx = ultimoIdx - 1
  const prevBruto  = anteriorIdx >= 0 ? BAR_DATA[anteriorIdx].nomina : 0
  const prevCosto  = anteriorIdx >= 0 ? BAR_DATA[anteriorIdx].nomina + BAR_DATA[anteriorIdx].tss : 0
  const prevNeto   = anteriorIdx >= 0 ? LINE_DATA[anteriorIdx].valor : 0
  const deltaBruto = prevBruto > 0 ? ((BAR_DATA[ultimoIdx].nomina  - prevBruto) / prevBruto) * 100 : 0
  const deltaCosto = prevCosto > 0 ? ((costoTotal                   - prevCosto) / prevCosto) * 100 : 0
  const deltaNeto  = prevNeto  > 0 ? ((LINE_DATA[ultimoIdx].valor  - prevNeto)  / prevNeto)  * 100 : 0

  const DONUT_DATA = [
    { name: 'Salario neto',  value: totalNeto,        color: '#1B2980' },
    { name: 'AFP empleador', value: afpEmpleador,      color: '#0891b2' },
    { name: 'SFS empleador', value: sfsEmpleador,      color: '#7c3aed' },
    { name: 'SRL',           value: srlEmpleador,      color: '#d97706' },
    { name: 'Infotep',       value: infotepEmpleador,  color: '#65a30d' },
    { name: 'ISR retenido',  value: totalISR,          color: '#e11d48' },
  ]

  const maxBar = Math.max(...[afpEmpleador, sfsEmpleador, srlEmpleador, infotepEmpleador, totalISR, totalRegalia])

  // ── Hero: lo más importante ahora mismo, derivado de datos reales ─────────
  const { user } = useAuth()
  const alertas = useAlertas()
  const { empleadosEnNomina } = useEmpleados()
  const [saludo, setSaludo] = useState('Hola')
  useEffect(() => {
    const h = new Date().getHours()
    setSaludo(h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches')
  }, [])
  const primerNombre = user?.displayName?.split(' ')[0] ?? ''

  const enProceso = periodos
    .filter(p => p.estado === 'en_proceso')
    .sort((a, b) => b.fechaGeneracion.localeCompare(a.fechaGeneracion))[0]
  const sinPagar = periodos
    .filter(p => p.estado === 'cerrada' && !p.pagada)
    .sort((a, b) => b.fechaGeneracion.localeCompare(a.fechaGeneracion))[0]

  const hoyCorto = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  let venceTSS = new Date(hoy.getFullYear(), hoy.getMonth(), 10)
  if (venceTSS < hoyCorto) venceTSS = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 10)
  const diasTSS = Math.round((venceTSS.getTime() - hoyCorto.getTime()) / 86_400_000)
  const fechaTSS = `10 ${MESES[venceTSS.getMonth()].toLowerCase()}`

  const hero = enProceso
    ? {
        eyebrow: 'Nómina en proceso',
        titulo: `${labelPeriodo(enProceso)}: ${enProceso.empleadosProcesados?.length ?? 0} de ${empleadosEnNomina.length} empleado${empleadosEnNomina.length !== 1 ? 's' : ''} procesado${empleadosEnNomina.length !== 1 ? 's' : ''}`,
        cta: 'Continuar nómina', href: '/nomina',
      }
    : sinPagar
    ? {
        eyebrow: 'Pendiente de pago',
        titulo: `${labelPeriodo(sinPagar)} está cerrada. Falta confirmar el pago y enviar los comprobantes`,
        cta: 'Ir a Gestión de Envíos', href: '/nomina/envios',
      }
    : {
        eyebrow: 'Próxima obligación',
        titulo: diasTSS === 0 ? 'TSS e ISR vencen hoy' : `TSS e ISR vencen en ${diasTSS} día${diasTSS !== 1 ? 's' : ''}`,
        cta: 'Crear nómina', href: '/nomina',
      }

  const alertasOrdenadas = [...alertas].sort((a, b) => SEVERIDAD_ORDEN[a.severidad] - SEVERIDAD_ORDEN[b.severidad])
  const alertaTop = alertasOrdenadas[0]
  const hayUrgentes = alertasOrdenadas.some(a => a.severidad === 'danger')

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header title={nombreEmpresa} subtitle={periodo} />

      <div className="flex-1 overflow-y-auto bg-[#E9F0FB] dark:bg-[#0d0f1a]">
        <div className="p-4 md:p-6 space-y-4">

          {/* Fila 1 — hero + neto + estado */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">

            <section className="md:col-span-2 relative overflow-hidden rounded-3xl sm:rounded-[28px] bg-[#1B2980] p-5 sm:p-8 text-white flex flex-col justify-between gap-6 sm:gap-8 sm:min-h-[280px]">
              <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/[0.07]" />
              <div aria-hidden className="pointer-events-none absolute -bottom-24 right-24 h-56 w-56 rounded-full bg-white/[0.05]" />
              <div className="relative flex items-center gap-3">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-white/15 flex items-center justify-center">
                  {empresa.logo
                    ? <img src={empresa.logo} alt={nombreEmpresa} className="h-full w-full object-contain p-1" />
                    : <Building2 className="h-4 w-4 text-white/80" />}
                </div>
                <p className="text-xs text-white/70">
                  {saludo}{primerNombre ? `, ${primerNombre}` : ''} · {infoEmpresa}
                </p>
              </div>
              <div className="relative flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">{hero.eyebrow}</p>
                <h1 className="font-display text-2xl sm:text-[28px] font-bold leading-[1.15] tracking-tight max-w-[520px] break-words">{hero.titulo}</h1>
              </div>
              <div className="relative flex flex-wrap items-center gap-2">
                <Link href={hero.href} className="inline-flex h-11 sm:h-10 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#1B2980] hover:bg-white/90 transition-colors">
                  {hero.cta} <ArrowRight className="h-4 w-4" />
                </Link>
                <span className="rounded-full bg-white/15 px-3.5 py-2 text-xs font-semibold">{empleadosActivos.length} empleado{empleadosActivos.length !== 1 ? 's' : ''}</span>
                <span className="rounded-full bg-white/15 px-3.5 py-2 text-xs font-semibold">TSS e ISR: {fechaTSS}</span>
              </div>
            </section>

            <ChartCard
              label="Nómina neta"
              value={formatK(totalNeto)}
              subtitle="Total a pagar a empleados"
              delta={anteriorIdx >= 0 ? { pct: deltaNeto, positive: deltaNeto >= 0 } : undefined}
            >
              <TrendLineChart data={LINE_DATA} />
            </ChartCard>

            {alertaTop ? (
              <Link
                href={alertaTop.href}
                className={`${TILE} flex flex-col justify-between gap-4 transition-transform hover:-translate-y-0.5 ${
                  hayUrgentes ? '!bg-rose-50 dark:!bg-rose-500/10' : '!bg-amber-50 dark:!bg-amber-500/10'
                }`}
              >
                <TileTitle>Estado general</TileTitle>
                <div className="flex flex-col gap-2">
                  <AlertTriangle className={`h-6 w-6 ${hayUrgentes ? 'text-rose-600 dark:text-rose-300' : 'text-amber-600 dark:text-amber-300'}`} />
                  <p className={`font-display text-2xl font-bold leading-tight tracking-tight ${hayUrgentes ? 'text-rose-800 dark:text-rose-200' : 'text-amber-800 dark:text-amber-200'}`}>
                    {alertas.length} alerta{alertas.length !== 1 ? 's' : ''} por revisar
                  </p>
                </div>
                <p className={`text-xs leading-snug ${hayUrgentes ? 'text-rose-800/80 dark:text-rose-200/80' : 'text-amber-800/80 dark:text-amber-200/80'}`}>
                  {alertaTop.titulo} →
                </p>
              </Link>
            ) : (
              <div className={`${TILE} flex flex-col justify-between gap-4 !bg-[#D8F3E6] dark:!bg-emerald-500/10`}>
                <TileTitle>Estado general</TileTitle>
                <div className="flex flex-col gap-2">
                  <CheckCircle2 className="h-6 w-6 text-emerald-700 dark:text-emerald-300" />
                  <p className="font-display text-2xl font-bold leading-tight tracking-tight text-emerald-800 dark:text-emerald-200">Todo en orden</p>
                </div>
                <p className="text-xs text-emerald-800/80 dark:text-emerald-200/80">Sin vencimientos ni alertas pendientes</p>
              </div>
            )}
          </div>

          {/* Selector de rango — comparte estado con los gráficos */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div>
              <p className="font-display text-sm font-semibold text-[#0F1B3D] dark:text-zinc-200">Historial de nómina</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {periodosReales.length > 0
                  ? `${periodosReales.length} período${periodosReales.length !== 1 ? 's' : ''} real${periodosReales.length !== 1 ? 'es' : ''} procesado${periodosReales.length !== 1 ? 's' : ''}`
                  : 'Datos ilustrativos — aún no hay períodos procesados'}
              </p>
            </div>
            <RangoSelector value={rangoMeses} onChange={setRangoMeses} />
          </div>

          {/* Fila 2 — costos */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ChartCard
              className="md:col-span-2"
              label="Nómina mensual"
              value={formatK(totalBruto)}
              subtitle="Salario bruto planilla activa"
              delta={anteriorIdx >= 0 ? { pct: deltaBruto, positive: deltaBruto >= 0 } : undefined}
            >
              <PayrollBarChart data={BAR_DATA} />
              <div className="flex items-center gap-4 text-[10px] text-zinc-500 dark:text-zinc-400">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#1B2980] dark:bg-indigo-400 inline-block" /> Bruto</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#10b981] inline-block" /> TSS empl.</span>
              </div>
            </ChartCard>

            <ChartCard
              label="Composición de costos"
              value={formatK(costoTotal)}
              subtitle="Costo total empresa este mes"
              delta={anteriorIdx >= 0 ? { pct: deltaCosto, positive: deltaCosto >= 0 } : undefined}
            >
              <CostDonutChart data={DONUT_DATA} />
            </ChartCard>

            <AgendaNomina />
          </div>

          {/* Fila 3 — retenciones + empleados */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">

            <div className={TILE}>
              <TileTitle>Retenciones</TileTitle>
              <p className="mt-4 font-cifras text-3xl font-medium leading-none tracking-tight text-[#0F1B3D] dark:text-zinc-100">{formatK(totalISR + totalTSSEmpleador)}</p>
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 mb-5">Obligaciones del período</p>
              <div className="space-y-3">
                {[
                  { label: 'AFP empleador',  value: afpEmpleador,      color: '#0891b2', badge: null },
                  { label: 'SFS empleador',  value: sfsEmpleador,      color: '#7c3aed', badge: null },
                  { label: 'SRL empleador',  value: srlEmpleador,      color: '#d97706', badge: null },
                  { label: 'Infotep',        value: infotepEmpleador,  color: '#65a30d', badge: null },
                  { label: 'ISR retenido',   value: totalISR,          color: '#e11d48', badge: '10 jul' },
                  { label: 'Regalía prov.',  value: totalRegalia,      color: '#059669', badge: 'dic' },
                ].map(row => (
                  <div key={row.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                        {row.label}
                        {row.badge && (
                          <span className="rounded-full bg-zinc-100 dark:bg-[#1a1d2e] px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase">{row.badge}</span>
                        )}
                      </span>
                      <span className="font-cifras text-xs font-medium text-zinc-700 dark:text-zinc-300">{formatK(row.value)}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-[#1a1d2e] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${maxBar > 0 ? (row.value / maxBar) * 100 : 0}%`, backgroundColor: row.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Empleados — tarjeta oscura (contraste de la composición, como el bento de referencia) */}
            <div className="md:col-span-1 xl:col-span-3 rounded-3xl sm:rounded-[28px] bg-[#0F1B3D] p-5 sm:p-6 text-white flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="font-display text-[15px] font-semibold">Empleados</p>
                <Link href="/empleados" className="text-xs font-semibold text-white/80 hover:text-white flex items-center gap-1 py-3 -my-3 pl-3 -mr-1">
                  Ver todos <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              {empleadosActivos.length === 0 ? (
                <p className="text-sm text-white/60">Aún no hay empleados activos.</p>
              ) : (
                <div className="grid grid-cols-1 gap-x-8 gap-y-1 xl:grid-cols-2">
                  {empleadosActivos.slice(0, 6).map((emp, i) => {
                    const n = nominas[i]
                    return (
                      <div key={emp.id} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-white/5 transition-colors">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-xs font-bold text-white">
                          {emp.nombre[0]}{emp.apellido[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{fullName(emp)}</p>
                          <p className="text-[11px] text-white/60 truncate">{emp.cargo}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-cifras text-sm font-medium">{formatK(n.salarioNeto)}</p>
                          <p className="text-[10px] text-white/50">neto</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="mt-auto grid grid-cols-2 gap-4 border-t border-white/10 pt-5">
                <div>
                  <p className="text-[11px] text-white/50">Neto planilla activa</p>
                  <p className="mt-1 font-cifras text-2xl font-medium leading-none">{formatK(totalNeto)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-white/50">Costo total empresa</p>
                  <p className="mt-1 font-cifras text-2xl font-medium leading-none">{formatK(costoTotal)}</p>
                </div>
              </div>
            </div>
          </div>

          <p className="text-center text-[10px] text-zinc-400 dark:text-zinc-600 pb-2 tracking-wide">
            LEY 16-92 · LEY 87-01 TSS · LEY 11-92 ISR · DGII / CNSS · REPÚBLICA DOMINICANA
          </p>
        </div>
      </div>
    </div>
  )
}
