'use client'

import { dibujarLogoPDF } from '@/lib/branding'
import { Download, FileSpreadsheet } from 'lucide-react'
import { calcularConPeriodo } from '@/lib/dominican-labor'
import { BTN_PRIMARY } from '@/lib/utils'
import type { PeriodoNomina, Empresa, Empleado, ResultadoNomina } from '@/types'
import jsPDF from 'jspdf'

// ─── Constants ────────────────────────────────────────────────────────────────
export const NAVY: [number, number, number] = [27, 41, 128]
export const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

// ─── PDF Helper ───────────────────────────────────────────────────────────────
export function pdfHeader(
  doc: jsPDF,
  empresa: Empresa,
  title: string,
  subtitle: string,
  landscape = true,
) {
  const pageW = landscape ? 297 : 210
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, pageW, 22, 'F')

  let textX = 14
  const logoW = dibujarLogoPDF(doc, empresa.logo, 14, 2, 36, 18)
  if (logoW > 0) textX = 14 + logoW + 4

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text(empresa.nombre || 'Empresa', textX, 10)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`RNC: ${empresa.rnc || '—'}`, textX, 16)

  doc.setTextColor(...NAVY)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 14, 31)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 100, 100)
  doc.text(subtitle, 14, 37)
  doc.text(`Generado: ${new Date().toLocaleDateString('es-DO')}`, pageW - 14, 37, { align: 'right' })
}

export function periodoLabel(p: PeriodoNomina): string {
  if (p.tipo === 'regalia') return `Regalía Pascual ${p.anio}${p.complemento ? ' (complemento)' : ''}`
  if (p.tipo === 'bonificacion') return `Bonificación Utilidades ${p.anio}`
  const mes = MESES[p.mes - 1]
  if (p.tipo === 'quincenal') return `${p.quincena}ª Quincena ${mes} ${p.anio}`
  return `${mes} ${p.anio}`
}

// Preferir el snapshot histórico congelado al momento de procesar (fuente
// fidedigna de lo que realmente se pagó) sobre recalcular con el Empleado en
// vivo — que usaría un salarioBase u otros datos que pudieron cambiar
// después (aumento salarial, etc.), inflando o distorsionando retroactivamente
// un período ya cerrado y pagado. Solo recalcula en vivo para períodos
// anteriores a este campo (sin ningún snapshot todavía).
export function resultadoHistorico(emp: Empleado, periodo: PeriodoNomina): ResultadoNomina {
  const snapshot = periodo.resultadosPorEmpleado?.[emp.id]
  if (snapshot) return snapshot
  const ajustes = periodo.ajustesPorEmpleado?.[emp.id] ?? []
  return calcularConPeriodo(emp, ajustes, periodo)
}

// ─── Shared UI components ─────────────────────────────────────────────────────
export const selectCls = 'rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-zinc-50 dark:bg-[#262626] px-3 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 focus:border-[#1B2980] dark:focus:border-indigo-500 focus:outline-none'
export const primaryBtn = BTN_PRIMARY

export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] px-5 py-3 shadow-sm dark:shadow-none">
      {children}
    </div>
  )
}

export function ReportHeader({
  title, desc, onPDF, onExcel, disabled, disabledReason,
}: {
  title: string
  desc: string
  onPDF?: () => void
  onExcel?: () => void
  /** Cuando es true, deshabilita visualmente los botones de exportación (p. ej. hay errores de validación bloqueantes) sin ocultarlos — el usuario ve que existe la acción pero no puede usarla hasta corregir los datos. */
  disabled?: boolean
  disabledReason?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h2>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{desc}</p>
      </div>
      {(onPDF || onExcel) && (
        <div className="flex items-center gap-2 shrink-0">
          {onExcel && (
            <button
              onClick={onExcel}
              disabled={disabled}
              title={disabled ? disabledReason : undefined}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                disabled
                  ? 'border-tabler-line dark:border-[#2e2e2e] bg-zinc-50 dark:bg-[#262626] text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
                  : 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50'
              }`}
            >
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </button>
          )}
          {onPDF && (
            <button
              onClick={onPDF}
              disabled={disabled}
              title={disabled ? disabledReason : undefined}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                disabled
                  ? 'border-tabler-line dark:border-[#2e2e2e] bg-zinc-50 dark:bg-[#262626] text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
                  : 'border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50'
              }`}
            >
              <Download className="h-4 w-4" />
              PDF
            </button>
          )}
        </div>
      )}
    </div>
  )
}
