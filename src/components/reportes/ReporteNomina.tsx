'use client'

import { useState, useMemo } from 'react'
import { ChevronRight, Loader2, Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { calcularConPeriodo } from '@/lib/dominican-labor'
import { formatRD, fullName } from '@/lib/utils'
import { exportarExcel } from '@/lib/excel-export'
import type { AjusteLinea, PeriodoNomina, Empresa, Empleado, ResultadoNomina } from '@/types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NAVY, pdfHeader, periodoLabel, selectCls, primaryBtn, FilterBar, ReportHeader } from './shared'

// ─── Reporte Nómina por Período ───────────────────────────────────────────────
export function ReporteNomina({
  empresa, empleados, periodos,
}: {
  empresa: Empresa
  empleados: ReturnType<typeof useEmpleados>['empleados']
  periodos: PeriodoNomina[]
}) {
  const sorted = useMemo(() =>
    [...periodos].filter(p => p.estado !== 'en_proceso' && p.tipo !== 'regalia' && p.tipo !== 'bonificacion').sort((a, b) =>
      new Date(b.fechaGeneracion).getTime() - new Date(a.fechaGeneracion).getTime()
    ), [periodos])

  const [periodoId, setPeriodoId] = useState<string>(sorted[0]?.id ?? '')
  const [loading, setLoading] = useState(false)
  const [generado, setGenerado] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  const periodo = sorted.find(p => p.id === periodoId)

  const filas = useMemo(() => {
    if (!periodo || !generado) return []
    // Preferir el snapshot histórico congelado al momento de procesar cada
    // empleado (fuente fidedigna de lo que realmente se pagó) — recalcular
    // con el Empleado en vivo mostraría un salario que pudo cambiar después
    // (aumento, etc.) para un período ya cerrado y pagado. Solo se recalcula
    // en vivo para períodos anteriores a este campo (sin ningún snapshot).
    const tieneSnapshots = periodo.resultadosPorEmpleado && Object.keys(periodo.resultadosPorEmpleado).length > 0
    if (tieneSnapshots) {
      return Object.entries(periodo.resultadosPorEmpleado!)
        .map(([empId, res]) => {
          const emp = empleados.find(e => e.id === empId)
          return emp ? { emp, res } : null
        })
        .filter((x): x is { emp: Empleado; res: ResultadoNomina } => x !== null)
    }
    const activos = empleados.filter(e => e.activo)
    return activos.map(emp => {
      const ajustes: AjusteLinea[] = periodo.ajustesPorEmpleado?.[emp.id] ?? []
      const res = calcularConPeriodo(emp, ajustes, periodo)
      return { emp, res }
    })
  }, [periodo, generado, empleados])

  const filasVisible = useMemo(() => {
    if (!searchQ.trim()) return filas
    const q = searchQ.toLowerCase()
    return filas.filter(({ emp }) =>
      fullName(emp).toLowerCase().includes(q) ||
      emp.cargo.toLowerCase().includes(q) ||
      emp.departamento.toLowerCase().includes(q)
    )
  }, [filas, searchQ])

  const totales = useMemo(() => filas.reduce((acc, { res }) => ({
    bruto:          acc.bruto          + res.totalBruto,
    afpEmp:         acc.afpEmp         + res.afpEmpleado,
    sfsEmp:         acc.sfsEmp         + res.sfsEmpleado,
    isr:            acc.isr            + res.isrMensual,
    descuentos:     acc.descuentos     + res.totalDescuentos,
    neto:           acc.neto           + res.salarioNeto,
    afpEmpl:        acc.afpEmpl        + res.afpEmpleador,
    sfsEmpl:        acc.sfsEmpl        + res.sfsEmpleador,
    srlEmpl:        acc.srlEmpl        + res.srlEmpleador,
    infotepEmpl:    acc.infotepEmpl    + res.infotepEmpleador,
    costo:          acc.costo          + res.totalCostoEmpleador,
  }), { bruto: 0, afpEmp: 0, sfsEmp: 0, isr: 0, descuentos: 0, neto: 0, afpEmpl: 0, sfsEmpl: 0, srlEmpl: 0, infotepEmpl: 0, costo: 0 }), [filas])

  function generar() {
    setLoading(true)
    setTimeout(() => { setLoading(false); setGenerado(true) }, 100)
  }

  function exportarPDF() {
    if (!periodo || filas.length === 0) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pdfHeader(doc, empresa, 'Reporte de Nómina por Período', periodoLabel(periodo))

    autoTable(doc, {
      startY: 44,
      head: [['Nombre','Cargo','Bruto','AFP Emp.','SFS Emp.','ISR','Tot. Desc.','Neto','AFP Empl.','SFS Empl.','SRL','Infotep','Costo Total']],
      body: filas.map(({ emp, res }) => [
        fullName(emp), emp.cargo,
        res.totalBruto.toFixed(2),
        res.afpEmpleado.toFixed(2),
        res.sfsEmpleado.toFixed(2),
        res.isrMensual.toFixed(2),
        res.totalDescuentos.toFixed(2),
        res.salarioNeto.toFixed(2),
        res.afpEmpleador.toFixed(2),
        res.sfsEmpleador.toFixed(2),
        res.srlEmpleador.toFixed(2),
        res.infotepEmpleador.toFixed(2),
        res.totalCostoEmpleador.toFixed(2),
      ]),
      foot: [[
        'TOTALES', '',
        totales.bruto.toFixed(2),
        totales.afpEmp.toFixed(2),
        totales.sfsEmp.toFixed(2),
        totales.isr.toFixed(2),
        totales.descuentos.toFixed(2),
        totales.neto.toFixed(2),
        totales.afpEmpl.toFixed(2),
        totales.sfsEmpl.toFixed(2),
        totales.srlEmpl.toFixed(2),
        totales.infotepEmpl.toFixed(2),
        totales.costo.toFixed(2),
      ]],
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 7 },
      footStyles: { fillColor: [240, 240, 240], textColor: NAVY, fontStyle: 'bold', fontSize: 7 },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 40 },
        2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
        8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' },
        11: { halign: 'right' }, 12: { halign: 'right' },
      },
      didDrawPage: (data) => {
        doc.setFontSize(7)
        doc.setTextColor(150)
        doc.text(`Página ${data.pageNumber}`, 283, 205, { align: 'right' })
      },
    })

    doc.save(`nomina-${periodoLabel(periodo).replace(/\s+/g, '-').toLowerCase()}.pdf`)
  }

  function exportarXlsx() {
    if (!periodo || filas.length === 0) return
    exportarExcel({
      nombreArchivo: `nomina-${periodoLabel(periodo).replace(/\s+/g, '-').toLowerCase()}`,
      empresa: empresa.nombre, logo: empresa.logo,
      rnc: empresa.rnc,
      hojas: [{
        nombre: 'Nómina',
        titulo: 'Reporte de Nómina por Período',
        subtitulo: periodoLabel(periodo),
        encabezados: ['Nombre','Cargo','Bruto','AFP Emp.','SFS Emp.','ISR','Tot. Desc.','Neto','AFP Empl.','SFS Empl.','SRL','Infotep','Costo Total'],
        filas: filas.map(({ emp, res }) => [
          fullName(emp), emp.cargo,
          res.totalBruto, res.afpEmpleado, res.sfsEmpleado, res.isrMensual,
          res.totalDescuentos, res.salarioNeto, res.afpEmpleador, res.sfsEmpleador,
          res.srlEmpleador, res.infotepEmpleador, res.totalCostoEmpleador,
        ]),
        totales: ['TOTALES','', totales.bruto, totales.afpEmp, totales.sfsEmp, totales.isr,
          totales.descuentos, totales.neto, totales.afpEmpl, totales.sfsEmpl, totales.srlEmpl, totales.infotepEmpl, totales.costo],
        anchos: [32, 22, 16, 14, 14, 14, 14, 16, 14, 14, 12, 12, 16],
      }],
    })
  }

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Nómina por Período"
        desc="Detalle completo de ingresos, descuentos y aportes por empleado para el período seleccionado."
        onPDF={filas.length > 0 ? exportarPDF : undefined}
        onExcel={filas.length > 0 ? exportarXlsx : undefined}
      />

      {/* Filter bar */}
      <FilterBar>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Período:
          <select
            value={periodoId}
            onChange={e => { setPeriodoId(e.target.value); setGenerado(false) }}
            className={selectCls}
          >
            {sorted.length === 0
              ? <option value="">Sin períodos</option>
              : sorted.map(p => <option key={p.id} value={p.id}>{periodoLabel(p)}</option>)
            }
          </select>
        </label>
        <button onClick={generar} disabled={!periodoId || loading} className={primaryBtn}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
          Generar
        </button>
      </FilterBar>

      {!generado ? (
        <EmptyState message="Selecciona un período y haz clic en Generar para ver el reporte." />
      ) : filas.length === 0 ? (
        <EmptyState message="No hay empleados activos para este período." />
      ) : (
        <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
          <div className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] px-5 py-2.5 flex items-center gap-2">
            <Search className="h-4 w-4 text-zinc-400 shrink-0" />
            <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Buscar por nombre, cargo o departamento…" className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none" />
            <span className="text-xs text-zinc-400 shrink-0">{filasVisible.length}/{filas.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] text-right">
                  <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Nombre</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Cargo</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Sal. Bruto</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-rose-500 dark:text-rose-400 whitespace-nowrap">AFP Emp.</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-rose-500 dark:text-rose-400 whitespace-nowrap">SFS Emp.</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-violet-500 dark:text-violet-400">ISR</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-rose-500 dark:text-rose-400 whitespace-nowrap">Tot. Desc.</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-emerald-600 dark:text-emerald-400 whitespace-nowrap">Sal. Neto</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-amber-600 dark:text-amber-400 whitespace-nowrap">AFP Empl.</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-amber-600 dark:text-amber-400 whitespace-nowrap">SFS Empl.</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-amber-600 dark:text-amber-400">SRL</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-amber-600 dark:text-amber-400 whitespace-nowrap">Infotep</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-indigo-600 dark:text-indigo-400 whitespace-nowrap">Costo Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                {filasVisible.map(({ emp, res }) => (
                  <tr key={emp.id} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors text-right">
                    <td className="px-5 py-3 text-left">
                      <p className="font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{fullName(emp)}</p>
                    </td>
                    <td className="px-4 py-3 text-left text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{emp.cargo}</td>
                    <td className="px-4 py-3 tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{formatRD(res.totalBruto)}</td>
                    <td className="px-4 py-3 tabular-nums text-rose-700 dark:text-rose-400 whitespace-nowrap">{formatRD(res.afpEmpleado)}</td>
                    <td className="px-4 py-3 tabular-nums text-rose-700 dark:text-rose-400 whitespace-nowrap">{formatRD(res.sfsEmpleado)}</td>
                    <td className="px-4 py-3 tabular-nums text-violet-700 dark:text-violet-400 whitespace-nowrap">{formatRD(res.isrMensual)}</td>
                    <td className="px-4 py-3 tabular-nums text-rose-800 dark:text-rose-300 font-medium whitespace-nowrap">{formatRD(res.totalDescuentos)}</td>
                    <td className="px-4 py-3 tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap">{formatRD(res.salarioNeto)}</td>
                    <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-400 whitespace-nowrap">{formatRD(res.afpEmpleador)}</td>
                    <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-400 whitespace-nowrap">{formatRD(res.sfsEmpleador)}</td>
                    <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-400 whitespace-nowrap">{formatRD(res.srlEmpleador)}</td>
                    <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-400 whitespace-nowrap">{formatRD(res.infotepEmpleador)}</td>
                    <td className="px-4 py-3 tabular-nums text-indigo-700 dark:text-indigo-400 font-semibold whitespace-nowrap">{formatRD(res.totalCostoEmpleador)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#c7cef0] dark:border-[#2e2e2e] bg-[#eef0fb] dark:bg-[#262626] text-[#1B2980] dark:text-indigo-300 font-bold text-right">
                  <td colSpan={2} className="px-5 py-3 text-left text-xs uppercase tracking-wide">TOTALES ({filasVisible.length} empleados)</td>
                  <td className="px-4 py-3 tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{formatRD(totales.bruto)}</td>
                  <td className="px-4 py-3 tabular-nums text-rose-700 dark:text-rose-300 whitespace-nowrap">{formatRD(totales.afpEmp)}</td>
                  <td className="px-4 py-3 tabular-nums text-rose-700 dark:text-rose-300 whitespace-nowrap">{formatRD(totales.sfsEmp)}</td>
                  <td className="px-4 py-3 tabular-nums text-violet-700 dark:text-violet-300 whitespace-nowrap">{formatRD(totales.isr)}</td>
                  <td className="px-4 py-3 tabular-nums text-rose-800 dark:text-rose-200 whitespace-nowrap">{formatRD(totales.descuentos)}</td>
                  <td className="px-4 py-3 tabular-nums text-emerald-700 dark:text-emerald-300 whitespace-nowrap">{formatRD(totales.neto)}</td>
                  <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-300 whitespace-nowrap">{formatRD(totales.afpEmpl)}</td>
                  <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-300 whitespace-nowrap">{formatRD(totales.sfsEmpl)}</td>
                  <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-300 whitespace-nowrap">{formatRD(totales.srlEmpl)}</td>
                  <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-300 whitespace-nowrap">{formatRD(totales.infotepEmpl)}</td>
                  <td className="px-4 py-3 tabular-nums text-indigo-700 dark:text-indigo-300 whitespace-nowrap">{formatRD(totales.costo)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
