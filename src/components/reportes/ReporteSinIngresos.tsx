'use client'

import { useState, useMemo } from 'react'
import { ChevronRight, Info, Search, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { useEmpresa } from '@/lib/empresa-context'
import { useConfirm } from '@/lib/confirm-context'
import { useLiquidaciones } from '@/lib/liquidaciones-context'
import { formatDate, formatCedula, fullName, parseFechaLocal } from '@/lib/utils'
import { exportarExcel } from '@/lib/excel-export'
import type { PeriodoNomina, Empresa, RegistroLiquidacion, Empleado } from '@/types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NAVY, pdfHeader, periodoLabel, resultadoHistorico, selectCls, primaryBtn, FilterBar, ReportHeader } from './shared'

// ─── Reporte Empleados Sin Ingresos ──────────────────────────────────────────
// Auditoría de integridad pre-cierre: compara la plantilla que debía estar
// activa durante el mes de un período contra lo que realmente quedó
// registrado en la nómina de ese período (CLAUDE.md, Media Prioridad —
// "prerequisito también de una futura integración TSS").
function finDeMes(mes: number, anio: number): Date {
  return new Date(anio, mes, 0, 23, 59, 59, 999)
}

type MotivoSinIngreso = 'no_procesado' | 'bruto_cero'

export function ReporteSinIngresos({
  empresa, empleados, periodos, liquidaciones, periodoInicial,
}: {
  periodoInicial?: string | null
  empresa: Empresa
  empleados: ReturnType<typeof useEmpleados>['empleados']
  periodos: PeriodoNomina[]
  liquidaciones: RegistroLiquidacion[]
}) {
  const sorted = useMemo(() =>
    [...periodos].filter(p => p.estado !== 'en_proceso' && p.tipo !== 'regalia' && p.tipo !== 'bonificacion').sort((a, b) =>
      new Date(b.fechaGeneracion).getTime() - new Date(a.fechaGeneracion).getTime()
    ), [periodos])

  // Si llegó desde una alerta (?periodo=<mes>-<año>) abre directo ese mes ya generado.
  const periodoDeAlerta = periodoInicial
    ? sorted.find(p => `${p.mes}-${p.anio}` === periodoInicial)
    : undefined
  const [periodoId, setPeriodoId] = useState<string>(periodoDeAlerta?.id ?? sorted[0]?.id ?? '')
  const [generado, setGenerado] = useState(!!periodoDeAlerta)
  const [searchQ, setSearchQ] = useState('')

  const periodo = sorted.find(p => p.id === periodoId)
  const { guardar } = useEmpresa()
  const confirmar = useConfirm()

  const resueltos = empresa.pagoRetroactivoResueltos ?? []
  const claveCaso = (empId: string) => `${empId}|${periodo?.anio}-${periodo?.mes}`
  async function marcarResuelto(empId: string, nombre: string) {
    const ok = await confirmar({
      titulo: 'Marcar como resuelto',
      mensaje: `¿Confirmas que a ${nombre} ya se le pagó este período por otra vía (o que no le corresponde)? La alerta de la campanita se apagará.`,
      confirmarLabel: 'Sí, está resuelto',
    })
    if (!ok) return
    guardar({ ...empresa, pagoRetroactivoResueltos: Array.from(new Set([...resueltos, claveCaso(empId)])) })
  }
  function revertirResuelto(empId: string) {
    guardar({ ...empresa, pagoRetroactivoResueltos: resueltos.filter(k => k !== claveCaso(empId)) })
  }

  // ─── "Activo durante el mes" ────────────────────────────────────────────
  // Unión de dos casos:
  // 1. Empleados activos HOY con fechaIngreso <= fin de mes (el caso normal).
  // 2. Empleados YA liquidados hoy, pero cuya fechaTerminacion (registrada en
  //    Liquidación) cae DESPUÉS del fin de este mes — el mes completo debía
  //    habérseles pagado por nómina normal, la liquidación llegó después. Sin
  //    este cruce contra useLiquidaciones(), un empleado ya desvinculado hoy
  //    desaparecería del filtro `activo` y ocultaría una brecha real de un
  //    mes en el que sí trabajó el período completo.
  // Se EXCLUYE cualquier empleado con fechaTerminacion DENTRO o ANTES de este
  // mes: su compensación de ese mes salió (parcial o totalmente) del módulo
  // de Liquidación, no de Nómina — que el período normal no lo procese es el
  // comportamiento esperado, no una brecha de integridad.
  // También se excluye — literalmente per spec — cualquier `suspendido`
  // vigente HOY (el modelo de datos no trackea suspensiones históricas por
  // mes, solo el estado vigente con su fecha de inicio; es la única señal
  // disponible y es razonable para el uso principal de este reporte, que es
  // auditar el mes actual o reciente antes de cerrar el período).
  const candidatos = useMemo(() => {
    if (!periodo) return []
    const finMes = finDeMes(periodo.mes, periodo.anio)
    return empleados.filter(e => {
      if (e.suspendido) return false // suspendido legítimamente no cobra (Arts. 51-53 CT)
      const ingreso = parseFechaLocal(e.fechaIngreso)
      if (ingreso > finMes) return false // aún no había ingresado ese mes
      if (e.activo) return true
      const liq = liquidaciones.find(l => l.empleadoId === e.id)
      if (!liq) return false
      return parseFechaLocal(liq.fechaTerminacion) > finMes
    })
  }, [periodo, empleados, liquidaciones])

  // ─── "Sin ingresos registrados" ─────────────────────────────────────────
  // Señal principal: el período trackea qué empleados fueron realmente
  // procesados (`empleadosProcesados`) — si esa lista existe y el empleado
  // no aparece en ella, su nómina nunca se calculó/confirmó ese mes (por
  // ejemplo, un ingreso a mitad de mes posterior a la generación del
  // período, que nunca entra al conteo de "todos procesados" que auto-avanza
  // el período a `procesada`). Mismo criterio defensivo que ya usa
  // `calcularSalarioPromedioUltimos12Meses()` en dominican-labor.ts: si el
  // período no trackea `empleadosProcesados` (períodos anteriores a esa
  // función), se asume que incluyó a todos, para no generar falsos positivos
  // masivos sobre datos históricos.
  // Señal secundaria (usa resultadoHistorico, con el snapshot o los ajustes
  // reales del período): aunque conste como procesado, si el bruto terminó en
  // cero o negativo (ej. salario base mal configurado en 0) también se marca
  // — cobertura de borde adicional, poco común en la práctica.
  const filas = useMemo(() => {
    if (!generado || !periodo) return []
    const procesados = periodo.empleadosProcesados
    const rows: { emp: typeof candidatos[number]; motivo: MotivoSinIngreso }[] = []
    for (const emp of candidatos) {
      const noProcesado = procesados !== undefined && !procesados.includes(emp.id)
      const res = resultadoHistorico(emp, periodo)
      const brutoCero = res.totalBruto <= 0
      if (noProcesado || brutoCero) {
        rows.push({ emp, motivo: noProcesado ? 'no_procesado' : 'bruto_cero' })
      }
    }
    return rows.sort((a, b) => fullName(a.emp).localeCompare(fullName(b.emp)))
  }, [generado, periodo, candidatos])

  const filasVisible = useMemo(() => {
    if (!searchQ.trim()) return filas
    const q = searchQ.toLowerCase()
    return filas.filter(({ emp }) =>
      fullName(emp).toLowerCase().includes(q) ||
      emp.cargo.toLowerCase().includes(q) ||
      emp.departamento.toLowerCase().includes(q)
    )
  }, [filas, searchQ])

  const summary = useMemo(() => ({
    evaluados: candidatos.length,
    sinIngresos: filas.length,
    conIngresos: candidatos.length - filas.length,
  }), [candidatos, filas])

  function motivoLabel(m: MotivoSinIngreso): string {
    return m === 'no_procesado' ? 'No procesado en el período' : 'Bruto calculado en RD$0'
  }

  function exportarPDF() {
    if (!periodo || filas.length === 0) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pdfHeader(doc, empresa, 'Empleados Activos Sin Ingresos', periodoLabel(periodo))

    autoTable(doc, {
      startY: 44,
      head: [['Empleado', 'Cédula', 'Departamento', 'Cargo', 'Fecha Ingreso', 'Alerta']],
      body: filas.map(({ emp, motivo }) => [
        fullName(emp), formatCedula(emp.cedula), emp.departamento, emp.cargo,
        formatDate(emp.fechaIngreso), motivoLabel(motivo),
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
    doc.save(`empleados-sin-ingresos-${periodoLabel(periodo).replace(/\s+/g, '-').toLowerCase()}.pdf`)
  }

  function exportarXlsx() {
    if (!periodo || filas.length === 0) return
    exportarExcel({
      nombreArchivo: `empleados-sin-ingresos-${periodoLabel(periodo).replace(/\s+/g, '-').toLowerCase()}`,
      empresa: empresa.nombre, logo: empresa.logo,
      rnc: empresa.rnc,
      hojas: [{
        nombre: 'Sin Ingresos',
        titulo: 'Empleados Activos Sin Ingresos',
        subtitulo: periodoLabel(periodo),
        encabezados: ['Empleado', 'Cédula', 'Departamento', 'Cargo', 'Fecha Ingreso', 'Alerta'],
        filas: filas.map(({ emp, motivo }) => [
          fullName(emp), formatCedula(emp.cedula), emp.departamento, emp.cargo,
          formatDate(emp.fechaIngreso), motivoLabel(motivo),
        ]),
        anchos: [30, 18, 22, 24, 16, 28],
      }],
    })
  }

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Empleados Sin Ingresos"
        desc="Empleados activos ese mes que no tienen ningún ingreso registrado en la nómina del período — validación de integridad antes de cerrar."
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
        <button onClick={() => { setGenerado(true); setSearchQ('') }} disabled={!periodoId} className={primaryBtn}>
          <ChevronRight className="h-4 w-4" /> Generar
        </button>
      </FilterBar>

      <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/10 px-5 py-3 flex items-start gap-2">
        <Info className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
          &quot;Activo durante el mes&quot; considera <strong>fecha de ingreso ≤ fin de mes</strong>, e incluye
          empleados ya desvinculados hoy cuya fecha de terminación (Liquidación) cae <strong>después</strong> del fin
          de este mes (el mes completo debía pagarse por nómina normal). Se excluyen empleados con una liquidación
          efectiva dentro o antes de este mes (su pago de ese mes salió del módulo de Liquidación, no de Nómina) y los
          empleados con <strong>suspensión de contrato vigente hoy</strong> (no cobran mientras dure).
        </p>
      </div>

      {!generado ? (
        <EmptyState message="Selecciona un período y haz clic en Generar para ver el reporte." />
      ) : candidatos.length === 0 ? (
        <EmptyState message="No hay empleados activos para evaluar en este período." />
      ) : filas.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] py-16 gap-3 shadow-sm dark:shadow-none">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center max-w-sm">
            Todos los empleados activos tienen ingresos registrados este mes.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Empleados Evaluados</p>
              <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{summary.evaluados}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Con Ingresos</p>
              <p className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{summary.conIngresos}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Sin Ingresos</p>
              <p className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-400 tabular-nums">{summary.sinIngresos}</p>
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
                    <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Empleado</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Departamento</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Cargo</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Fecha Ingreso</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Alerta</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                  {filasVisible.map(({ emp, motivo }) => (
                    <tr key={emp.id} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-[#1B2980] dark:text-indigo-400 whitespace-nowrap">{fullName(emp)}</p>
                        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{formatCedula(emp.cedula)}</p>
                      </td>
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{emp.departamento}</td>
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{emp.cargo}</td>
                      <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{formatDate(emp.fechaIngreso)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={motivo === 'no_procesado' ? 'danger' : 'warning'}>{motivoLabel(motivo)}</Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {resueltos.includes(claveCaso(emp.id)) ? (
                          <span className="text-xs text-zinc-500">
                            <Badge variant="success">Resuelto</Badge>{' '}
                            <button onClick={() => revertirResuelto(emp.id)} className="ml-1 underline hover:text-zinc-700">Revertir</button>
                          </span>
                        ) : (
                          <button onClick={() => marcarResuelto(emp.id, fullName(emp))} className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] px-3 py-1.5 text-xs font-medium text-[#1B2980] dark:text-indigo-400 hover:bg-zinc-50 dark:hover:bg-[#262626]">
                            Ya se pagó / no aplica
                          </button>
                        )}
                      </td>
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
