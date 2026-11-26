'use client'

import { useState, useMemo } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { formatRD, formatDate, formatCedula, fullName, formatAnosServicio, contratoLabel, contratoBadgeClass, parseFechaLocal } from '@/lib/utils'
import { exportarExcel } from '@/lib/excel-export'
import type { Empresa } from '@/types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NAVY, pdfHeader, selectCls, primaryBtn, FilterBar, ReportHeader } from './shared'

// ─── Reporte Empleados ────────────────────────────────────────────────────────
export function ReporteEmpleados({
  empresa, empleados,
}: {
  empresa: Empresa
  empleados: ReturnType<typeof useEmpleados>['empleados']
}) {
  const departamentos = useMemo(() =>
    Array.from(new Set(empleados.map(e => e.departamento))).sort(),
    [empleados]
  )

  const [filtroDepto, setFiltroDepto] = useState('todos')
  const [filtroContrato, setFiltroContrato] = useState('todos')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'activo' | 'inactivo'>('activo')
  const [generado, setGenerado] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  const filas = useMemo(() => {
    if (!generado) return []
    return empleados.filter(e => {
      if (filtroEstado === 'activo' && !e.activo) return false
      if (filtroEstado === 'inactivo' && e.activo) return false
      if (filtroDepto !== 'todos' && e.departamento !== filtroDepto) return false
      if (filtroContrato !== 'todos' && e.tipoContrato !== filtroContrato) return false
      return true
    })
  }, [generado, empleados, filtroEstado, filtroDepto, filtroContrato])

  const filasVisible = useMemo(() => {
    if (!searchQ.trim()) return filas
    const q = searchQ.toLowerCase()
    return filas.filter(e =>
      fullName(e).toLowerCase().includes(q) ||
      e.cedula.includes(q) ||
      e.cargo.toLowerCase().includes(q) ||
      e.departamento.toLowerCase().includes(q)
    )
  }, [filas, searchQ])

  function exportarPDF() {
    if (filas.length === 0) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pdfHeader(doc, empresa, 'Listado de Empleados',
      `Estado: ${filtroEstado} | Depto: ${filtroDepto} | Contrato: ${filtroContrato}`)

    autoTable(doc, {
      startY: 44,
      head: [['Nombre','Cédula/Doc','Cargo','Departamento','Contrato','Ingreso','Antigüedad','Salario Base','Banco']],
      body: filas.map(e => [
        fullName(e), e.cedula, e.cargo, e.departamento,
        contratoLabel(e.tipoContrato), formatDate(e.fechaIngreso),
        formatAnosServicio((Date.now() - parseFechaLocal(e.fechaIngreso).getTime()) / (365.25*24*3600*1000)),
        e.salarioBase.toFixed(2), e.banco ?? '—',
      ]),
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 7 },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 7: { halign: 'right' } },
      didDrawPage: (data) => {
        doc.setFontSize(7); doc.setTextColor(150)
        doc.text(`Página ${data.pageNumber}`, 283, 205, { align: 'right' })
      },
    })
    doc.save('listado-empleados.pdf')
  }

  function exportarXlsx() {
    if (filas.length === 0) return
    exportarExcel({
      nombreArchivo: 'listado-empleados',
      empresa: empresa.nombre, logo: empresa.logo,
      rnc: empresa.rnc,
      hojas: [{
        nombre: 'Empleados',
        titulo: 'Listado de Empleados',
        subtitulo: `Estado: ${filtroEstado} | Depto: ${filtroDepto} | Contrato: ${filtroContrato}`,
        encabezados: ['Nombre','Cédula/Doc','Cargo','Departamento','Contrato','Ingreso','Antigüedad','Salario Base','Banco'],
        filas: filas.map(e => [
          fullName(e), e.cedula, e.cargo, e.departamento,
          contratoLabel(e.tipoContrato), formatDate(e.fechaIngreso),
          formatAnosServicio((Date.now() - parseFechaLocal(e.fechaIngreso).getTime()) / (365.25*24*3600*1000)),
          e.salarioBase, e.banco ?? '—',
        ]),
        anchos: [30, 18, 24, 22, 18, 14, 18, 16, 16],
      }],
    })
  }

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Listado de Empleados"
        desc="Plantilla completa con datos laborales, antigüedad y salarios."
        onPDF={filas.length > 0 ? exportarPDF : undefined}
        onExcel={filas.length > 0 ? exportarXlsx : undefined}
      />

      <FilterBar>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Estado:
          <select value={filtroEstado} onChange={e => { setFiltroEstado(e.target.value as typeof filtroEstado); setGenerado(false) }} className={selectCls}>
            <option value="todos">Todos</option>
            <option value="activo">Activos</option>
            <option value="inactivo">Inactivos</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Departamento:
          <select value={filtroDepto} onChange={e => { setFiltroDepto(e.target.value); setGenerado(false) }} className={selectCls}>
            <option value="todos">Todos</option>
            {departamentos.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Contrato:
          <select value={filtroContrato} onChange={e => { setFiltroContrato(e.target.value); setGenerado(false) }} className={selectCls}>
            <option value="todos">Todos</option>
            <option value="fijo">Fijo</option>
            <option value="temporal">Temporal</option>
            <option value="estacional">Estacional</option>
            <option value="ocasional">Móvil / Ocasional</option>
            <option value="pasante">Pasante</option>
            <option value="aprendiz">Aprendiz</option>
            <option value="eventual">Eventual</option>
          </select>
        </label>
        <button onClick={() => { setGenerado(true); setSearchQ('') }} className={primaryBtn}>
          <ChevronRight className="h-4 w-4" /> Generar
        </button>
      </FilterBar>

      {!generado ? (
        <EmptyState message="Aplica los filtros y haz clic en Generar para ver el listado." />
      ) : filas.length === 0 ? (
        <EmptyState message="No hay empleados que coincidan con los filtros seleccionados." />
      ) : (
        <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
          <div className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] px-5 py-2.5 flex items-center gap-2">
            <Search className="h-4 w-4 text-zinc-400 shrink-0" />
            <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Buscar por nombre, cédula, cargo o departamento…" className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none" />
            <span className="text-xs text-zinc-400 shrink-0">{filasVisible.length}/{filas.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] text-left">
                  {['Nombre','Cédula/Doc','Cargo','Departamento','Contrato','Ingreso','Antigüedad','Salario Base','Banco'].map(h => (
                    <th key={h} className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                {filasVisible.map(e => {
                  const anos = (Date.now() - parseFechaLocal(e.fechaIngreso).getTime()) / (365.25*24*3600*1000)
                  return (
                    <tr key={e.id} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{fullName(e)}</p>
                        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{e.activo ? 'Activo' : 'Inactivo'}</p>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{formatCedula(e.cedula)}</td>
                      <td className="px-5 py-3 text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{e.cargo}</td>
                      <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">{e.departamento}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${contratoBadgeClass(e.tipoContrato)}`}>{contratoLabel(e.tipoContrato)}</span>
                      </td>
                      <td className="px-5 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{formatDate(e.fechaIngreso)}</td>
                      <td className="px-5 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{formatAnosServicio(anos)}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap">{formatRD(e.salarioBase)}</td>
                      <td className="px-5 py-3 text-xs text-zinc-500 dark:text-zinc-400">{e.banco ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
