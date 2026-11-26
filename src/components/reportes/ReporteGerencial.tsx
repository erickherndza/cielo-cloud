'use client'

import { useMemo } from 'react'
import { Users, TrendingUp, Wallet, Building2, Receipt, Briefcase } from 'lucide-react'
import { StatCard } from '@/components/ui/StatCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { formatRD } from '@/lib/utils'
import { exportarExcel } from '@/lib/excel-export'
import type { PeriodoNomina, Empresa, Empleado } from '@/types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NAVY, pdfHeader, periodoLabel, resultadoHistorico, ReportHeader } from './shared'

// ─── Reporte Gerencial ────────────────────────────────────────────────────────
export function ReporteGerencial({
  empresa, empleados, periodos,
}: {
  empresa: Empresa
  empleados: ReturnType<typeof useEmpleados>['empleados']
  periodos: PeriodoNomina[]
}) {
  const activos = empleados.filter(e => e.activo)
  const currentYear = new Date().getFullYear()

  const sortedPeriodos = useMemo(() =>
    [...periodos].filter(p => p.estado !== 'en_proceso' && p.tipo !== 'regalia' && p.tipo !== 'bonificacion').sort((a, b) => new Date(b.fechaGeneracion).getTime() - new Date(a.fechaGeneracion).getTime()),
    [periodos]
  )
  const ultimoPeriodo = sortedPeriodos[0]

  const kpis = useMemo(() => {
    if (!ultimoPeriodo) return null
    const t = ultimoPeriodo.totales
    return {
      empleados: activos.length,
      bruto:     t.bruto,
      neto:      t.neto,
      isr:       t.isr,
      aportes:   t.aportes,
      costo:     t.costoTotal,
    }
  }, [ultimoPeriodo, activos.length])

  const ultimos6 = useMemo(() => sortedPeriodos.slice(0, 6), [sortedPeriodos])

  // YTD: acumulado del año en curso
  const ytd = useMemo(() => {
    const yearPeriods = periodos.filter(p => p.anio === currentYear && p.estado !== 'en_proceso')
    return yearPeriods.reduce(
      (acc, p) => ({
        bruto:    acc.bruto    + p.totales.bruto,
        neto:     acc.neto     + p.totales.neto,
        isr:      acc.isr      + p.totales.isr,
        aportes:  acc.aportes  + p.totales.aportes,
        costo:    acc.costo    + p.totales.costoTotal,
        periodos: acc.periodos + 1,
      }),
      { bruto: 0, neto: 0, isr: 0, aportes: 0, costo: 0, periodos: 0 },
    )
  }, [periodos, currentYear])

  // Desglose por departamento del último período — usa los empleados
  // REALMENTE incluidos en ese período (vía el snapshot resultadosPorEmpleado),
  // no `activos` (empleados activos AHORA). Si alguien fue procesado en ese
  // período pero luego se desvinculó/desactivó, `activos` lo excluiría por
  // completo, dejando el desglose por debajo del "Costo Total Empresa" del
  // KPI de arriba (que sí lee ultimoPeriodo.totales, con todos incluidos) —
  // dos números que deberían coincidir en la misma pantalla. Solo cae de
  // vuelta a `activos` para períodos anteriores al snapshot (sin registro
  // de quién participó).
  const desglose = useMemo(() => {
    if (!ultimoPeriodo) return []
    const idsDelPeriodo = ultimoPeriodo.resultadosPorEmpleado
      ? Object.keys(ultimoPeriodo.resultadosPorEmpleado)
      : null
    const empleadosDelPeriodo = idsDelPeriodo && idsDelPeriodo.length > 0
      ? idsDelPeriodo.map(id => empleados.find(e => e.id === id)).filter((e): e is Empleado => !!e)
      : activos
    const groups: Record<string, { bruto: number; neto: number; costo: number; headcount: number }> = {}
    for (const emp of empleadosDelPeriodo) {
      const res = resultadoHistorico(emp, ultimoPeriodo)
      const d = emp.departamento || 'Sin Departamento'
      if (!groups[d]) groups[d] = { bruto: 0, neto: 0, costo: 0, headcount: 0 }
      groups[d].bruto    += res.totalBruto
      groups[d].neto     += res.salarioNeto
      groups[d].costo    += res.totalCostoEmpleador
      groups[d].headcount++
    }
    const grandTotal = Object.values(groups).reduce((s, g) => s + g.costo, 0)
    return Object.entries(groups)
      .map(([depto, g]) => ({ depto, ...g, pct: grandTotal > 0 ? g.costo / grandTotal * 100 : 0 }))
      .sort((a, b) => b.costo - a.costo)
  }, [ultimoPeriodo, activos, empleados])

  function exportarPDF() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pdfHeader(doc, empresa, 'Resumen Gerencial', 'Indicadores clave de nómina')
    const type = doc as jsPDF & { lastAutoTable: { finalY: number } }

    if (kpis) {
      autoTable(doc, {
        startY: 44,
        head: [['Indicador', 'Valor']],
        body: [
          ['Total Empleados Activos', `${kpis.empleados}`],
          ['Nómina Bruta (último período)', formatRD(kpis.bruto)],
          ['Nómina Neta (último período)', formatRD(kpis.neto)],
          ['ISR Total Retenido', formatRD(kpis.isr)],
          ['Aportes Empleador TSS', formatRD(kpis.aportes)],
          ['Costo Total Empresa', formatRD(kpis.costo)],
        ],
        theme: 'striped',
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 9 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: { 0: { cellWidth: 80 }, 1: { halign: 'right' } },
        tableWidth: 130,
      })
    }

    const after1 = type.lastAutoTable?.finalY ?? 44
    autoTable(doc, {
      startY: after1 + 10,
      head: [['Período', 'Empleados', 'Bruto', 'Descuentos', 'Neto', 'Δ Neto', 'Costo Total']],
      body: ultimos6.map((p, i) => {
        const delta = i < ultimos6.length - 1
          ? ((p.totales.neto - ultimos6[i + 1].totales.neto) / ultimos6[i + 1].totales.neto * 100)
          : null
        return [
          periodoLabel(p), `${p.totalEmpleados}`,
          formatRD(p.totales.bruto), formatRD(p.totales.descuentos),
          formatRD(p.totales.neto),
          delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
          formatRD(p.totales.costoTotal),
        ]
      }),
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'center' }, 6: { halign: 'right' } },
      didDrawPage: (data) => { doc.setFontSize(7); doc.setTextColor(150); doc.text(`Página ${data.pageNumber}`, 283, 205, { align: 'right' }) },
    })

    if (desglose.length > 0) {
      const after2 = type.lastAutoTable?.finalY ?? 44
      autoTable(doc, {
        startY: after2 + 10,
        head: [['Departamento', 'Empleados', 'Sal. Bruto', 'Sal. Neto', 'Costo Total', '% del Total']],
        body: desglose.map(d => [d.depto, `${d.headcount}`, formatRD(d.bruto), formatRD(d.neto), formatRD(d.costo), `${d.pct.toFixed(1)}%`]),
        theme: 'striped',
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'center' } },
        didDrawPage: (data) => { doc.setFontSize(7); doc.setTextColor(150); doc.text(`Página ${data.pageNumber}`, 283, 205, { align: 'right' }) },
      })
    }

    doc.save('resumen-gerencial.pdf')
  }

  function exportarXlsx() {
    exportarExcel({
      nombreArchivo: 'resumen-gerencial',
      empresa: empresa.nombre, logo: empresa.logo,
      rnc: empresa.rnc,
      hojas: [
        {
          nombre: 'KPIs',
          titulo: 'Resumen Gerencial — KPIs',
          encabezados: ['Indicador', 'Valor'],
          filas: kpis ? [
            ['Total Empleados Activos', kpis.empleados],
            ['Nómina Bruta (último período)', kpis.bruto],
            ['Nómina Neta (último período)', kpis.neto],
            ['ISR Total Retenido', kpis.isr],
            ['Aportes Empleador TSS', kpis.aportes],
            ['Costo Total Empresa', kpis.costo],
          ] : [],
          anchos: [40, 20],
        },
        {
          nombre: 'Acumulado YTD',
          titulo: `Acumulado Año en Curso ${currentYear}`,
          subtitulo: `${ytd.periodos} período(s) procesados`,
          encabezados: ['Indicador', 'Valor YTD'],
          filas: [
            ['Nómina Bruta YTD', ytd.bruto],
            ['Nómina Neta YTD', ytd.neto],
            ['ISR Retenido YTD', ytd.isr],
            ['TSS Empleador YTD', ytd.aportes],
            ['Costo Total YTD', ytd.costo],
          ],
          anchos: [36, 22],
        },
        {
          nombre: 'Histórico',
          titulo: 'Últimos 6 Períodos',
          encabezados: ['Período', 'Empleados', 'Bruto', 'Descuentos', 'Neto', 'Δ Neto', 'Costo Total'],
          filas: ultimos6.map((p, i) => {
            const delta = i < ultimos6.length - 1
              ? ((p.totales.neto - ultimos6[i + 1].totales.neto) / ultimos6[i + 1].totales.neto * 100)
              : null
            return [periodoLabel(p), p.totalEmpleados, p.totales.bruto, p.totales.descuentos, p.totales.neto, delta !== null ? `${delta.toFixed(1)}%` : '—', p.totales.costoTotal]
          }),
          anchos: [30, 14, 18, 18, 18, 12, 18],
          columnasEnteras: [1],
        },
        ...(desglose.length > 0 ? [{
          nombre: 'Por Departamento',
          titulo: `Desglose por Departamento — ${ultimoPeriodo ? periodoLabel(ultimoPeriodo) : ''}`,
          encabezados: ['Departamento', 'Empleados', 'Sal. Bruto', 'Sal. Neto', 'Costo Total', '% del Total'],
          filas: desglose.map(d => [d.depto, d.headcount, d.bruto, d.neto, d.costo, `${d.pct.toFixed(1)}%`]),
          anchos: [28, 14, 18, 18, 18, 14],
          columnasEnteras: [1],
        }] : []),
      ],
    })
  }

  return (
    <div className="space-y-6">
      <ReportHeader
        title="Resumen Gerencial"
        desc="Acumulado YTD, indicadores del último período y desglose por departamento."
        onPDF={exportarPDF}
        onExcel={exportarXlsx}
      />

      {!kpis ? (
        <EmptyState message="No hay períodos de nómina registrados aún." />
      ) : (
        <>
          {/* KPI Grid — último período */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#1B2980] dark:text-indigo-400">
              Indicadores — {periodoLabel(ultimoPeriodo!)}
            </p>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              <StatCard label="Empleados Activos"   value={`${kpis.empleados}`}       icon={Users}       iconColor="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400" />
              <StatCard label="Nómina Bruta"        value={formatRD(kpis.bruto)}   icon={Wallet}      iconColor="bg-zinc-100 text-zinc-700 dark:bg-[#262626] dark:text-zinc-300" />
              <StatCard label="Nómina Neta"         value={formatRD(kpis.neto)}    icon={TrendingUp}  iconColor="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" />
              <StatCard label="ISR Retenido"        value={formatRD(kpis.isr)}     icon={Receipt}     iconColor="bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400" />
              <StatCard label="Aportes Empleador"   value={formatRD(kpis.aportes)} icon={Building2}   iconColor="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" />
              <StatCard label="Costo Total Empresa" value={formatRD(kpis.costo)}   icon={Briefcase}   iconColor="bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400" />
            </div>
          </div>

          {/* YTD — Acumulado año en curso */}
          {ytd.periodos > 0 && (
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-800/40 bg-[#eef0fb]/40 dark:bg-indigo-950/20 p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-[#1B2980] dark:text-indigo-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#1B2980] dark:text-indigo-400">
                    Acumulado YTD — {currentYear}
                  </p>
                  <p className="text-[11px] text-indigo-600 dark:text-indigo-500 mt-0.5">{ytd.periodos} período{ytd.periodos !== 1 ? 's' : ''} procesados</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {([
                  { label: 'Bruto YTD',       value: ytd.bruto,   cls: 'text-zinc-800 dark:text-zinc-100' },
                  { label: 'Neto YTD',         value: ytd.neto,    cls: 'text-emerald-700 dark:text-emerald-400' },
                  { label: 'ISR YTD',          value: ytd.isr,     cls: 'text-violet-700 dark:text-violet-400' },
                  { label: 'TSS Empl. YTD',    value: ytd.aportes, cls: 'text-amber-700 dark:text-amber-400' },
                  { label: 'Costo Total YTD',  value: ytd.costo,   cls: 'text-indigo-700 dark:text-indigo-400 font-bold' },
                ] as const).map(({ label, value, cls }) => (
                  <div key={label} className="rounded-lg bg-white dark:bg-[#1f1f1f] border border-indigo-100 dark:border-indigo-900/40 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
                    <p className={`text-sm font-bold tabular-nums mt-1 ${cls}`}>{formatRD(value)}</p>
                  </div>
                ))}
              </div>
              {ytd.bruto > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">
                    <span>Eficiencia salarial (Neto / Bruto)</span>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">{(ytd.neto / ytd.bruto * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-indigo-100 dark:bg-indigo-900/30 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, ytd.neto / ytd.bruto * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Histórico con Δ% */}
          <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
            <div className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] px-5 py-4">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Histórico</p>
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mt-0.5">Últimos 6 Períodos</p>
            </div>
            {ultimos6.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-zinc-400">Sin períodos registrados</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] text-left">
                      {['Período','Empleados','Bruto','Descuentos','Neto','Δ Neto','Costo Total'].map(h => (
                        <th key={h} className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 last:text-right first:text-left text-right">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                    {ultimos6.map((p, i) => {
                      const delta = i < ultimos6.length - 1
                        ? ((p.totales.neto - ultimos6[i + 1].totales.neto) / ultimos6[i + 1].totales.neto * 100)
                        : null
                      return (
                        <tr key={p.id} className={`hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors ${i === 0 ? 'font-medium' : ''}`}>
                          <td className="px-5 py-3">
                            <span className="text-zinc-900 dark:text-zinc-100">{periodoLabel(p)}</span>
                            {i === 0 && <span className="ml-2 inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-800/50">Último</span>}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{p.totalEmpleados}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{formatRD(p.totales.bruto)}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-rose-700 dark:text-rose-400">{formatRD(p.totales.descuentos)}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatRD(p.totales.neto)}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-xs">
                            {delta === null ? (
                              <span className="text-zinc-300 dark:text-zinc-600">—</span>
                            ) : (
                              <span className={delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                {delta >= 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-indigo-700 dark:text-indigo-400">{formatRD(p.totales.costoTotal)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Desglose por departamento — último período */}
          {desglose.length > 0 && (
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
              <div className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] px-5 py-4">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Costo por Departamento</p>
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mt-0.5">{periodoLabel(ultimoPeriodo!)}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] text-left">
                      {['Departamento','Empleados','Sal. Bruto','Sal. Neto','Costo Total','% del Total'].map(h => (
                        <th key={h} className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 last:text-right first:text-left text-right">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                    {desglose.map(d => (
                      <tr key={d.depto} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                        <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{d.depto}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{d.headcount}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{formatRD(d.bruto)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatRD(d.neto)}</td>
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
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
