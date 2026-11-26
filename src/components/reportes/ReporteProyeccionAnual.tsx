'use client'

import { useState, useMemo } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { calcularNomina } from '@/lib/dominican-labor'
import { formatRD, fullName } from '@/lib/utils'
import { exportarExcel } from '@/lib/excel-export'
import type { PeriodoNomina, Empresa, Empleado } from '@/types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NAVY, pdfHeader, resultadoHistorico, primaryBtn, FilterBar, ReportHeader } from './shared'

// ─── Reporte Proyección Anual ─────────────────────────────────────────────────
export function ReporteProyeccionAnual({
  empresa, empleados, periodos,
}: {
  empresa: Empresa
  empleados: ReturnType<typeof useEmpleados>['empleados']
  periodos: PeriodoNomina[]
}) {
  const currentYear = new Date().getFullYear()
  const [generado, setGenerado] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  // Recorre los empleados REALMENTE incluidos en cada período (snapshot
  // resultadosPorEmpleado si existe, o todos los activos como respaldo para
  // períodos anteriores a ese campo) — NO las claves de ajustesPorEmpleado,
  // que solo contienen a quien tuvo al menos un ajuste (préstamo, bono, etc.)
  // ese período. Un empleado con nómina plana (sin ningún ajuste, el caso más
  // común) no aparece en ajustesPorEmpleado y quedaba excluido por completo
  // del costo YTD real, subestimando el % Ejecutado de la proyección.
  const ytdCostoPorEmp = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of periodos.filter(p => p.anio === currentYear && p.estado !== 'en_proceso')) {
      const idsDelPeriodo = p.resultadosPorEmpleado && Object.keys(p.resultadosPorEmpleado).length > 0
        ? Object.keys(p.resultadosPorEmpleado)
        : empleados.filter(e => e.activo).map(e => e.id)
      for (const empId of idsDelPeriodo) {
        const emp = empleados.find(e => e.id === empId)
        if (!emp) continue
        const res = resultadoHistorico(emp, p)
        map[empId] = (map[empId] ?? 0) + res.totalCostoEmpleador
      }
    }
    return map
  }, [periodos, empleados, currentYear])

  const filas = useMemo(() => {
    if (!generado) return []
    return empleados.filter(e => e.activo).map(emp => {
      const res = calcularNomina(emp, {})
      const brutoAnual      = res.salarioBruto * 12
      const costoMensual    = res.totalCostoEmpleador
      const regalia         = res.regaliaPascual * 12
      const vacaciones      = res.vacacionesMensualesValor * 12
      const totalProyectado = costoMensual * 12 + regalia + vacaciones
      const ytdReal         = ytdCostoPorEmp[emp.id] ?? 0
      const pctEjecutado    = totalProyectado > 0 ? ytdReal / totalProyectado * 100 : 0
      return { emp, brutoAnual, costoMensual, regalia, vacaciones, totalProyectado, ytdReal, pctEjecutado }
    }).sort((a, b) => b.totalProyectado - a.totalProyectado)
  }, [generado, empleados, ytdCostoPorEmp])

  const filasVisible = useMemo(() => {
    if (!searchQ.trim()) return filas
    const q = searchQ.toLowerCase()
    return filas.filter(({ emp }) =>
      fullName(emp).toLowerCase().includes(q) ||
      emp.cargo.toLowerCase().includes(q) ||
      emp.departamento.toLowerCase().includes(q)
    )
  }, [filas, searchQ])

  const totales = useMemo(() => {
    const base = filas.reduce((acc, r) => ({
      brutoAnual: acc.brutoAnual + r.brutoAnual,
      regalia: acc.regalia + r.regalia,
      vacaciones: acc.vacaciones + r.vacaciones,
      totalProyectado: acc.totalProyectado + r.totalProyectado,
      ytdReal: acc.ytdReal + r.ytdReal,
    }), { brutoAnual: 0, regalia: 0, vacaciones: 0, totalProyectado: 0, ytdReal: 0 })
    // El costo YTD real de empleados que ya NO están activos (liquidados
    // durante el año en curso) también es gasto genuinamente ejecutado —
    // se suma aparte porque esos empleados no tienen fila propia en `filas`
    // (no hay "hacia adelante" que proyectar para alguien que ya se fue),
    // pero antes se omitía por completo de "Ejecutado YTD", subestimando el
    // gasto real cada vez que hubo rotación durante el año.
    const idsEnFilas = new Set(filas.map(f => f.emp.id))
    const ytdFueraDePlantilla = Object.entries(ytdCostoPorEmp)
      .filter(([id]) => !idsEnFilas.has(id))
      .reduce((s, [, monto]) => s + monto, 0)
    return { ...base, ytdReal: base.ytdReal + ytdFueraDePlantilla, ytdRealFueraDePlantilla: ytdFueraDePlantilla }
  }, [filas, ytdCostoPorEmp])

  function exportarPDF() {
    if (filas.length === 0) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pdfHeader(doc, empresa, 'Proyección Anual de Nómina', `Año ${currentYear}`)
    autoTable(doc, {
      startY: 44,
      head: [['Empleado','Cargo','Sal. Base','Bruto × 12','Regalía','Vacaciones','Costo Total Proy.','YTD Real','% Ejec.']],
      body: filas.map(r => [
        fullName(r.emp), r.emp.cargo, formatRD(r.emp.salarioBase),
        formatRD(r.brutoAnual), formatRD(r.regalia), formatRD(r.vacaciones),
        formatRD(r.totalProyectado), formatRD(r.ytdReal), `${r.pctEjecutado.toFixed(1)}%`,
      ]),
      foot: [['TOTALES', '', '', formatRD(totales.brutoAnual), formatRD(totales.regalia), formatRD(totales.vacaciones), formatRD(totales.totalProyectado), formatRD(totales.ytdReal), '']],
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 7 },
      footStyles: { fillColor: [240, 240, 240], textColor: NAVY, fontStyle: 'bold', fontSize: 7 },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'center' } },
      didDrawPage: (data) => { doc.setFontSize(7); doc.setTextColor(150); doc.text(`Página ${data.pageNumber}`, 283, 205, { align: 'right' }) },
    })
    doc.save(`proyeccion-anual-${currentYear}.pdf`)
  }

  function exportarXlsx() {
    if (filas.length === 0) return
    exportarExcel({
      nombreArchivo: `proyeccion-anual-${currentYear}`,
      empresa: empresa.nombre, logo: empresa.logo, rnc: empresa.rnc,
      hojas: [{
        nombre: 'Proyección', titulo: 'Proyección Anual de Nómina', subtitulo: `Año ${currentYear}`,
        encabezados: ['Empleado','Cargo','Departamento','Sal. Base','Bruto × 12','Regalía Proy.','Vacaciones Proy.','Costo Total Proy.','YTD Real','% Ejecutado'],
        filas: filas.map(r => [fullName(r.emp), r.emp.cargo, r.emp.departamento, r.emp.salarioBase, r.brutoAnual, r.regalia, r.vacaciones, r.totalProyectado, r.ytdReal, `${r.pctEjecutado.toFixed(1)}%`]),
        totales: ['TOTALES','','', '', totales.brutoAnual, totales.regalia, totales.vacaciones, totales.totalProyectado, totales.ytdReal, ''],
        anchos: [28, 22, 20, 16, 18, 16, 16, 18, 16, 14],
      }],
    })
  }

  return (
    <div className="space-y-5">
      <ReportHeader title="Proyección Anual" desc={`Costo laboral proyectado para ${currentYear} (incluyendo regalía y vacaciones) vs. ejecutado YTD.`} onPDF={filas.length > 0 ? exportarPDF : undefined} onExcel={filas.length > 0 ? exportarXlsx : undefined} />
      <FilterBar>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">Proyección para el año fiscal <strong className="text-zinc-800 dark:text-zinc-200">{currentYear}</strong></span>
        <button onClick={() => { setGenerado(true); setSearchQ('') }} className={primaryBtn}>
          <ChevronRight className="h-4 w-4" /> Generar
        </button>
      </FilterBar>
      {!generado ? <EmptyState message="Haz clic en Generar para calcular la proyección del año en curso." /> : filas.length === 0 ? <EmptyState message="No hay empleados activos." /> : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Empleados en Proyección</p>
              <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{filas.length}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Costo Total Proyectado</p>
              <p className="mt-1 text-xl font-bold text-indigo-700 dark:text-indigo-400 tabular-nums">{formatRD(totales.totalProyectado)}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Ejecutado YTD</p>
              <p className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{formatRD(totales.ytdReal)}</p>
              {totales.ytdRealFueraDePlantilla > 0 && (
                <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                  Incluye {formatRD(totales.ytdRealFueraDePlantilla)} de empleados ya liquidados este año
                </p>
              )}
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">% Ejecutado</p>
              <p className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                {totales.totalProyectado > 0 ? (totales.ytdReal / totales.totalProyectado * 100).toFixed(1) : '0.0'}%
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
            <div className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] px-5 py-2.5 flex items-center gap-2">
              <Search className="h-4 w-4 text-zinc-400 shrink-0" />
              <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Buscar por nombre, cargo o departamento…" className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none" />
              <span className="text-xs text-zinc-400 shrink-0">{filasVisible.length}/{filas.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] text-left">
                    {['Empleado','Cargo','Sal. Base','Bruto × 12','Regalía','Vacaciones','Total Proyectado','YTD Real','% Ejec.'].map(h => (
                      <th key={h} className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap last:text-center text-right first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                  {filasVisible.map(({ emp, brutoAnual, regalia, vacaciones, totalProyectado, ytdReal, pctEjecutado }) => (
                    <tr key={emp.id} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{fullName(emp)}</p>
                        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{emp.departamento}</p>
                      </td>
                      <td className="px-5 py-3 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{emp.cargo}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{formatRD(emp.salarioBase)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{formatRD(brutoAnual)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-amber-700 dark:text-amber-400 whitespace-nowrap">{formatRD(regalia)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-amber-700 dark:text-amber-400 whitespace-nowrap">{formatRD(vacaciones)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-indigo-700 dark:text-indigo-400 font-semibold whitespace-nowrap">{formatRD(totalProyectado)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400 whitespace-nowrap">{formatRD(ytdReal)}</td>
                      <td className="px-5 py-3 text-center">
                        <div className="flex items-center gap-1.5 justify-end">
                          <div className="w-14 h-1.5 rounded-full bg-zinc-100 dark:bg-[#2e2e2e] overflow-hidden">
                            <div className={`h-full rounded-full ${pctEjecutado >= 90 ? 'bg-emerald-500' : pctEjecutado >= 50 ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min(100, pctEjecutado)}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400 shrink-0">{pctEjecutado.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#c7cef0] dark:border-[#2e2e2e] bg-[#eef0fb] dark:bg-[#262626] text-[#1B2980] dark:text-indigo-300 font-bold text-right">
                    <td colSpan={3} className="px-5 py-3 text-left text-xs uppercase tracking-wide">TOTALES ({filasVisible.length} empleados)</td>
                    <td className="px-5 py-3 tabular-nums whitespace-nowrap">{formatRD(totales.brutoAnual)}</td>
                    <td className="px-5 py-3 tabular-nums text-amber-700 dark:text-amber-300 whitespace-nowrap">{formatRD(totales.regalia)}</td>
                    <td className="px-5 py-3 tabular-nums text-amber-700 dark:text-amber-300 whitespace-nowrap">{formatRD(totales.vacaciones)}</td>
                    <td className="px-5 py-3 tabular-nums text-indigo-700 dark:text-indigo-300 whitespace-nowrap">{formatRD(totales.totalProyectado)}</td>
                    <td className="px-5 py-3 tabular-nums text-emerald-700 dark:text-emerald-300 whitespace-nowrap">{formatRD(totales.ytdReal)}</td>
                    <td className="px-5 py-3 text-center text-xs">
                      {totales.totalProyectado > 0 ? `${(totales.ytdReal / totales.totalProyectado * 100).toFixed(1)}%` : '—'}
                    </td>
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
