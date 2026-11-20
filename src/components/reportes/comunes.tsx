'use client'

import { AlertTriangle, XCircle, CheckCircle2, Info } from 'lucide-react'
import { aBytesLatin1 } from '@/lib/ancho-fijo'
import Link from 'next/link'
import type { PeriodoNomina, Empresa } from '@/types'

export const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

/** Descarga un archivo de texto en Latin-1 (un byte por carácter, ancho fijo exacto). */
export function descargarTxt(lineas: string[], nombre: string) {
  const bytes = aBytesLatin1(lineas)
  const blob = new Blob([bytes as BlobPart], { type: 'text/plain;charset=windows-1252' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Mes/año más reciente con nómina; si no hay, el mes anterior al actual (lo que se declara). */
export function periodoInicialSugerido(periodos: PeriodoNomina[]): { mes: number; anio: number } {
  const con = periodos
    .filter(p => (p.tipo === 'mensual' || p.tipo === 'quincenal') && (p.empleadosProcesados?.length ?? 0) > 0)
    .sort((a, b) => b.anio * 12 + b.mes - (a.anio * 12 + a.mes))[0]
  if (con) return { mes: con.mes, anio: con.anio }
  const h = new Date()
  const m = h.getMonth() === 0 ? { mes: 12, anio: h.getFullYear() - 1 } : { mes: h.getMonth(), anio: h.getFullYear() }
  return m
}

export function SelectorMes({
  mes, anio, onChange,
}: { mes: number; anio: number; onChange: (mes: number, anio: number) => void }) {
  const y = new Date().getFullYear()
  const anios = Array.from({ length: 8 }, (_, i) => y + 1 - i)
  const cls = 'rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#262626] px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200'
  return (
    <div className="flex items-center gap-2">
      <select aria-label="Mes" value={mes} onChange={e => onChange(Number(e.target.value), anio)} className={cls}>
        {MESES_ES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <select aria-label="Año" value={anio} onChange={e => onChange(mes, Number(e.target.value))} className={cls}>
        {anios.map(a => <option key={a} value={a}>{a}</option>)}
      </select>
    </div>
  )
}

export function PanelValidacion({
  errores, avisos, okTexto,
}: { errores: string[]; avisos: string[]; okTexto: string }) {
  if (errores.length === 0 && avisos.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {okTexto}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {errores.length > 0 && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-300">
          <p className="flex items-center gap-2 font-semibold"><XCircle className="h-4 w-4" /> {errores.length} cosa(s) por corregir antes de enviar</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-6">{errores.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}</ul>
          {errores.length > 12 && <p className="mt-1 pl-6 text-xs">… y {errores.length - 12} más</p>}
        </div>
      )}
      {avisos.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> {avisos.length} aviso(s)</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-6">{avisos.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul>
          {avisos.length > 8 && <p className="mt-1 pl-6 text-xs">… y {avisos.length - 8} más</p>}
        </div>
      )}
    </div>
  )
}

export function NotaInfo({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] px-4 py-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
      <div>{children}</div>
    </div>
  )
}

/**
 * Regla de negocio: la autodeterminación (TSS) y los DGT (Ministerio de Trabajo)
 * solo pueden generarse cuando la nómina del mes está procesada, cerrada y PAGADA:
 * ambas quincenas si la empresa paga quincenal, o el período mensual.
 */
export function verificarNominaPagada(
  periodos: PeriodoNomina[], empresa: Empresa, mes: number, anio: number,
): { ok: boolean; faltantes: string[] } {
  const delMes = periodos.filter(p => (p.tipo === 'mensual' || p.tipo === 'quincenal') && p.mes === mes && p.anio === anio)
  const quincenal = delMes.some(p => p.tipo === 'quincenal') || (delMes.length === 0 && empresa.modalidadNomina === 'quincenal')
  const requeridos: { etiqueta: string; p?: PeriodoNomina }[] = quincenal
    ? [1, 2].map(q => ({ etiqueta: `${q}ª quincena de ${MESES_ES[mes - 1]} ${anio}`, p: delMes.find(x => x.tipo === 'quincenal' && x.quincena === q) }))
    : [{ etiqueta: `Nómina de ${MESES_ES[mes - 1]} ${anio}`, p: delMes.find(x => x.tipo === 'mensual') }]
  const faltantes: string[] = []
  for (const { etiqueta, p } of requeridos) {
    if (!p) faltantes.push(`${etiqueta}: no se ha creado`)
    else if (p.estado !== 'cerrada') faltantes.push(`${etiqueta}: está ${p.estado === 'en_proceso' ? 'en proceso' : 'procesada'}, falta cerrarla`)
    else if (!p.pagada) faltantes.push(`${etiqueta}: está cerrada pero sin marcar como pagada`)
  }
  return { ok: faltantes.length === 0, faltantes }
}

export function BloqueoNominaNoPagada({ faltantes }: { faltantes: string[] }) {
  return (
    <div className="rounded-lg border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-950/30 px-5 py-4 text-sm text-rose-800 dark:text-rose-300">
      <p className="flex items-center gap-2 font-semibold"><XCircle className="h-4 w-4" /> Todavía no se puede generar este reporte</p>
      <p className="mt-1">Solo se genera cuando la nómina del mes está procesada, cerrada y pagada. Falta:</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-6">{faltantes.map((f, i) => <li key={i}>{f}</li>)}</ul>
      <div className="mt-3 flex gap-3 text-xs font-medium">
        <Link href="/nomina" className="underline">Ir a Cálculo de Nómina</Link>
        <Link href="/nomina/envios" className="underline">Ir a Gestión de Envíos (marcar pagada)</Link>
      </div>
    </div>
  )
}
