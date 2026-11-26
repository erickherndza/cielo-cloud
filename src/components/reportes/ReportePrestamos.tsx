'use client'

import { useState, useMemo } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { usePrestamos } from '@/lib/prestamos-context'
import { formatRD, formatDate, fullName } from '@/lib/utils'
import { exportarExcel } from '@/lib/excel-export'
import type { Empresa, Empleado } from '@/types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NAVY, pdfHeader, selectCls, primaryBtn, FilterBar, ReportHeader } from './shared'

// ─── Reporte Préstamos ────────────────────────────────────────────────────────
export function ReportePrestamos({
  empresa, empleados, prestamos,
}: {
  empresa: Empresa
  empleados: ReturnType<typeof useEmpleados>['empleados']
  prestamos: ReturnType<typeof usePrestamos>['prestamos']
}) {
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'activo' | 'pagado' | 'cancelado'>('todos')
  const [generado, setGenerado] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  const empMap = useMemo(() =>
    Object.fromEntries(empleados.map(e => [e.id, e])),
    [empleados]
  )

  const filas = useMemo(() => {
    if (!generado) return []
    return prestamos.filter(p =>
      filtroEstado === 'todos' || p.estado === filtroEstado
    )
  }, [generado, prestamos, filtroEstado])

  const filasVisible = useMemo(() => {
    if (!searchQ.trim()) return filas
    const q = searchQ.toLowerCase()
    return filas.filter(p => {
      const emp = empMap[p.empleadoId]
      return emp ? fullName(emp).toLowerCase().includes(q) : false
    })
  }, [filas, searchQ, empMap])

  const summary = useMemo(() => filas.reduce((acc, p) => ({
    totalMonto:  acc.totalMonto  + p.monto,
    totalSaldo:  acc.totalSaldo  + p.saldoPendiente,
    totalCuotas: acc.totalCuotas + (p.estado === 'activo' ? p.cuotaBase : 0),
  }), { totalMonto: 0, totalSaldo: 0, totalCuotas: 0 }), [filas])

  function exportarPDF() {
    if (filas.length === 0) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pdfHeader(doc, empresa, 'Reporte de Préstamos', `Estado: ${filtroEstado}`)

    autoTable(doc, {
      startY: 44,
      head: [['Empleado','Monto Orig.','Saldo Pend.','% Pagado','Cuota','Frecuencia','Otorgamiento','Estado']],
      body: filas.map(p => {
        const emp = empMap[p.empleadoId]
        const pct = ((p.monto - p.saldoPendiente) / p.monto * 100).toFixed(1)
        return [
          emp ? fullName(emp) : p.empleadoId,
          p.monto.toFixed(2),
          p.saldoPendiente.toFixed(2),
          `${pct}%`,
          p.cuotaBase.toFixed(2),
          p.frecuencia === 'mensual' ? 'Mensual' : 'Quincenal',
          formatDate(p.fechaOtorgamiento),
          p.estado.charAt(0).toUpperCase() + p.estado.slice(1),
        ]
      }),
      foot: [['TOTALES', summary.totalMonto.toFixed(2), summary.totalSaldo.toFixed(2),
        '', summary.totalCuotas.toFixed(2), '', '', '']],
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      footStyles: { fillColor: [240, 240, 240], textColor: NAVY, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        1: { halign: 'right' }, 2: { halign: 'right' },
        3: { halign: 'center' }, 4: { halign: 'right' },
        5: { halign: 'center' }, 6: { halign: 'center' }, 7: { halign: 'center' },
      },
      didDrawPage: (data) => {
        doc.setFontSize(7); doc.setTextColor(150)
        doc.text(`Página ${data.pageNumber}`, 283, 205, { align: 'right' })
      },
    })
    doc.save('reporte-prestamos.pdf')
  }

  function exportarXlsx() {
    if (filas.length === 0) return
    exportarExcel({
      nombreArchivo: 'reporte-prestamos',
      empresa: empresa.nombre, logo: empresa.logo,
      rnc: empresa.rnc,
      hojas: [{
        nombre: 'Préstamos',
        titulo: 'Reporte de Préstamos',
        subtitulo: `Estado: ${filtroEstado}`,
        encabezados: ['Empleado','Monto Orig.','Saldo Pend.','% Pagado','Cuota','Frecuencia','Otorgamiento','Estado'],
        filas: filas.map(p => {
          const emp = empMap[p.empleadoId]
          const pct = +((p.monto - p.saldoPendiente) / p.monto * 100).toFixed(1)
          return [
            emp ? fullName(emp) : p.empleadoId,
            p.monto, p.saldoPendiente, pct, p.cuotaBase,
            p.frecuencia === 'mensual' ? 'Mensual' : 'Quincenal',
            formatDate(p.fechaOtorgamiento),
            p.estado.charAt(0).toUpperCase() + p.estado.slice(1),
          ]
        }),
        totales: ['TOTALES', summary.totalMonto, summary.totalSaldo, '', summary.totalCuotas, '', '', ''],
        anchos: [30, 16, 16, 12, 14, 14, 16, 14],
      }],
    })
  }

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Reporte de Préstamos"
        desc="Cartera de préstamos empleados: saldos, cuotas y estado de pago."
        onPDF={filas.length > 0 ? exportarPDF : undefined}
        onExcel={filas.length > 0 ? exportarXlsx : undefined}
      />

      <FilterBar>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Estado:
          <select value={filtroEstado} onChange={e => { setFiltroEstado(e.target.value as typeof filtroEstado); setGenerado(false) }} className={selectCls}>
            <option value="todos">Todos</option>
            <option value="activo">Activo</option>
            <option value="pagado">Pagado</option>
            <option value="cancelado">Cancelado</option>
          </select>
        </label>
        <button onClick={() => { setGenerado(true); setSearchQ('') }} className={primaryBtn}>
          <ChevronRight className="h-4 w-4" /> Generar
        </button>
      </FilterBar>

      {!generado ? (
        <EmptyState message="Selecciona un estado y haz clic en Generar para ver el reporte." />
      ) : filas.length === 0 ? (
        <EmptyState message="No hay préstamos que coincidan con el filtro seleccionado." />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Total Montos Otorgados</p>
              <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{formatRD(summary.totalMonto)}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Total Saldo Pendiente</p>
              <p className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-400 tabular-nums">{formatRD(summary.totalSaldo)}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Cuotas Mensuales Activas</p>
              <p className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">{formatRD(summary.totalCuotas)}</p>
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
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Monto Orig.</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Saldo Pend.</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">% Pagado</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Cuota</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Frecuencia</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Otorgamiento</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                  {filasVisible.map(p => {
                    const emp = empMap[p.empleadoId]
                    const pct = (p.monto - p.saldoPendiente) / p.monto * 100
                    return (
                      <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                        <td className="px-5 py-3">
                          <p className="font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                            {emp ? fullName(emp) : 'Empleado eliminado'}
                          </p>
                          {emp && <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{emp.cargo}</p>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{formatRD(p.monto)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-rose-700 dark:text-rose-400 font-medium whitespace-nowrap">{formatRD(p.saldoPendiente)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-[#2e2e2e] overflow-hidden min-w-[60px]">
                              <div
                                className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400 shrink-0">{pct.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{formatRD(p.cuotaBase)}</td>
                        <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 capitalize">{p.frecuencia}</td>
                        <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{formatDate(p.fechaOtorgamiento)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
                            p.estado === 'activo'
                              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:ring-emerald-800/50'
                              : p.estado === 'pagado'
                              ? 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400 dark:ring-indigo-800/50'
                              : 'bg-zinc-50 text-zinc-700 ring-zinc-200 dark:bg-[#262626] dark:text-zinc-400 dark:ring-[#2e2e2e]'
                          }`}>
                            {p.estado.charAt(0).toUpperCase() + p.estado.slice(1)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
