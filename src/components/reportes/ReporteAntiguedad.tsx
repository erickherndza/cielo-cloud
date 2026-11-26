'use client'

import { useState, useMemo } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { getAnosServicio } from '@/lib/dominican-labor'
import { formatDate, formatCedula, fullName, formatAnosServicio } from '@/lib/utils'
import { exportarExcel } from '@/lib/excel-export'
import type { Empresa, Empleado } from '@/types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NAVY, pdfHeader, primaryBtn, FilterBar, ReportHeader } from './shared'

// ─── Reporte Antigüedad de Plantilla ──────────────────────────────────────────
// Buckets de rango: alineados con umbrales ya usados en el motor de nómina
// (5 años = corte de Vacaciones 14→18 días, Art. 177) y con bandas de uso
// habitual en RRHH para lectura gerencial rápida (< 1 / 1-3 / 3-5 / 5-10 / 10+).
const RANGOS_ANTIGUEDAD: { id: string; label: string; min: number; max: number }[] = [
  { id: 'menos1', label: '< 1 año',     min: 0,  max: 1 },
  { id: '1a3',    label: '1 – 3 años',  min: 1,  max: 3 },
  { id: '3a5',    label: '3 – 5 años',  min: 3,  max: 5 },
  { id: '5a10',   label: '5 – 10 años', min: 5,  max: 10 },
  { id: '10mas',  label: '10+ años',    min: 10, max: Infinity },
]

export function ReporteAntiguedad({
  empresa, empleados,
}: {
  empresa: Empresa
  empleados: ReturnType<typeof useEmpleados>['empleados']
}) {
  const [tab, setTab] = useState<'rango' | 'posicion'>('rango')
  const [generado, setGenerado] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  const activos = useMemo(() => empleados.filter(e => e.activo), [empleados])

  // Ordenado de mayor a menor antigüedad — lectura natural para un reporte
  // de "plantilla" (quiénes llevan más tiempo primero).
  const filas = useMemo(() => {
    if (!generado) return []
    return activos
      .map(emp => ({ emp, anos: getAnosServicio(emp.fechaIngreso) }))
      .sort((a, b) => b.anos - a.anos)
  }, [generado, activos])

  const filasVisible = useMemo(() => {
    if (!searchQ.trim()) return filas
    const q = searchQ.toLowerCase()
    return filas.filter(({ emp }) =>
      fullName(emp).toLowerCase().includes(q) ||
      emp.cedula.includes(q) ||
      emp.cargo.toLowerCase().includes(q) ||
      emp.departamento.toLowerCase().includes(q)
    )
  }, [filas, searchQ])

  const porRango = useMemo(() => {
    if (filas.length === 0) return []
    return RANGOS_ANTIGUEDAD.map(r => {
      const count = filas.filter(({ anos }) => anos >= r.min && anos < r.max).length
      return { ...r, count, pct: (count / filas.length) * 100 }
    })
  }, [filas])

  const porPosicion = useMemo(() => {
    if (filas.length === 0) return []
    const groups: Record<string, { cargo: string; count: number; sumAnos: number }> = {}
    for (const { emp, anos } of filas) {
      const cargo = emp.cargo || 'Sin Cargo'
      if (!groups[cargo]) groups[cargo] = { cargo, count: 0, sumAnos: 0 }
      groups[cargo].count++
      groups[cargo].sumAnos += anos
    }
    const list = Object.values(groups).map(g => ({ cargo: g.cargo, count: g.count, avgAnos: g.sumAnos / g.count }))
    const maxAvg = Math.max(...list.map(g => g.avgAnos), 0.0001)
    return list
      .map(g => ({ ...g, pct: (g.avgAnos / maxAvg) * 100 }))
      .sort((a, b) => b.avgAnos - a.avgAnos)
  }, [filas])

  // filas ya viene ordenado desc por antigüedad, así que filas[0] es el más antiguo
  const resumen = useMemo(() => {
    if (filas.length === 0) return null
    const promedio = filas.reduce((s, f) => s + f.anos, 0) / filas.length
    const masAntiguo = filas[0]
    const cargos = new Set(filas.map(f => f.emp.cargo)).size
    return { promedio, masAntiguo, cargos }
  }, [filas])

  function exportarPDF() {
    if (filas.length === 0) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    // ─── Página 1: Resumen — por rango de años y por posición ──────────────
    pdfHeader(doc, empresa, 'Antigüedad de Plantilla', `${filas.length} empleados activos`)

    autoTable(doc, {
      startY: 44,
      head: [['Rango de Antigüedad', 'Empleados', '% del Total']],
      body: porRango.map(r => [r.label, `${r.count}`, `${r.pct.toFixed(1)}%`]),
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
      tableWidth: 120,
    })

    const docTyped = doc as jsPDF & { lastAutoTable: { finalY: number } }
    const afterRango = docTyped.lastAutoTable?.finalY ?? 44

    autoTable(doc, {
      startY: afterRango + 10,
      head: [['Posición / Cargo', 'Empleados', 'Antigüedad Promedio']],
      body: porPosicion.map(p => [p.cargo, `${p.count}`, formatAnosServicio(p.avgAnos)]),
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
      tableWidth: 150,
    })

    // ─── Página 2: Detalle por empleado (respaldo de auditoría) ────────────
    doc.addPage()
    pdfHeader(doc, empresa, 'Antigüedad de Plantilla — Detalle por Empleado', `${filas.length} empleados activos`)

    autoTable(doc, {
      startY: 44,
      head: [['Nombre', 'Cargo', 'Departamento', 'Fecha de Ingreso', 'Antigüedad']],
      body: filas.map(({ emp, anos }) => [
        fullName(emp), emp.cargo, emp.departamento, formatDate(emp.fechaIngreso), formatAnosServicio(anos),
      ]),
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didDrawPage: (data) => {
        doc.setFontSize(7); doc.setTextColor(150)
        doc.text(`Página ${data.pageNumber}`, 283, 205, { align: 'right' })
      },
    })
    doc.save('antiguedad-plantilla.pdf')
  }

  function exportarXlsx() {
    if (filas.length === 0) return
    exportarExcel({
      nombreArchivo: 'antiguedad-plantilla',
      empresa: empresa.nombre, logo: empresa.logo,
      rnc: empresa.rnc,
      hojas: [
        {
          nombre: 'Por Rango',
          titulo: 'Antigüedad de Plantilla — Por Rango de Años',
          subtitulo: `${filas.length} empleados activos`,
          encabezados: ['Rango de Antigüedad', 'Empleados', '% del Total'],
          filas: porRango.map(r => [r.label, r.count, `${r.pct.toFixed(1)}%`]),
          anchos: [22, 14, 14],
          columnasEnteras: [1],
        },
        {
          nombre: 'Por Posición',
          titulo: 'Antigüedad de Plantilla — Por Posición',
          subtitulo: `${filas.length} empleados activos`,
          encabezados: ['Posición / Cargo', 'Empleados', 'Antigüedad Promedio (años)'],
          filas: porPosicion.map(p => [p.cargo, p.count, Number(p.avgAnos.toFixed(2))]),
          anchos: [26, 14, 22],
          columnasEnteras: [1],
        },
        {
          nombre: 'Detalle',
          titulo: 'Antigüedad de Plantilla — Detalle por Empleado',
          subtitulo: `${filas.length} empleados activos`,
          encabezados: ['Nombre', 'Cargo', 'Departamento', 'Fecha de Ingreso', 'Antigüedad'],
          filas: filas.map(({ emp, anos }) => [
            fullName(emp), emp.cargo, emp.departamento, formatDate(emp.fechaIngreso), formatAnosServicio(anos),
          ]),
          anchos: [28, 22, 20, 16, 20],
        },
      ],
    })
  }

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Antigüedad de Plantilla"
        desc="Distribución de la antigüedad de los empleados activos por rango de años y por posición."
        onPDF={filas.length > 0 ? exportarPDF : undefined}
        onExcel={filas.length > 0 ? exportarXlsx : undefined}
      />

      <FilterBar>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          Calcula la antigüedad de los <strong className="text-zinc-800 dark:text-zinc-200">{activos.length}</strong> empleados activos
        </span>
        <button onClick={() => { setGenerado(true); setSearchQ('') }} className={primaryBtn}>
          <ChevronRight className="h-4 w-4" /> Generar
        </button>
      </FilterBar>

      {!generado ? (
        <EmptyState message="Haz clic en Generar para calcular la antigüedad de la plantilla activa." />
      ) : filas.length === 0 ? (
        <EmptyState message="No hay empleados activos para calcular antigüedad." />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Empleados Activos</p>
              <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{filas.length}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Antigüedad Promedio</p>
              <p className="mt-1 text-xl font-bold text-[#1B2980] dark:text-indigo-400 tabular-nums">
                {resumen ? formatAnosServicio(resumen.promedio) : '—'}
              </p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Empleado Más Antiguo</p>
              <p className="mt-1 text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                {resumen ? fullName(resumen.masAntiguo.emp) : '—'}
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">{resumen ? formatAnosServicio(resumen.masAntiguo.anos) : ''}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Posiciones Representadas</p>
              <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{resumen?.cargos ?? 0}</p>
            </div>
          </div>

          {/* Tabs: Por Rango de Años / Por Posición */}
          <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
            <div className="border-b border-zinc-100 dark:border-[#2a2a2a] px-5 flex gap-0">
              {([
                { id: 'rango',    label: 'Por Rango de Años' },
                { id: 'posicion', label: 'Por Posición' },
              ] as const).map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    tab === t.id
                      ? 'border-[#1B2980] text-[#1B2980] dark:text-indigo-400 dark:border-indigo-400'
                      : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'rango' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] text-left">
                      <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Rango de Antigüedad</th>
                      <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Empleados</th>
                      <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">% del Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                    {porRango.map(r => (
                      <tr key={r.id} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                        <td className="px-5 py-3.5 font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{r.label}</td>
                        <td className="px-4 py-3.5 text-center tabular-nums text-zinc-600 dark:text-zinc-400">{r.count}</td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-24 h-1.5 rounded-full bg-zinc-100 dark:bg-[#2e2e2e] overflow-hidden">
                              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${r.pct}%` }} />
                            </div>
                            <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400 shrink-0 w-12 text-right">{r.pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] text-left">
                      <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Posición / Cargo</th>
                      <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Empleados</th>
                      <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Antigüedad Promedio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                    {porPosicion.map(p => (
                      <tr key={p.cargo} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                        <td className="px-5 py-3.5 font-medium text-zinc-900 dark:text-zinc-100">{p.cargo}</td>
                        <td className="px-4 py-3.5 text-center tabular-nums text-zinc-600 dark:text-zinc-400">{p.count}</td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-24 h-1.5 rounded-full bg-zinc-100 dark:bg-[#2e2e2e] overflow-hidden">
                              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${p.pct}%` }} />
                            </div>
                            <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400 shrink-0 whitespace-nowrap text-right">{formatAnosServicio(p.avgAnos)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Detalle por empleado */}
          <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
            <div className="border-b border-zinc-100 dark:border-[#2a2a2a] px-5 py-4">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Detalle por Empleado</h2>
            </div>
            <div className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] px-5 py-2.5 flex items-center gap-2">
              <Search className="h-4 w-4 text-zinc-400 shrink-0" />
              <input
                type="text"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="Buscar por nombre, cédula, cargo o departamento…"
                className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none"
              />
              <span className="text-xs text-zinc-400 shrink-0">{filasVisible.length}/{filas.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] text-left">
                    {['Nombre', 'Cargo', 'Departamento', 'Fecha de Ingreso', 'Antigüedad'].map(h => (
                      <th key={h} className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                  {filasVisible.map(({ emp, anos }) => (
                    <tr key={emp.id} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-[#1B2980] dark:text-indigo-400 whitespace-nowrap">{fullName(emp)}</p>
                        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{formatCedula(emp.cedula)}</p>
                      </td>
                      <td className="px-5 py-3 text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{emp.cargo}</td>
                      <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{emp.departamento}</td>
                      <td className="px-5 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{formatDate(emp.fechaIngreso)}</td>
                      <td className="px-5 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{formatAnosServicio(anos)}</td>
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
