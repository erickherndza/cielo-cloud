'use client'

import { useState, useMemo } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { formatRD } from '@/lib/utils'
import { exportarExcel } from '@/lib/excel-export'
import type { PeriodoNomina, Empresa, Empleado } from '@/types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NAVY, pdfHeader, periodoLabel, resultadoHistorico, selectCls, primaryBtn, FilterBar, ReportHeader } from './shared'

// ─── Reporte Costo por Departamento ──────────────────────────────────────────
export function ReporteCostoPorDepto({
  empresa, empleados, periodos,
}: {
  empresa: Empresa
  empleados: ReturnType<typeof useEmpleados>['empleados']
  periodos: PeriodoNomina[]
}) {
  const sorted = useMemo(() =>
    [...periodos].filter(p => p.estado !== 'en_proceso' && p.tipo !== 'regalia' && p.tipo !== 'bonificacion').sort((a, b) => new Date(b.fechaGeneracion).getTime() - new Date(a.fechaGeneracion).getTime()),
    [periodos]
  )
  const [periodoId, setPeriodoId] = useState<string>(sorted[0]?.id ?? '')
  const [generado, setGenerado] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  const periodo = sorted.find(p => p.id === periodoId)

  const deptos = useMemo(() => {
    if (!periodo || !generado) return []
    // Empleados REALMENTE incluidos en el período (snapshot si existe, o
    // todos los activos como respaldo solo para períodos sin snapshot) — ver
    // nota equivalente en el Reporte TSS más arriba en este mismo archivo.
    const idsDelPeriodo = periodo.resultadosPorEmpleado && Object.keys(periodo.resultadosPorEmpleado).length > 0
      ? Object.keys(periodo.resultadosPorEmpleado)
      : empleados.filter(e => e.activo).map(e => e.id)
    const empleadosDelPeriodo = idsDelPeriodo.map(id => empleados.find(e => e.id === id)).filter((e): e is Empleado => !!e)
    const groups: Record<string, { headcount: number; bruto: number; neto: number; tss: number; costo: number }> = {}
    for (const emp of empleadosDelPeriodo) {
      const res = resultadoHistorico(emp, periodo)
      const d = emp.departamento || 'Sin Departamento'
      if (!groups[d]) groups[d] = { headcount: 0, bruto: 0, neto: 0, tss: 0, costo: 0 }
      groups[d].headcount++
      groups[d].bruto += res.totalBruto
      groups[d].neto  += res.salarioNeto
      groups[d].tss   += res.totalAportesEmpleador
      groups[d].costo += res.totalCostoEmpleador
    }
    const grandTotal = Object.values(groups).reduce((s, g) => s + g.costo, 0)
    return Object.entries(groups)
      .map(([depto, g]) => ({ depto, ...g, pct: grandTotal > 0 ? g.costo / grandTotal * 100 : 0 }))
      .sort((a, b) => b.costo - a.costo)
  }, [periodo, generado, empleados])

  const deptoVisible = useMemo(() => {
    if (!searchQ.trim()) return deptos
    const q = searchQ.toLowerCase()
    return deptos.filter(d => d.depto.toLowerCase().includes(q))
  }, [deptos, searchQ])

  const totales = useMemo(() => deptos.reduce((acc, d) => ({
    headcount: acc.headcount + d.headcount, bruto: acc.bruto + d.bruto,
    neto: acc.neto + d.neto, tss: acc.tss + d.tss, costo: acc.costo + d.costo,
  }), { headcount: 0, bruto: 0, neto: 0, tss: 0, costo: 0 }), [deptos])

  function exportarPDF() {
    if (!periodo || deptos.length === 0) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pdfHeader(doc, empresa, 'Costo por Departamento', periodoLabel(periodo))
    autoTable(doc, {
      startY: 44,
      head: [['Departamento','Empleados','Sal. Bruto','Sal. Neto','TSS Empleador','Costo Total','% del Total']],
      body: deptos.map(d => [d.depto, `${d.headcount}`, formatRD(d.bruto), formatRD(d.neto), formatRD(d.tss), formatRD(d.costo), `${d.pct.toFixed(1)}%`]),
      foot: [['TOTALES', `${totales.headcount}`, formatRD(totales.bruto), formatRD(totales.neto), formatRD(totales.tss), formatRD(totales.costo), '100%']],
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      footStyles: { fillColor: [240, 240, 240], textColor: NAVY, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'center' } },
      didDrawPage: (data) => { doc.setFontSize(7); doc.setTextColor(150); doc.text(`Página ${data.pageNumber}`, 283, 205, { align: 'right' }) },
    })
    doc.save(`costo-departamento-${periodoLabel(periodo).replace(/\s+/g, '-').toLowerCase()}.pdf`)
  }

  function exportarXlsx() {
    if (!periodo || deptos.length === 0) return
    exportarExcel({
      nombreArchivo: `costo-departamento-${periodoLabel(periodo).replace(/\s+/g, '-').toLowerCase()}`,
      empresa: empresa.nombre, logo: empresa.logo, rnc: empresa.rnc,
      hojas: [{
        nombre: 'Por Departamento', titulo: 'Costo por Departamento', subtitulo: periodoLabel(periodo),
        encabezados: ['Departamento','Empleados','Sal. Bruto','Sal. Neto','TSS Empleador','Costo Total','% del Total'],
        filas: deptos.map(d => [d.depto, d.headcount, d.bruto, d.neto, d.tss, d.costo, `${d.pct.toFixed(1)}%`]),
        totales: ['TOTALES', totales.headcount, totales.bruto, totales.neto, totales.tss, totales.costo, '100%'],
        anchos: [28, 14, 18, 18, 18, 18, 14],
        columnasEnteras: [1],
      }],
    })
  }

  return (
    <div className="space-y-5">
      <ReportHeader title="Costo por Departamento" desc="Masa salarial, headcount y costo total agrupado por área organizacional." onPDF={deptos.length > 0 ? exportarPDF : undefined} onExcel={deptos.length > 0 ? exportarXlsx : undefined} />
      <FilterBar>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Período:
          <select value={periodoId} onChange={e => { setPeriodoId(e.target.value); setGenerado(false) }} className={selectCls}>
            {sorted.length === 0 ? <option value="">Sin períodos</option> : sorted.map(p => <option key={p.id} value={p.id}>{periodoLabel(p)}</option>)}
          </select>
        </label>
        <button onClick={() => { setGenerado(true); setSearchQ('') }} disabled={!periodoId} className={primaryBtn}>
          <ChevronRight className="h-4 w-4" /> Generar
        </button>
      </FilterBar>
      {!generado ? <EmptyState message="Selecciona un período y haz clic en Generar." /> : deptos.length === 0 ? <EmptyState message="No hay empleados activos en este período." /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Departamentos</p>
              <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100">{deptos.length}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Total Empleados</p>
              <p className="mt-1 text-xl font-bold text-indigo-700 dark:text-indigo-400 tabular-nums">{totales.headcount}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Costo Total</p>
              <p className="mt-1 text-xl font-bold text-indigo-700 dark:text-indigo-400 tabular-nums">{formatRD(totales.costo)}</p>
            </div>
          </div>
          <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
            <div className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] px-5 py-2.5 flex items-center gap-2">
              <Search className="h-4 w-4 text-zinc-400 shrink-0" />
              <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Buscar departamento…" className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none" />
              <span className="text-xs text-zinc-400 shrink-0">{deptoVisible.length}/{deptos.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] text-left">
                    {['Departamento','Empleados','Sal. Bruto','Sal. Neto','TSS Empl.','Costo Total','% del Total'].map(h => (
                      <th key={h} className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 last:text-right first:text-left text-right">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                  {deptoVisible.map(d => (
                    <tr key={d.depto} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                      <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{d.depto}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{d.headcount}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{formatRD(d.bruto)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatRD(d.neto)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-amber-700 dark:text-amber-400">{formatRD(d.tss)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-indigo-700 dark:text-indigo-400 font-medium">{formatRD(d.costo)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-zinc-100 dark:bg-[#2e2e2e] overflow-hidden">
                            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${d.pct}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400 shrink-0 w-10 text-right">{d.pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#c7cef0] dark:border-[#2e2e2e] bg-[#eef0fb] dark:bg-[#262626] text-[#1B2980] dark:text-indigo-300 font-bold text-right">
                    <td className="px-5 py-3 text-left text-xs uppercase tracking-wide">TOTALES</td>
                    <td className="px-5 py-3 tabular-nums">{totales.headcount}</td>
                    <td className="px-5 py-3 tabular-nums">{formatRD(totales.bruto)}</td>
                    <td className="px-5 py-3 tabular-nums text-emerald-700 dark:text-emerald-300">{formatRD(totales.neto)}</td>
                    <td className="px-5 py-3 tabular-nums text-amber-700 dark:text-amber-300">{formatRD(totales.tss)}</td>
                    <td className="px-5 py-3 tabular-nums text-indigo-700 dark:text-indigo-300">{formatRD(totales.costo)}</td>
                    <td className="px-5 py-3">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
