'use client'

import { useState, useMemo } from 'react'
import { ChevronRight, Info, Search } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { labelLicencia, esLicenciaConSubsidio } from '@/lib/licencias-context'
import { calcularNomina } from '@/lib/dominican-labor'
import { formatRD, formatDate, fullName, parseFechaLocal } from '@/lib/utils'
import { exportarExcel } from '@/lib/excel-export'
import type { Empresa, Licencia, TipoLicencia, Empleado } from '@/types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NAVY, MESES, pdfHeader, selectCls, primaryBtn, FilterBar, ReportHeader } from './shared'

// ─── Reporte Salario vs. Licencias ────────────────────────────────────────────
// ALCANCE REAL (documentado a propósito, ver nota visible en la propia UI):
// el motor de nómina (`calcularNomina`) acepta un parámetro opcional
// `diasTrabajados`, pero ninguna pantalla de captura de nómina (`nomina/page.tsx`)
// lo alimenta con un valor distinto al default (23.83 = mes completo) — hoy el
// sistema NO captura explícitamente "días trabajados" ni "ausencias/permisos
// informales" por período. Por lo tanto este reporte NO puede mostrar
// "días descontados por ausencia" (ese dato no existe en el modelo), y en su
// lugar cruza el único dato real y verificable que sí existe: el módulo de
// **Licencias** (`licencias-context.tsx` / tipo `Licencia`), que sí registra
// días, tipo y el monto que la empresa efectivamente pagó vía nómina
// (`montoPagado`, ya calculado sobre el salario diario del empleado) más el
// subsidio estimado de TSS/ARL cuando aplica (`montoSubsidioEstimado`).
// Cada licencia se atribuye al mes calendario de su `fechaInicio` — si una
// licencia cruza de un mes a otro (ej. maternidad, 84 días) no se prorratea
// entre los dos meses, se cuenta completa en el mes en que inició, misma
// simplificación que ya usa `licencias/page.tsx` para su propio filtro "del mes".
export function ReporteLicencias({
  empresa, empleados, licencias,
}: {
  empresa: Empresa
  empleados: ReturnType<typeof useEmpleados>['empleados']
  licencias: Licencia[]
}) {
  const currentYear = new Date().getFullYear()
  const ORDEN_TIPOS: TipoLicencia[] = [
    'matrimonial', 'fallecimiento', 'alumbramiento',
    'enfermedad_comun', 'accidente_laboral', 'maternidad',
  ]

  const anios = useMemo(() => {
    const years = new Set(licencias.map(l => parseFechaLocal(l.fechaInicio).getFullYear()))
    years.add(currentYear)
    return [...years].sort((a, b) => b - a)
  }, [licencias, currentYear])
  const empMap = useMemo(() => Object.fromEntries(empleados.map(e => [e.id, e])), [empleados])

  const [anioFiltro, setAnioFiltro] = useState<number>(currentYear)
  const [generado, setGenerado] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  const filas = useMemo(() => {
    if (!generado) return []
    return licencias
      .filter(l => parseFechaLocal(l.fechaInicio).getFullYear() === anioFiltro)
      .map(l => ({ l, emp: empMap[l.empleadoId], mes: MESES[parseFechaLocal(l.fechaInicio).getMonth()] }))
      .sort((a, b) => a.l.fechaInicio.localeCompare(b.l.fechaInicio))
  }, [generado, licencias, anioFiltro, empMap])

  const filasVisible = useMemo(() => {
    if (!searchQ.trim()) return filas
    const q = searchQ.toLowerCase()
    return filas.filter(({ emp }) => emp && fullName(emp).toLowerCase().includes(q))
  }, [filas, searchQ])

  const resumen = useMemo(() => filas.reduce((acc, { l }) => ({
    count:       acc.count + 1,
    dias:        acc.dias + l.dias,
    montoPagado: acc.montoPagado + l.montoPagado,
    subsidio:    acc.subsidio + (l.montoSubsidioEstimado ?? 0),
  }), { count: 0, dias: 0, montoPagado: 0, subsidio: 0 }), [filas])

  // Desglose agregado por tipo de licencia (motivo) — complementa la vista
  // por licencia individual con la dimensión "por tipo" pedida para este reporte.
  const porTipo = useMemo(() => {
    const map = new Map<TipoLicencia, { tipo: TipoLicencia; count: number; dias: number; montoPagado: number; subsidio: number }>()
    for (const { l } of filas) {
      const cur = map.get(l.tipo) ?? { tipo: l.tipo, count: 0, dias: 0, montoPagado: 0, subsidio: 0 }
      cur.count++
      cur.dias += l.dias
      cur.montoPagado += l.montoPagado
      cur.subsidio += l.montoSubsidioEstimado ?? 0
      map.set(l.tipo, cur)
    }
    return ORDEN_TIPOS.map(t => map.get(t)).filter((x): x is NonNullable<typeof x> => !!x)
  }, [filas]) // eslint-disable-line react-hooks/exhaustive-deps

  function exportarPDF() {
    if (filas.length === 0) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pdfHeader(doc, empresa, 'Salario vs. Licencias', `Año ${anioFiltro}`)
    autoTable(doc, {
      startY: 44,
      head: [['Empleado', 'Mes', 'Tipo de Licencia', 'Fecha Inicio', 'Días', 'Monto Pagado', 'Subsidio Estimado TSS/ARL']],
      body: filas.map(({ l, emp, mes }) => [
        emp ? fullName(emp) : 'Empleado eliminado',
        `${mes} ${anioFiltro}`,
        labelLicencia(l.tipo),
        formatDate(l.fechaInicio),
        `${l.dias}`,
        l.montoPagado.toFixed(2),
        (l.montoSubsidioEstimado ?? 0).toFixed(2),
      ]),
      foot: [['TOTALES', '', '', '', `${resumen.dias}`, resumen.montoPagado.toFixed(2), resumen.subsidio.toFixed(2)]],
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      footStyles: { fillColor: [240, 240, 240], textColor: NAVY, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 4: { halign: 'center' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      didDrawPage: (data) => { doc.setFontSize(7); doc.setTextColor(150); doc.text(`Página ${data.pageNumber}`, 283, 205, { align: 'right' }) },
    })
    doc.save(`salario-vs-licencias-${anioFiltro}.pdf`)
  }

  function exportarXlsx() {
    if (filas.length === 0) return
    exportarExcel({
      nombreArchivo: `salario-vs-licencias-${anioFiltro}`,
      empresa: empresa.nombre, logo: empresa.logo, rnc: empresa.rnc,
      hojas: [{
        nombre: 'Licencias', titulo: 'Salario vs. Licencias', subtitulo: `Año ${anioFiltro}`,
        encabezados: ['Empleado', 'Mes', 'Tipo de Licencia', 'Fecha Inicio', 'Días', 'Monto Pagado', 'Subsidio Estimado TSS/ARL'],
        filas: filas.map(({ l, emp, mes }) => [
          emp ? fullName(emp) : 'Empleado eliminado',
          `${mes} ${anioFiltro}`,
          labelLicencia(l.tipo),
          formatDate(l.fechaInicio),
          l.dias,
          l.montoPagado,
          l.montoSubsidioEstimado ?? 0,
        ]),
        totales: ['TOTALES', '', '', '', resumen.dias, resumen.montoPagado, resumen.subsidio],
        anchos: [32, 16, 24, 16, 10, 16, 20],
        columnasEnteras: [4],
      }],
    })
  }

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Salario vs. Licencias"
        desc="Días de licencia remunerada por tipo y mes, y su impacto en RD$ pagado por la empresa vs. subsidio TSS/ARL."
        onPDF={filas.length > 0 ? exportarPDF : undefined}
        onExcel={filas.length > 0 ? exportarXlsx : undefined}
      />

      <FilterBar>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Año:
          <select value={anioFiltro} onChange={e => { setAnioFiltro(+e.target.value); setGenerado(false) }} className={selectCls}>
            {anios.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <button onClick={() => { setGenerado(true); setSearchQ('') }} className={primaryBtn}>
          <ChevronRight className="h-4 w-4" /> Generar
        </button>
      </FilterBar>

      <div className="rounded-lg border border-indigo-100 dark:border-indigo-900/40 bg-[#eef0fb] dark:bg-indigo-950/30 px-5 py-4">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 text-[#1B2980] dark:text-indigo-300 shrink-0" />
          <div className="text-xs text-[#151f66] dark:text-indigo-200 space-y-1.5">
            <p className="font-semibold">Alcance real de este reporte</p>
            <p>
              Cielo Cloud todavía no captura formalmente &ldquo;días trabajados&rdquo; ni ausencias/permisos informales
              por período de nómina — el motor de cálculo acepta un parámetro <code>diasTrabajados</code>, pero ninguna
              pantalla de procesamiento de nómina lo alimenta con un valor distinto al de un mes completo, así que hoy
              una ausencia sin licencia formal no reduce el salario calculado. Este reporte se basa exclusivamente en
              las <strong>Licencias</strong> registradas en ese módulo (matrimonial, fallecimiento, alumbramiento,
              enfermedad común, accidente laboral, maternidad) — no en ausencias/permisos sin licencia. El
              &ldquo;Monto Pagado&rdquo; es lo que la empresa efectivamente desembolsó vía nómina por cada licencia
              (ya calculado sobre el salario diario del empleado); el &ldquo;Subsidio Estimado&rdquo; es solo
              informativo — lo paga o reembolsa SISALRIL/el Seguro de Riesgos Laborales, no Cielo Cloud.
            </p>
          </div>
        </div>
      </div>

      {!generado ? (
        <EmptyState message="Selecciona un año y haz clic en Generar." />
      ) : filas.length === 0 ? (
        <EmptyState message={`No hay licencias registradas en ${anioFiltro}. Regístralas desde el módulo de Licencias.`} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Licencias Registradas</p>
              <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{resumen.count}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Días Totales</p>
              <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{resumen.dias}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Total Pagado por Cielo Cloud</p>
              <p className="mt-1 text-xl font-bold text-[#1B2980] dark:text-indigo-400 tabular-nums">{formatRD(resumen.montoPagado)}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Subsidio Estimado TSS/ARL</p>
              <p className="mt-1 text-xl font-bold text-sky-700 dark:text-sky-400 tabular-nums">{formatRD(resumen.subsidio)}</p>
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
                    {['Empleado', 'Mes', 'Tipo de Licencia', 'Fecha Inicio', 'Días', 'Monto Pagado', 'Subsidio Estimado'].map(h => (
                      <th key={h} className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                  {filasVisible.map(({ l, emp, mes }) => (
                    <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{emp ? fullName(emp) : 'Empleado eliminado'}</p>
                        {emp && <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{emp.cargo}</p>}
                      </td>
                      <td className="px-5 py-3 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{mes} {anioFiltro}</td>
                      <td className="px-5 py-3">
                        <Badge variant={esLicenciaConSubsidio(l.tipo) ? 'info' : 'neutral'}>{labelLicencia(l.tipo)}</Badge>
                      </td>
                      <td className="px-5 py-3 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{formatDate(l.fechaInicio)}</td>
                      <td className="px-5 py-3 tabular-nums text-center text-zinc-700 dark:text-zinc-300">{l.dias}</td>
                      <td className="px-5 py-3 tabular-nums text-right font-medium text-[#1B2980] dark:text-indigo-300 whitespace-nowrap">{formatRD(l.montoPagado, 2)}</td>
                      <td className="px-5 py-3 tabular-nums text-right text-sky-600 dark:text-sky-400 whitespace-nowrap">{l.montoSubsidioEstimado != null ? formatRD(l.montoSubsidioEstimado, 2) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#c7cef0] dark:border-[#2e2e2e] bg-[#eef0fb] dark:bg-[#262626] text-[#1B2980] dark:text-indigo-300 font-bold">
                    <td colSpan={4} className="px-5 py-3 text-left text-xs uppercase tracking-wide">TOTALES ({filasVisible.length} licencias)</td>
                    <td className="px-5 py-3 tabular-nums text-center">{resumen.dias}</td>
                    <td className="px-5 py-3 tabular-nums text-right text-indigo-700 dark:text-indigo-300 whitespace-nowrap">{formatRD(resumen.montoPagado)}</td>
                    <td className="px-5 py-3 tabular-nums text-right text-sky-700 dark:text-sky-300 whitespace-nowrap">{formatRD(resumen.subsidio)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
            <div className="border-b border-zinc-100 dark:border-[#2a2a2a] px-5 py-3.5">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Desglose por Tipo de Licencia</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Totales de {anioFiltro} agrupados por motivo.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="px-5 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Tipo de Licencia</th>
                    <th className="px-4 py-2 text-center text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Licencias</th>
                    <th className="px-4 py-2 text-center text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Días</th>
                    <th className="px-4 py-2 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Monto Pagado</th>
                    <th className="px-4 py-2 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Subsidio Estimado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                  {porTipo.map(t => (
                    <tr key={t.tipo}>
                      <td className="px-5 py-2.5">
                        <Badge variant={esLicenciaConSubsidio(t.tipo) ? 'info' : 'neutral'}>{labelLicencia(t.tipo)}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center tabular-nums text-zinc-700 dark:text-zinc-300">{t.count}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums text-zinc-700 dark:text-zinc-300">{t.dias}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-[#1B2980] dark:text-indigo-300 whitespace-nowrap">{formatRD(t.montoPagado, 2)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-sky-600 dark:text-sky-400 whitespace-nowrap">{formatRD(t.subsidio, 2)}</td>
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
