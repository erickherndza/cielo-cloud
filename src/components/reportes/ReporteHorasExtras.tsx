'use client'

import { useState, useMemo } from 'react'
import { ChevronRight, Info, Search, CheckCircle2, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { formatRD, fullName } from '@/lib/utils'
import { exportarExcel } from '@/lib/excel-export'
import type { PeriodoNomina, Empresa, Empleado } from '@/types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NAVY, pdfHeader, periodoLabel, resultadoHistorico, selectCls, primaryBtn, FilterBar, ReportHeader } from './shared'

// ─── Reporte Horas Extras ─────────────────────────────────────────────────────
export function ReporteHorasExtras({
  empresa, empleados, periodos,
}: {
  empresa: Empresa
  empleados: ReturnType<typeof useEmpleados>['empleados']
  periodos: PeriodoNomina[]
}) {
  const currentYear = new Date().getFullYear()
  const anios = useMemo(() => Array.from(new Set(periodos.map(p => p.anio))).sort((a, b) => b - a), [periodos])
  const empMap = useMemo(() => Object.fromEntries(empleados.map(e => [e.id, e])), [empleados])

  const [anioFiltro, setAnioFiltro] = useState<number>(currentYear)
  const [generado, setGenerado] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  const filas = useMemo(() => {
    if (!generado) return []
    const rows: { empId: string; per: string; he35: number; imp35: number; he100: number; imp100: number; nocturnas: number; impNocturno: number; total: number }[] = []
    for (const p of periodos.filter(p => p.anio === anioFiltro && p.estado !== 'en_proceso')) {
      for (const [empId, ajustes] of Object.entries(p.ajustesPorEmpleado ?? {})) {
        const he35      = ajustes.filter(a => a.concepto === 'horas_extras_35').reduce((s, a) => s + a.valor, 0)
        const he100     = ajustes.filter(a => a.concepto === 'horas_extras_100').reduce((s, a) => s + a.valor, 0)
        const nocturnas = ajustes.filter(a => a.concepto === 'recargo_nocturno').reduce((s, a) => s + a.valor, 0)
        if (he35 === 0 && he100 === 0 && nocturnas === 0) continue
        const emp = empMap[empId]
        if (!emp) continue
        const res = resultadoHistorico(emp, p)
        rows.push({
          empId, per: periodoLabel(p), he35, imp35: res.importeHE35, he100, imp100: res.importeHE100,
          nocturnas, impNocturno: res.importeNocturno,
          total: res.totalHorasExtras + res.importeNocturno,
        })
      }
    }
    return rows.sort((a, b) => a.per.localeCompare(b.per) || fullName(empMap[a.empId] ?? { nombre: a.empId, apellido: '' } as never).localeCompare(fullName(empMap[b.empId] ?? { nombre: b.empId, apellido: '' } as never)))
  }, [generado, periodos, anioFiltro, empMap])

  const filasVisible = useMemo(() => {
    if (!searchQ.trim()) return filas
    const q = searchQ.toLowerCase()
    return filas.filter(r => {
      const emp = empMap[r.empId]
      return emp ? fullName(emp).toLowerCase().includes(q) : false
    })
  }, [filas, searchQ, empMap])

  const resumen = useMemo(() => filas.reduce((acc, r) => ({
    he35: acc.he35 + r.he35, imp35: acc.imp35 + r.imp35,
    he100: acc.he100 + r.he100, imp100: acc.imp100 + r.imp100,
    nocturnas: acc.nocturnas + r.nocturnas, impNocturno: acc.impNocturno + r.impNocturno,
    total: acc.total + r.total,
  }), { he35: 0, imp35: 0, he100: 0, imp100: 0, nocturnas: 0, impNocturno: 0, total: 0 }), [filas])

  // ─── Topes legales de horas extras (Art. 155, Código de Trabajo) ───────────
  // Decisión de alcance: horas_extras_35 Y horas_extras_100 cuentan para AMBOS
  // topes (trimestral y semanal aprox.). El Art. 155 limita el NÚMERO de horas
  // extraordinarias trabajadas más allá de la jornada ordinaria — no distingue
  // según la tarifa de recargo con que se pagaron (35% ordinario vs 100%
  // feriado). En una alerta de cumplimiento es más prudente sumar todas las
  // horas extraordinarias que fraccionar el criterio y subestimar el riesgo
  // real de exceso frente a la ley.
  //
  // Tope trimestral (80h): cálculo EXACTO — se agrupan los períodos por
  // trimestre calendario y se suman las horas registradas, sin aproximación.
  //
  // Tope "semanal" (24h): el sistema NO registra horas por semana calendario
  // (solo por período mensual/quincenal), así que este valor es una
  // APROXIMACIÓN explícita — horas del período ÷ semanas aproximadas que
  // contiene el período (mensual ≈ 4.33, quincenal ≈ 2.17). Se advierte esto
  // visiblemente en la UI (ver nota debajo del título de la sección).
  const datosTopePeriodo = useMemo(() => {
    if (!generado) return []
    const rows: { empId: string; per: string; trimestre: 1 | 2 | 3 | 4; horas: number; semanas: number; promedioSemanal: number }[] = []
    for (const p of periodos.filter(p => p.anio === anioFiltro && p.estado !== 'en_proceso')) {
      const semanas = p.tipo === 'quincenal' ? 2.17 : 4.33
      const trimestre = Math.ceil(p.mes / 3) as 1 | 2 | 3 | 4
      for (const [empId, ajustes] of Object.entries(p.ajustesPorEmpleado ?? {})) {
        if (!empMap[empId]) continue
        const he35  = ajustes.filter(a => a.concepto === 'horas_extras_35').reduce((s, a) => s + a.valor, 0)
        const he100 = ajustes.filter(a => a.concepto === 'horas_extras_100').reduce((s, a) => s + a.valor, 0)
        const horas = he35 + he100
        if (horas === 0) continue
        rows.push({ empId, per: periodoLabel(p), trimestre, horas, semanas, promedioSemanal: horas / semanas })
      }
    }
    return rows
  }, [generado, periodos, anioFiltro, empMap])

  const TOPE_TRIMESTRAL_HORAS = 80
  const TOPE_SEMANAL_HORAS = 24
  const UMBRAL_ALERTA_PCT = 0.9 // ámbar desde 90% del tope; rojo al superarlo
  const TRIMESTRE_LABEL: Record<number, string> = { 1: 'T1 (Ene–Mar)', 2: 'T2 (Abr–Jun)', 3: 'T3 (Jul–Sep)', 4: 'T4 (Oct–Dic)' }

  const alertasTrimestrales = useMemo(() => {
    const map = new Map<string, { empId: string; trimestre: 1 | 2 | 3 | 4; horas: number }>()
    for (const r of datosTopePeriodo) {
      const key = `${r.empId}-${r.trimestre}`
      const cur = map.get(key) ?? { empId: r.empId, trimestre: r.trimestre, horas: 0 }
      cur.horas += r.horas
      map.set(key, cur)
    }
    return [...map.values()]
      .filter(a => a.horas >= TOPE_TRIMESTRAL_HORAS * UMBRAL_ALERTA_PCT)
      .sort((a, b) => b.horas - a.horas || a.trimestre - b.trimestre)
  }, [datosTopePeriodo])

  const alertasSemanales = useMemo(() =>
    datosTopePeriodo
      .filter(r => r.promedioSemanal >= TOPE_SEMANAL_HORAS * UMBRAL_ALERTA_PCT)
      .sort((a, b) => b.promedioSemanal - a.promedioSemanal),
    [datosTopePeriodo]
  )

  const hayAlertasTopes = alertasTrimestrales.length > 0 || alertasSemanales.length > 0

  function exportarPDF() {
    if (filas.length === 0) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pdfHeader(doc, empresa, 'Reporte de Horas Extras', `Año ${anioFiltro}`)
    autoTable(doc, {
      startY: 44,
      head: [['Empleado','Período','Hrs 35%','Importe 35%','Hrs 100%','Importe 100%','Hrs Noct.','Importe Noct.','Total HE']],
      body: filas.map(r => {
        const emp = empMap[r.empId]
        return [emp ? fullName(emp) : r.empId, r.per, r.he35.toFixed(1), r.imp35.toFixed(2), r.he100.toFixed(1), r.imp100.toFixed(2), r.nocturnas.toFixed(1), r.impNocturno.toFixed(2), r.total.toFixed(2)]
      }),
      foot: [['TOTALES', '', resumen.he35.toFixed(1), resumen.imp35.toFixed(2), resumen.he100.toFixed(1), resumen.imp100.toFixed(2), resumen.nocturnas.toFixed(1), resumen.impNocturno.toFixed(2), resumen.total.toFixed(2)]],
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      footStyles: { fillColor: [240, 240, 240], textColor: NAVY, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'center' }, 5: { halign: 'right' }, 6: { halign: 'center' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
      didDrawPage: (data) => { doc.setFontSize(7); doc.setTextColor(150); doc.text(`Página ${data.pageNumber}`, 283, 205, { align: 'right' }) },
    })
    doc.save(`horas-extras-${anioFiltro}.pdf`)
  }

  function exportarXlsx() {
    if (filas.length === 0) return
    exportarExcel({
      nombreArchivo: `horas-extras-${anioFiltro}`,
      empresa: empresa.nombre, logo: empresa.logo, rnc: empresa.rnc,
      hojas: [{
        nombre: 'Horas Extras', titulo: 'Reporte de Horas Extras', subtitulo: `Año ${anioFiltro}`,
        encabezados: ['Empleado','Período','Horas 35%','Importe 35%','Horas 100%','Importe 100%','Horas Noct.','Importe Noct.','Total HE'],
        filas: filas.map(r => {
          const emp = empMap[r.empId]
          return [emp ? fullName(emp) : r.empId, r.per, r.he35, r.imp35, r.he100, r.imp100, r.nocturnas, r.impNocturno, r.total]
        }),
        totales: ['TOTALES', '', resumen.he35, resumen.imp35, resumen.he100, resumen.imp100, resumen.nocturnas, resumen.impNocturno, resumen.total],
        anchos: [32, 22, 14, 16, 14, 16, 14, 16, 16],
      }],
    })
  }

  return (
    <div className="space-y-5">
      <ReportHeader title="Horas Extras" desc="Detalle de horas extras al 35% y 100% por empleado y período (Ley 16-92 Art. 203)." onPDF={filas.length > 0 ? exportarPDF : undefined} onExcel={filas.length > 0 ? exportarXlsx : undefined} />
      <FilterBar>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Año:
          <select value={anioFiltro} onChange={e => { setAnioFiltro(+e.target.value); setGenerado(false) }} className={selectCls}>
            {anios.length === 0 ? <option value={currentYear}>{currentYear}</option> : anios.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <button onClick={() => { setGenerado(true); setSearchQ('') }} className={primaryBtn}>
          <ChevronRight className="h-4 w-4" /> Generar
        </button>
      </FilterBar>
      {!generado ? <EmptyState message="Selecciona un año y haz clic en Generar." /> : filas.length === 0 ? <EmptyState message="No se registraron horas extras en este año." /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Horas Extras 35%</p>
              <p className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">{resumen.he35.toFixed(1)} hrs</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">{formatRD(resumen.imp35)}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Horas Extras 100%</p>
              <p className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-400 tabular-nums">{resumen.he100.toFixed(1)} hrs</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">{formatRD(resumen.imp100)}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Recargo Nocturno (15%)</p>
              <p className="mt-1 text-xl font-bold text-sky-700 dark:text-sky-400 tabular-nums">{resumen.nocturnas.toFixed(1)} hrs</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">{formatRD(resumen.impNocturno)}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Total Importe HE</p>
              <p className="mt-1 text-xl font-bold text-indigo-700 dark:text-indigo-400 tabular-nums">{formatRD(resumen.total)}</p>
            </div>
          </div>
          <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
            <div className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] px-5 py-2.5 flex items-center gap-2">
              <Search className="h-4 w-4 text-zinc-400 shrink-0" />
              <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Buscar por nombre…" className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none" />
              <span className="text-xs text-zinc-400 shrink-0">{filasVisible.length}/{filas.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] text-left">
                    {['Empleado','Período','Hrs 35%','Importe 35%','Hrs 100%','Importe 100%','Hrs Noct.','Importe Noct.','Total HE'].map(h => (
                      <th key={h} className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                  {filasVisible.map((r, idx) => {
                    const emp = empMap[r.empId]
                    return (
                      <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                        <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{emp ? fullName(emp) : r.empId}</td>
                        <td className="px-5 py-3 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{r.per}</td>
                        <td className="px-5 py-3 tabular-nums text-center text-amber-700 dark:text-amber-400">{r.he35.toFixed(1)}</td>
                        <td className="px-5 py-3 tabular-nums text-right text-amber-700 dark:text-amber-400 whitespace-nowrap">{formatRD(r.imp35)}</td>
                        <td className="px-5 py-3 tabular-nums text-center text-rose-700 dark:text-rose-400">{r.he100.toFixed(1)}</td>
                        <td className="px-5 py-3 tabular-nums text-right text-rose-700 dark:text-rose-400 whitespace-nowrap">{formatRD(r.imp100)}</td>
                        <td className="px-5 py-3 tabular-nums text-center text-sky-700 dark:text-sky-400">{r.nocturnas.toFixed(1)}</td>
                        <td className="px-5 py-3 tabular-nums text-right text-sky-700 dark:text-sky-400 whitespace-nowrap">{formatRD(r.impNocturno)}</td>
                        <td className="px-5 py-3 tabular-nums text-right font-semibold text-indigo-700 dark:text-indigo-400 whitespace-nowrap">{formatRD(r.total)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#c7cef0] dark:border-[#2e2e2e] bg-[#eef0fb] dark:bg-[#262626] text-[#1B2980] dark:text-indigo-300 font-bold">
                    <td colSpan={2} className="px-5 py-3 text-left text-xs uppercase tracking-wide">TOTALES ({filasVisible.length} registros)</td>
                    <td className="px-5 py-3 tabular-nums text-center text-amber-700 dark:text-amber-300">{resumen.he35.toFixed(1)}</td>
                    <td className="px-5 py-3 tabular-nums text-right text-amber-700 dark:text-amber-300 whitespace-nowrap">{formatRD(resumen.imp35)}</td>
                    <td className="px-5 py-3 tabular-nums text-center text-rose-700 dark:text-rose-300">{resumen.he100.toFixed(1)}</td>
                    <td className="px-5 py-3 tabular-nums text-right text-rose-700 dark:text-rose-300 whitespace-nowrap">{formatRD(resumen.imp100)}</td>
                    <td className="px-5 py-3 tabular-nums text-center text-sky-700 dark:text-sky-300">{resumen.nocturnas.toFixed(1)}</td>
                    <td className="px-5 py-3 tabular-nums text-right text-sky-700 dark:text-sky-300 whitespace-nowrap">{formatRD(resumen.impNocturno)}</td>
                    <td className="px-5 py-3 tabular-nums text-right text-indigo-700 dark:text-indigo-300 whitespace-nowrap">{formatRD(resumen.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
            <div className="border-b border-zinc-100 dark:border-[#2a2a2a] px-5 py-3.5 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-[#1B2980] dark:text-indigo-400 mt-0.5 shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Alertas de Topes Legales (Art. 155, Código de Trabajo)</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Empleados que superan o se acercan (≥90%) al límite de 80 horas extraordinarias acumuladas por trimestre calendario de {anioFiltro}, o a un promedio semanal aproximado de 24 horas. Incluye horas al 35% y al 100%.
                </p>
              </div>
            </div>

            <div className="px-5 py-3 border-b border-zinc-100 dark:border-[#2a2a2a] bg-amber-50/60 dark:bg-amber-950/10 flex items-start gap-2">
              <Info className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                <strong>El tope trimestral (80h) es un cálculo exacto</strong> — suma las horas registradas en los períodos de cada trimestre calendario.
                <strong> El promedio semanal (24h) es una aproximación</strong>: el sistema registra horas extra por período mensual o quincenal, no por
                semana calendario individual — el valor mostrado divide las horas del período entre el número aproximado de semanas que contiene
                (≈4.33 en nómina mensual, ≈2.17 en quincenal). Para un control exacto de este límite se requeriría registrar horas extra por semana calendario.
              </p>
            </div>

            {!hayAlertasTopes ? (
              <div className="px-5 py-8 flex flex-col items-center gap-2 text-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Ningún empleado se acerca a los topes de horas extras en {anioFiltro}.</p>
              </div>
            ) : (
              <div className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                {alertasTrimestrales.length > 0 && (
                  <div className="px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">Tope trimestral — 80 horas acumuladas (cálculo exacto)</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left">
                            <th className="pr-4 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Empleado</th>
                            <th className="pr-4 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Trimestre</th>
                            <th className="pr-4 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Horas Acumuladas</th>
                            <th className="pr-4 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Progreso</th>
                            <th className="py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                          {alertasTrimestrales.map(a => {
                            const emp = empMap[a.empId]
                            const pct = a.horas / TOPE_TRIMESTRAL_HORAS * 100
                            const excede = a.horas > TOPE_TRIMESTRAL_HORAS
                            return (
                              <tr key={`${a.empId}-${a.trimestre}`}>
                                <td className="pr-4 py-2 font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{emp ? fullName(emp) : a.empId}</td>
                                <td className="pr-4 py-2 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{TRIMESTRE_LABEL[a.trimestre]} {anioFiltro}</td>
                                <td className="pr-4 py-2 tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{a.horas.toFixed(1)} hrs</td>
                                <td className="pr-4 py-2">
                                  <div className="w-28 h-1.5 rounded-full bg-zinc-100 dark:bg-[#2e2e2e] overflow-hidden">
                                    <div className={`h-full rounded-full ${excede ? 'bg-rose-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                                  </div>
                                </td>
                                <td className="py-2">
                                  <Badge variant={excede ? 'danger' : 'warning'}>
                                    {excede ? `+${(a.horas - TOPE_TRIMESTRAL_HORAS).toFixed(1)}h sobre el tope` : `${pct.toFixed(0)}% del tope`}
                                  </Badge>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {alertasSemanales.length > 0 && (
                  <div className="px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">Tope semanal — 24 horas (promedio aproximado por período, ver nota arriba)</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left">
                            <th className="pr-4 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Empleado</th>
                            <th className="pr-4 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Período</th>
                            <th className="pr-4 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Horas del Período</th>
                            <th className="pr-4 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Promedio Semanal Aprox.</th>
                            <th className="py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                          {alertasSemanales.map((r, idx) => {
                            const emp = empMap[r.empId]
                            const excede = r.promedioSemanal > TOPE_SEMANAL_HORAS
                            return (
                              <tr key={`${r.empId}-${idx}`}>
                                <td className="pr-4 py-2 font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{emp ? fullName(emp) : r.empId}</td>
                                <td className="pr-4 py-2 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{r.per}</td>
                                <td className="pr-4 py-2 tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{r.horas.toFixed(1)} hrs</td>
                                <td className="pr-4 py-2 tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">≈ {r.promedioSemanal.toFixed(1)} hrs/sem.</td>
                                <td className="py-2">
                                  <Badge variant={excede ? 'danger' : 'warning'}>{excede ? 'Excede aprox.' : 'Cerca del tope'}</Badge>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
