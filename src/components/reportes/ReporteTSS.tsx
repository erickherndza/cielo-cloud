'use client'

import { useState, useMemo } from 'react'
import { ChevronRight, Loader2, Info, Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { useRetribuciones } from '@/lib/retribuciones-context'
import { TASAS_TSS, TASA_IMPUESTO_SUSTITUTIVO_RETRIBUCIONES, conBaseGravableRetribuciones } from '@/lib/dominican-labor'
import { formatRD, formatCedula, fullName } from '@/lib/utils'
import { exportarExcel } from '@/lib/excel-export'
import type { PeriodoNomina, Empresa, CategoriaRiesgoSRL, Empleado } from '@/types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NAVY, pdfHeader, periodoLabel, resultadoHistorico, selectCls, primaryBtn, FilterBar, ReportHeader } from './shared'

// ─── Reporte TSS ──────────────────────────────────────────────────────────────
export function ReporteTSS({
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

  // ─── Impuesto Sustitutivo sobre Retribuciones Complementarias (IR-17) ──────
  // No es TSS ni ISR retenido al empleado — es un impuesto aparte que la
  // empresa paga a la DGII sobre beneficios en especie (vehículo, vivienda,
  // etc., registrados en /retribuciones-complementarias). Se cruza por
  // mes/año simple contra el período seleccionado (RetribucionComplementaria
  // no referencia un PeriodoNomina, son campos independientes — mismo
  // criterio ya usado en getRetribucionesPendientes de dominican-labor.ts).
  const { retribuciones } = useRetribuciones()
  const lineasIR17 = useMemo(
    // Base gravable efectiva (desglose de vivienda/vehículo + regla del
    // vehículo menos costoso), igual que en /retribuciones-complementarias.
    () => (periodo ? conBaseGravableRetribuciones(retribuciones.filter(r => r.mes === periodo.mes && r.anio === periodo.anio)) : []),
    [retribuciones, periodo]
  )
  const totalRetribucionesIR17 = useMemo(() => lineasIR17.reduce((s, l) => s + l.valorMensual, 0), [lineasIR17])
  const impuestoIR17 = totalRetribucionesIR17 * TASA_IMPUESTO_SUSTITUTIVO_RETRIBUCIONES

  // Empleados REALMENTE incluidos en el período (snapshot resultadosPorEmpleado
  // si existe, o todos los activos como respaldo solo para períodos sin ese
  // campo) — no `empleados.filter(e => e.activo)` a secas, que excluiría por
  // completo a cualquiera que haya sido procesado en ese período pero ya esté
  // inactivo hoy. Es un reporte de conciliación fiscal (factura CNSS/DGII):
  // subestimar el TSS/ISR de un período ya cerrado es un riesgo de auditoría real.
  const filas = useMemo(() => {
    if (!periodo || !generado) return []
    const idsDelPeriodo = periodo.resultadosPorEmpleado && Object.keys(periodo.resultadosPorEmpleado).length > 0
      ? Object.keys(periodo.resultadosPorEmpleado)
      : empleados.filter(e => e.activo).map(e => e.id)
    return idsDelPeriodo.map(id => empleados.find(e => e.id === id)).filter((e): e is Empleado => !!e).map(emp => {
      const res = resultadoHistorico(emp, periodo)
      const totalTSS = res.afpEmpleado + res.sfsEmpleado + res.afpEmpleador + res.sfsEmpleador + res.srlEmpleador + res.infotepEmpleador
      return { emp, res, totalTSS }
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

  const ISR_BRACKETS = [
    { label: 'Exento',  max: 34685,   color: 'bg-zinc-400' },
    { label: '15%',     max: 52027,   color: 'bg-amber-400' },
    { label: '20%',     max: 72260,   color: 'bg-orange-500' },
    { label: '25%',     max: Infinity, color: 'bg-rose-500' },
  ]

  const isrTramos = useMemo(() => {
    if (filas.length === 0) return []
    return ISR_BRACKETS.map((bracket, i) => {
      const prev = i > 0 ? ISR_BRACKETS[i - 1].max : 0
      const rows = filas.filter(({ res }) => res.salarioCotizable > prev && res.salarioCotizable <= bracket.max)
      const totalISR = rows.reduce((s, { res }) => s + res.isrMensual, 0)
      return {
        label: bracket.label,
        color: bracket.color,
        count: rows.length,
        pct: filas.length > 0 ? rows.length / filas.length * 100 : 0,
        avgISR: rows.length > 0 ? totalISR / rows.length : 0,
        totalISR,
      }
    })
  }, [filas])

  const totales = useMemo(() => filas.reduce((acc, { res, totalTSS }) => ({
    cotizable:   acc.cotizable   + res.salarioCotizable,
    afpEmp:      acc.afpEmp      + res.afpEmpleado,
    sfsEmp:      acc.sfsEmp      + res.sfsEmpleado,
    afpEmpl:     acc.afpEmpl     + res.afpEmpleador,
    sfsEmpl:     acc.sfsEmpl     + res.sfsEmpleador,
    srl:         acc.srl         + res.srlEmpleador,
    infotep:     acc.infotep     + res.infotepEmpleador,
    totalTSS:    acc.totalTSS    + totalTSS,
    isr:         acc.isr         + res.isrMensual,
    sfsDependientes: acc.sfsDependientes + res.sfsDependientes,
  }), { cotizable: 0, afpEmp: 0, sfsEmp: 0, afpEmpl: 0, sfsEmpl: 0, srl: 0, infotep: 0, totalTSS: 0, isr: 0, sfsDependientes: 0 }), [filas])

  // ─── Planilla de Conciliación TSS (formato "factura") ──────────────────────
  // SRL se remite por categoría de riesgo (I-IV), cada una con su propia tasa —
  // se agrupa por categoría real de cada empleado en vez de asumir una sola tasa.
  const TASA_SRL_POR_CATEGORIA: Record<CategoriaRiesgoSRL, number> = {
    I: TASAS_TSS.srlCategoriaI, II: TASAS_TSS.srlCategoriaII,
    III: TASAS_TSS.srlCategoriaIII, IV: TASAS_TSS.srlCategoriaIV,
  }

  const srlPorCategoria = useMemo(() => {
    const grupos = new Map<CategoriaRiesgoSRL, { categoria: CategoriaRiesgoSRL; tasa: number; monto: number; count: number }>()
    for (const { emp, res } of filas) {
      const cat = emp.categoriaRiesgo ?? 'I'
      const g = grupos.get(cat) ?? { categoria: cat, tasa: TASA_SRL_POR_CATEGORIA[cat], monto: 0, count: 0 }
      g.monto += res.srlEmpleador
      g.count += 1
      grupos.set(cat, g)
    }
    return [...grupos.values()].sort((a, b) => a.categoria.localeCompare(b.categoria))
  }, [filas])

  interface FilaConciliacion {
    concepto: string
    tasaEmpleado: string
    tasaEmpleador: string
    montoEmpleado: number
    montoEmpleador: number
    total: number
  }

  const conciliacionFilas = useMemo<FilaConciliacion[]>(() => {
    if (filas.length === 0) return []
    const rows: FilaConciliacion[] = [
      {
        concepto: 'AFP — Pensiones (Ley 87-01)',
        tasaEmpleado: `${(TASAS_TSS.afpEmpleado * 100).toFixed(2)}%`,
        tasaEmpleador: `${(TASAS_TSS.afpEmpleador * 100).toFixed(2)}%`,
        montoEmpleado: totales.afpEmp,
        montoEmpleador: totales.afpEmpl,
        total: totales.afpEmp + totales.afpEmpl,
      },
      {
        concepto: 'SFS — Seguro Familiar de Salud (Ley 87-01)',
        tasaEmpleado: `${(TASAS_TSS.sfsEmpleado * 100).toFixed(2)}%`,
        tasaEmpleador: `${(TASAS_TSS.sfsEmpleador * 100).toFixed(2)}%`,
        montoEmpleado: totales.sfsEmp,
        montoEmpleador: totales.sfsEmpl,
        total: totales.sfsEmp + totales.sfsEmpl,
      },
    ]
    if (totales.sfsDependientes > 0) {
      rows.push({
        concepto: 'SFS — Dependientes Adicionales (Res. 624-02 CNSS)',
        tasaEmpleado: 'Cuota fija',
        tasaEmpleador: '—',
        montoEmpleado: totales.sfsDependientes,
        montoEmpleador: 0,
        total: totales.sfsDependientes,
      })
    }
    for (const g of srlPorCategoria) {
      rows.push({
        concepto: `SRL — Riesgos Laborales, Categoría ${g.categoria} (${g.count} emp.)`,
        tasaEmpleado: '—',
        tasaEmpleador: `${(g.tasa * 100).toFixed(2)}%`,
        montoEmpleado: 0,
        montoEmpleador: g.monto,
        total: g.monto,
      })
    }
    rows.push({
      concepto: 'Infotep — Capacitación Laboral (Ley 116-80)',
      tasaEmpleado: '—',
      tasaEmpleador: `${(TASAS_TSS.infotepEmpleador * 100).toFixed(2)}%`,
      montoEmpleado: 0,
      montoEmpleador: totales.infotep,
      total: totales.infotep,
    })
    return rows
  }, [filas, totales, srlPorCategoria])

  const totalTSSRemitir = useMemo(() => conciliacionFilas.reduce((s, r) => s + r.total, 0), [conciliacionFilas])
  const totalTSSRemitirEmpleado  = useMemo(() => conciliacionFilas.reduce((s, r) => s + r.montoEmpleado, 0), [conciliacionFilas])
  const totalTSSRemitirEmpleador = useMemo(() => conciliacionFilas.reduce((s, r) => s + r.montoEmpleador, 0), [conciliacionFilas])

  function generar() {
    setLoading(true)
    setTimeout(() => { setLoading(false); setGenerado(true) }, 100)
  }

  function exportarPDF() {
    if (!periodo || filas.length === 0) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    // ─── Página 1: Planilla de Conciliación (formato "factura" TSS) ─────────
    pdfHeader(doc, empresa, 'Planilla de Conciliación TSS / DGII', periodoLabel(periodo))

    autoTable(doc, {
      startY: 44,
      head: [['Concepto','Tasa Empleado','Tasa Empleador','Monto Empleado','Monto Empleador','Total']],
      body: conciliacionFilas.map(f => [
        f.concepto, f.tasaEmpleado, f.tasaEmpleador,
        f.montoEmpleado > 0 ? f.montoEmpleado.toFixed(2) : '—',
        f.montoEmpleador > 0 ? f.montoEmpleador.toFixed(2) : '—',
        f.total.toFixed(2),
      ]),
      foot: [['TOTAL TSS A REMITIR (CNSS)','','',
        totalTSSRemitirEmpleado.toFixed(2), totalTSSRemitirEmpleador.toFixed(2), totalTSSRemitir.toFixed(2),
      ]],
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      footStyles: { fillColor: [240, 240, 240], textColor: NAVY, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        1: { halign: 'right' }, 2: { halign: 'right' },
        3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
      },
    })

    const docTyped = doc as jsPDF & { lastAutoTable: { finalY: number } }
    const afterConciliacion = docTyped.lastAutoTable?.finalY ?? 44
    autoTable(doc, {
      startY: afterConciliacion + 10,
      head: [['Retención ISR (DGII)', '']],
      body: [['Retención mensual acumulada — Ley 11-92 Art. 309', formatRD(totales.isr, 2)]],
      theme: 'plain',
      headStyles: { fillColor: [255, 255, 255], textColor: NAVY, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' } },
      tableWidth: 140,
    })

    if (lineasIR17.length > 0) {
      const afterISR = docTyped.lastAutoTable?.finalY ?? afterConciliacion + 20
      autoTable(doc, {
        startY: afterISR + 6,
        head: [['Impuesto Sustitutivo — Retribuciones Complementarias (IR-17)', '']],
        body: [[`27% sobre ${formatRD(totalRetribucionesIR17, 2)} en beneficios en especie`, formatRD(impuestoIR17, 2)]],
        theme: 'plain',
        headStyles: { fillColor: [255, 255, 255], textColor: NAVY, fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 9, fontStyle: 'bold' },
        columnStyles: { 1: { halign: 'right' } },
        tableWidth: 140,
      })
    }

    // ─── Página 2: Detalle por Empleado (auditoría/soporte) ─────────────────
    doc.addPage()
    pdfHeader(doc, empresa, 'Reporte TSS / IR-2 — Detalle por Empleado', periodoLabel(periodo))

    autoTable(doc, {
      startY: 44,
      head: [['Nombre','Cédula','S. Cotizable','AFP Emp.','SFS Emp.','AFP Empl.','SFS Empl.','SRL Empl.','Infotep','Total TSS','ISR Retenido']],
      body: filas.map(({ emp, res, totalTSS }) => [
        fullName(emp), formatCedula(emp.cedula),
        res.salarioCotizable.toFixed(2),
        res.afpEmpleado.toFixed(2), res.sfsEmpleado.toFixed(2),
        res.afpEmpleador.toFixed(2), res.sfsEmpleador.toFixed(2), res.srlEmpleador.toFixed(2), res.infotepEmpleador.toFixed(2),
        totalTSS.toFixed(2), res.isrMensual.toFixed(2),
      ]),
      foot: [['TOTALES','',
        totales.cotizable.toFixed(2),
        totales.afpEmp.toFixed(2), totales.sfsEmp.toFixed(2),
        totales.afpEmpl.toFixed(2), totales.sfsEmpl.toFixed(2), totales.srl.toFixed(2), totales.infotep.toFixed(2),
        totales.totalTSS.toFixed(2), totales.isr.toFixed(2),
      ]],
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 7 },
      footStyles: { fillColor: [240, 240, 240], textColor: NAVY, fontStyle: 'bold', fontSize: 7 },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
        8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' },
      },
      didDrawPage: (data) => {
        doc.setFontSize(7); doc.setTextColor(150)
        doc.text(`Página ${data.pageNumber}`, 283, 205, { align: 'right' })
      },
    })
    doc.save(`tss-${periodoLabel(periodo).replace(/\s+/g, '-').toLowerCase()}.pdf`)
  }

  function exportarXlsx() {
    if (!periodo || filas.length === 0) return
    exportarExcel({
      nombreArchivo: `tss-${periodoLabel(periodo).replace(/\s+/g, '-').toLowerCase()}`,
      empresa: empresa.nombre, logo: empresa.logo,
      rnc: empresa.rnc,
      hojas: [
        {
          nombre: 'Conciliación',
          titulo: 'Planilla de Conciliación TSS / DGII',
          subtitulo: periodoLabel(periodo),
          encabezados: ['Concepto','Tasa Empleado','Tasa Empleador','Monto Empleado','Monto Empleador','Total'],
          filas: conciliacionFilas.map(f => [
            f.concepto, f.tasaEmpleado, f.tasaEmpleador, f.montoEmpleado, f.montoEmpleador, f.total,
          ]),
          totales: ['TOTAL TSS A REMITIR (CNSS)','','', totalTSSRemitirEmpleado, totalTSSRemitirEmpleador, totalTSSRemitir],
          anchos: [42, 14, 14, 16, 16, 16],
        },
        {
          nombre: 'TSS',
          titulo: 'Reporte TSS / IR-2 — Detalle por Empleado',
          subtitulo: periodoLabel(periodo),
          encabezados: ['Nombre','Cédula','S. Cotizable','AFP Emp.','SFS Emp.','AFP Empl.','SFS Empl.','SRL Empl.','Infotep','Total TSS','ISR Retenido'],
          filas: filas.map(({ emp, res, totalTSS }) => [
            fullName(emp), formatCedula(emp.cedula),
            res.salarioCotizable, res.afpEmpleado, res.sfsEmpleado,
            res.afpEmpleador, res.sfsEmpleador, res.srlEmpleador, res.infotepEmpleador,
            totalTSS, res.isrMensual,
          ]),
          totales: ['TOTALES','', totales.cotizable, totales.afpEmp, totales.sfsEmp,
            totales.afpEmpl, totales.sfsEmpl, totales.srl, totales.infotep, totales.totalTSS, totales.isr],
          anchos: [30, 18, 16, 14, 14, 14, 14, 12, 12, 16, 14],
        },
        ...(lineasIR17.length > 0 ? [{
          nombre: 'IR-17',
          titulo: 'Impuesto Sustitutivo sobre Retribuciones Complementarias',
          subtitulo: periodoLabel(periodo),
          encabezados: ['Concepto', 'Empleado', 'Valor Mensual (RD$)', 'Impuesto Sustitutivo 27%'],
          filas: lineasIR17.map(l => {
            const emp = l.empleadoId ? empleados.find(e => e.id === l.empleadoId) : undefined
            return [
              l.concepto,
              emp ? fullName(emp) : 'General / sin asignar',
              l.valorMensual,
              l.valorMensual * TASA_IMPUESTO_SUSTITUTIVO_RETRIBUCIONES,
            ]
          }),
          totales: [`TOTAL — ${lineasIR17.length} concepto(s)`, '', totalRetribucionesIR17, impuestoIR17],
          anchos: [30, 26, 20, 22],
        }] : []),
      ],
    })
  }

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Cumplimiento Fiscal"
        desc="Planilla de conciliación TSS (CNSS) y retención de ISR (DGII) — mismo formato de la factura oficial, para conciliar sin recalcular a mano."
        onPDF={filas.length > 0 ? exportarPDF : undefined}
        onExcel={filas.length > 0 ? exportarXlsx : undefined}
      />

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
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Total TSS</p>
              <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{formatRD(totales.totalTSS)}</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">Empleado + Empleador</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">TSS Empleado</p>
              <p className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-400 tabular-nums">{formatRD(totales.afpEmp + totales.sfsEmp)}</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">AFP + SFS descontado</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">TSS Empleador</p>
              <p className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">{formatRD(totales.afpEmpl + totales.sfsEmpl + totales.srl + totales.infotep)}</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">AFP + SFS + SRL + Infotep empresa</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">ISR Retenido</p>
              <p className="mt-1 text-xl font-bold text-violet-700 dark:text-violet-400 tabular-nums">{formatRD(totales.isr)}</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">Para remitir DGII día 10</p>
            </div>
          </div>

          {/* Planilla de Conciliación TSS — mismo desglose de conceptos/tasas que la factura oficial CNSS */}
          <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
            <div className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] px-5 py-3">
              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Planilla de Conciliación TSS</p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Desglose por concepto y tasa, empleado vs. empleador — mismo formato de la factura oficial de la CNSS, para conciliar directo contra lo remitido.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626]">
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Concepto</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Tasa Empleado</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Tasa Empleador</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-rose-500 dark:text-rose-400 whitespace-nowrap">Monto Empleado</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-amber-600 dark:text-amber-400 whitespace-nowrap">Monto Empleador</th>
                    <th className="px-5 py-3 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-700 dark:text-zinc-300 whitespace-nowrap">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                  {conciliacionFilas.map(f => (
                    <tr key={f.concepto} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                      <td className="px-5 py-3 text-zinc-800 dark:text-zinc-200 whitespace-nowrap">{f.concepto}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{f.tasaEmpleado}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{f.tasaEmpleador}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{f.montoEmpleado > 0 ? formatRD(f.montoEmpleado, 2) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{f.montoEmpleador > 0 ? formatRD(f.montoEmpleador, 2) : '—'}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{formatRD(f.total, 2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#c7cef0] dark:border-[#2e2e2e] bg-[#eef0fb] dark:bg-[#262626] text-[#1B2980] dark:text-indigo-300 font-bold">
                    <td className="px-5 py-3 text-xs uppercase tracking-wide whitespace-nowrap">Total TSS a Remitir (CNSS)</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{formatRD(totalTSSRemitirEmpleado, 2)}</td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{formatRD(totalTSSRemitirEmpleador, 2)}</td>
                    <td className="px-5 py-3 text-right tabular-nums whitespace-nowrap">{formatRD(totalTSSRemitir, 2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="border-t border-zinc-100 dark:border-[#2a2a2a] bg-[#eef0fb]/40 dark:bg-indigo-950/10 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#1B2980] dark:text-indigo-400">Retención ISR — DGII</p>
                <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">Ley 11-92 Art. 309 — retención mensual acumulada de todos los empleados de este período (equivalente para IR-13/declaración jurada).</p>
              </div>
              <p className="text-xl font-bold text-[#1B2980] dark:text-indigo-400 tabular-nums whitespace-nowrap">{formatRD(totales.isr, 2)}</p>
            </div>
            {lineasIR17.length > 0 && (
              <div className="border-t border-zinc-100 dark:border-[#2a2a2a] bg-[#eef0fb]/40 dark:bg-indigo-950/10 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#1B2980] dark:text-indigo-400">Impuesto Sustitutivo — Retribuciones Complementarias (IR-17)</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    27% sobre RD${totalRetribucionesIR17.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} en beneficios en especie registrados este mes — obligación de la empresa, no se descuenta al empleado (ver /retribuciones-complementarias).
                  </p>
                </div>
                <p className="text-xl font-bold text-[#1B2980] dark:text-indigo-400 tabular-nums whitespace-nowrap">{formatRD(impuestoIR17, 2)}</p>
              </div>
            )}
          </div>

          {/* Detalle por empleado — soporte y auditoría de la planilla de conciliación de arriba */}
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
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Nombre</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Cédula</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">S. Cotizable</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-rose-500 dark:text-rose-400 whitespace-nowrap">AFP Emp.</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-rose-500 dark:text-rose-400 whitespace-nowrap">SFS Emp.</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-amber-600 dark:text-amber-400 whitespace-nowrap">AFP Empl.</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-amber-600 dark:text-amber-400 whitespace-nowrap">SFS Empl.</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-amber-600 dark:text-amber-400 whitespace-nowrap">SRL Empl.</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-amber-600 dark:text-amber-400 whitespace-nowrap">Infotep</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-700 dark:text-zinc-300 whitespace-nowrap">Total TSS</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-violet-500 dark:text-violet-400 whitespace-nowrap">ISR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                  {filasVisible.map(({ emp, res, totalTSS }) => (
                    <tr key={emp.id} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors text-right">
                      <td className="px-5 py-3 text-left">
                        <p className="font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{fullName(emp)}</p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{emp.cargo}</p>
                      </td>
                      <td className="px-4 py-3 text-left font-mono text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{formatCedula(emp.cedula)}</td>
                      <td className="px-4 py-3 tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{formatRD(res.salarioCotizable)}</td>
                      <td className="px-4 py-3 tabular-nums text-rose-700 dark:text-rose-400 whitespace-nowrap">{formatRD(res.afpEmpleado)}</td>
                      <td className="px-4 py-3 tabular-nums text-rose-700 dark:text-rose-400 whitespace-nowrap">{formatRD(res.sfsEmpleado)}</td>
                      <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-400 whitespace-nowrap">{formatRD(res.afpEmpleador)}</td>
                      <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-400 whitespace-nowrap">{formatRD(res.sfsEmpleador)}</td>
                      <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-400 whitespace-nowrap">{formatRD(res.srlEmpleador)}</td>
                      <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-400 whitespace-nowrap">{formatRD(res.infotepEmpleador)}</td>
                      <td className="px-4 py-3 tabular-nums font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{formatRD(totalTSS)}</td>
                      <td className="px-4 py-3 tabular-nums text-violet-700 dark:text-violet-400 whitespace-nowrap">{formatRD(res.isrMensual)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#c7cef0] dark:border-[#2e2e2e] bg-[#eef0fb] dark:bg-[#262626] text-[#1B2980] dark:text-indigo-300 font-bold text-right">
                    <td colSpan={2} className="px-5 py-3 text-left text-xs uppercase tracking-wide">TOTALES ({filasVisible.length} empleados)</td>
                    <td className="px-4 py-3 tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{formatRD(totales.cotizable)}</td>
                    <td className="px-4 py-3 tabular-nums text-rose-700 dark:text-rose-300 whitespace-nowrap">{formatRD(totales.afpEmp)}</td>
                    <td className="px-4 py-3 tabular-nums text-rose-700 dark:text-rose-300 whitespace-nowrap">{formatRD(totales.sfsEmp)}</td>
                    <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-300 whitespace-nowrap">{formatRD(totales.afpEmpl)}</td>
                    <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-300 whitespace-nowrap">{formatRD(totales.sfsEmpl)}</td>
                    <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-300 whitespace-nowrap">{formatRD(totales.srl)}</td>
                    <td className="px-4 py-3 tabular-nums text-amber-700 dark:text-amber-300 whitespace-nowrap">{formatRD(totales.infotep)}</td>
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap">{formatRD(totales.totalTSS)}</td>
                    <td className="px-4 py-3 tabular-nums text-violet-700 dark:text-violet-300 whitespace-nowrap">{formatRD(totales.isr)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ISR bracket distribution */}
          {isrTramos.some(t => t.count > 0) && (
            <div className="rounded-lg border border-violet-200 dark:border-violet-800/40 bg-violet-50 dark:bg-violet-950/20 p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-violet-700 dark:text-violet-400 mb-4">Distribución por Tramo ISR — Ley 11-92</p>
              <div className="flex h-3 rounded-full overflow-hidden mb-4">
                {isrTramos.map(t => t.pct > 0 && (
                  <div key={t.label} className={`${t.color} opacity-80`} style={{ width: `${t.pct}%` }} title={`${t.label}: ${t.count} empleado(s)`} />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {isrTramos.map(t => (
                  <div key={t.label} className="rounded-lg bg-white dark:bg-[#1f1f1f] border border-violet-100 dark:border-violet-900/40 p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className={`h-2 w-2 rounded-full ${t.color}`} />
                      <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">Tramo {t.label}</p>
                    </div>
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{t.count} emp.</p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">ISR prom.: {formatRD(t.avgISR)}</p>
                    <p className="text-[11px] text-violet-600 dark:text-violet-400 font-medium">Total: {formatRD(t.totalISR)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Legal note */}
          <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-zinc-50 dark:bg-[#262626] px-5 py-4 flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 text-zinc-500 dark:text-zinc-400 shrink-0" />
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Reporte generado conforme a la <strong className="text-zinc-800 dark:text-zinc-200">Ley 87-01</strong> (TSS/CNSS)
              y <strong className="text-zinc-800 dark:text-zinc-200">Ley 11-92 Art. 309</strong> (ISR asalariados).
              Vencimiento de pago: día 10 del mes siguiente. Verificar tasas actualizadas en{' '}
              <strong className="text-zinc-800 dark:text-zinc-200">tss.gov.do</strong> y{' '}
              <strong className="text-zinc-800 dark:text-zinc-200">dgii.gov.do</strong>.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
