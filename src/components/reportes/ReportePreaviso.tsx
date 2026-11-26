'use client'

import { useState, useMemo } from 'react'
import { ChevronRight, Search, CheckCircle2, XCircle } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { getDiasPreavisoRequeridos } from '@/lib/dominican-labor'
import { formatDate, fullName, formatAnosServicio, parseFechaLocal } from '@/lib/utils'
import { exportarExcel } from '@/lib/excel-export'
import type { Empresa, RegistroLiquidacion, Empleado } from '@/types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NAVY, pdfHeader, selectCls, primaryBtn, FilterBar, ReportHeader } from './shared'

// ─── Reporte Cumplimiento de Preaviso (Art. 76) ───────────────────────────────
export function ReportePreaviso({
  empresa, empleados, liquidaciones,
}: {
  empresa: Empresa
  empleados: ReturnType<typeof useEmpleados>['empleados']
  liquidaciones: RegistroLiquidacion[]
}) {
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'cumplio' | 'incumplio'>('todos')
  const [generado, setGenerado] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  const empMap = useMemo(() =>
    Object.fromEntries(empleados.map(e => [e.id, e])),
    [empleados]
  )

  // Solo renuncias con fecha de notificación capturada tienen algo que evaluar
  const renuncias = useMemo(() =>
    liquidaciones.filter(l => l.motivo === 'renuncia' && l.fechaNotificacionRenuncia),
    [liquidaciones]
  )

  const filas = useMemo(() => {
    if (!generado) return []
    return renuncias
      .map(l => {
        const diasRequeridos = getDiasPreavisoRequeridos(l.anosServicio)
        const diasReales = Math.round(
          (parseFechaLocal(l.fechaTerminacion).getTime() - parseFechaLocal(l.fechaNotificacionRenuncia!).getTime())
          / (24 * 3600 * 1000)
        )
        const diferencia = diasReales - diasRequeridos
        const cumplio = diferencia >= 0
        return { l, emp: empMap[l.empleadoId], diasRequeridos, diasReales, diferencia, cumplio }
      })
      .filter(r => filtroEstado === 'todos' || (filtroEstado === 'cumplio' ? r.cumplio : !r.cumplio))
      .sort((a, b) => b.l.fechaTerminacion.localeCompare(a.l.fechaTerminacion))
  }, [generado, renuncias, empMap, filtroEstado])

  const filasVisible = useMemo(() => {
    if (!searchQ.trim()) return filas
    const q = searchQ.toLowerCase()
    return filas.filter(({ emp }) => emp && fullName(emp).toLowerCase().includes(q))
  }, [filas, searchQ])

  const summary = useMemo(() => {
    const total = filas.length
    const cumplieron = filas.filter(r => r.cumplio).length
    const incumplieron = total - cumplieron
    return { total, cumplieron, incumplieron }
  }, [filas])

  function exportarPDF() {
    if (filas.length === 0) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pdfHeader(doc, empresa, 'Cumplimiento de Preaviso en Renuncias', 'Art. 76 — Código de Trabajo')

    autoTable(doc, {
      startY: 44,
      head: [['Empleado', 'Antigüedad', 'Fecha Notificación', 'Fecha Terminación', 'Días Exigidos', 'Días Reales', 'Diferencia', 'Estado']],
      body: filas.map(({ l, emp, diasRequeridos, diasReales, diferencia, cumplio }) => [
        emp ? fullName(emp) : 'Empleado eliminado',
        formatAnosServicio(l.anosServicio),
        formatDate(l.fechaNotificacionRenuncia!),
        formatDate(l.fechaTerminacion),
        `${diasRequeridos}`,
        `${diasReales}`,
        `${diferencia >= 0 ? '+' : ''}${diferencia}`,
        cumplio ? 'Cumplió' : 'Incumplió',
      ]),
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 4: { halign: 'center' }, 5: { halign: 'center' }, 6: { halign: 'center' }, 7: { halign: 'center' } },
      didDrawPage: (data) => {
        doc.setFontSize(7); doc.setTextColor(150)
        doc.text(`Página ${data.pageNumber}`, 283, 205, { align: 'right' })
      },
    })
    doc.save('cumplimiento-preaviso-renuncias.pdf')
  }

  function exportarXlsx() {
    if (filas.length === 0) return
    exportarExcel({
      nombreArchivo: 'cumplimiento-preaviso-renuncias',
      empresa: empresa.nombre, logo: empresa.logo,
      rnc: empresa.rnc,
      hojas: [{
        nombre: 'Preaviso',
        titulo: 'Cumplimiento de Preaviso en Renuncias',
        subtitulo: 'Art. 76 — Código de Trabajo',
        encabezados: ['Empleado', 'Antigüedad', 'Fecha Notificación', 'Fecha Terminación', 'Días Exigidos', 'Días Reales', 'Diferencia', 'Estado'],
        filas: filas.map(({ l, emp, diasRequeridos, diasReales, diferencia, cumplio }) => [
          emp ? fullName(emp) : 'Empleado eliminado',
          formatAnosServicio(l.anosServicio),
          formatDate(l.fechaNotificacionRenuncia!),
          formatDate(l.fechaTerminacion),
          diasRequeridos, diasReales, diferencia,
          cumplio ? 'Cumplió' : 'Incumplió',
        ]),
        anchos: [30, 16, 18, 18, 14, 14, 12, 12],
        columnasEnteras: [4, 5, 6],
      }],
    })
  }

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Cumplimiento de Preaviso en Renuncias"
        desc="Art. 76 — compara la anticipación real con la que el empleado debía dar según su antigüedad al renunciar."
        onPDF={filas.length > 0 ? exportarPDF : undefined}
        onExcel={filas.length > 0 ? exportarXlsx : undefined}
      />

      <FilterBar>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Estado:
          <select value={filtroEstado} onChange={e => { setFiltroEstado(e.target.value as typeof filtroEstado); setGenerado(false) }} className={selectCls}>
            <option value="todos">Todos</option>
            <option value="cumplio">Cumplió</option>
            <option value="incumplio">Incumplió</option>
          </select>
        </label>
        <button onClick={() => { setGenerado(true); setSearchQ('') }} className={primaryBtn}>
          <ChevronRight className="h-4 w-4" /> Generar
        </button>
      </FilterBar>

      {!generado ? (
        <EmptyState message="Selecciona un estado y haz clic en Generar para ver el reporte." />
      ) : renuncias.length === 0 ? (
        <EmptyState message="No hay renuncias con fecha de notificación registrada todavía. Captúrala al finalizar una liquidación por renuncia." />
      ) : filas.length === 0 ? (
        <EmptyState message="No hay renuncias que coincidan con el filtro seleccionado." />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Renuncias Evaluadas</p>
              <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{summary.total}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Cumplieron</p>
              <p className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{summary.cumplieron}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Incumplieron</p>
              <p className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-400 tabular-nums">{summary.incumplieron}</p>
            </div>
          </div>

          <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
            <div className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] px-5 py-2.5 flex items-center gap-2">
              <Search className="h-4 w-4 text-zinc-400 shrink-0" />
              <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Buscar por nombre de empleado…" className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none" />
              <span className="text-xs text-zinc-400 shrink-0">{filasVisible.length}/{filas.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] text-left">
                    <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Empleado</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Antigüedad</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Fecha Notificación</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Fecha Terminación</th>
                    <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Días Exigidos</th>
                    <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Días Reales</th>
                    <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Diferencia</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                  {filasVisible.map(({ l, emp, diasRequeridos, diasReales, diferencia, cumplio }) => (
                    <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-[#1B2980] dark:text-indigo-400 whitespace-nowrap">
                          {emp ? fullName(emp) : 'Empleado eliminado'}
                        </p>
                        {emp && <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{emp.cargo}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{formatAnosServicio(l.anosServicio)}</td>
                      <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{formatDate(l.fechaNotificacionRenuncia!)}</td>
                      <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{formatDate(l.fechaTerminacion)}</td>
                      <td className="px-4 py-3 text-center tabular-nums text-zinc-700 dark:text-zinc-300">{diasRequeridos}</td>
                      <td className="px-4 py-3 text-center tabular-nums text-zinc-700 dark:text-zinc-300">{diasReales}</td>
                      <td className="px-4 py-3 text-center tabular-nums font-medium">
                        <span className={diferencia >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}>
                          {diferencia >= 0 ? '+' : ''}{diferencia}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {cumplio ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-800/50">
                            <CheckCircle2 className="h-3 w-3" />
                            Cumplió
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-950/30 px-2.5 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-400 ring-1 ring-inset ring-rose-200 dark:ring-rose-800/50">
                            <XCircle className="h-3 w-3" />
                            Incumplió
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
