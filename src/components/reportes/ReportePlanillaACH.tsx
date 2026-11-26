'use client'

import { useState, useMemo } from 'react'
import { ChevronRight, AlertCircle, Search, CheckCircle2, XCircle } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { formatRD, fullName } from '@/lib/utils'
import { exportarExcel } from '@/lib/excel-export'
import type { PeriodoNomina, Empresa, Empleado } from '@/types'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { NAVY, pdfHeader, periodoLabel, resultadoHistorico, selectCls, primaryBtn, FilterBar, ReportHeader } from './shared'

// ─── Reporte Planilla Bancaria / ACH ─────────────────────────────────────────
export function ReportePlanillaACH({
  empresa, empleados, periodos,
}: {
  empresa: Empresa
  empleados: ReturnType<typeof useEmpleados>['empleados']
  periodos: PeriodoNomina[]
}) {
  const sorted = useMemo(() =>
    [...periodos].filter(p => p.estado !== 'en_proceso' && p.tipo !== 'regalia' && p.tipo !== 'bonificacion').sort((a, b) => new Date(b.fechaGeneracion).getTime() - new Date(a.fechaGeneracion).getTime()),
    [periodos]
  )
  const bancos = useMemo(() => Array.from(new Set(empleados.map(e => e.banco).filter(Boolean))).sort() as string[], [empleados])

  const [periodoId, setPeriodoId] = useState<string>(sorted[0]?.id ?? '')
  const [filtroBanco, setFiltroBanco] = useState('todos')
  const [generado, setGenerado] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  const periodo = sorted.find(p => p.id === periodoId)
  const sinCuenta = empleados.filter(e => e.activo && (!e.numeroCuenta || !e.banco)).length

  const filas = useMemo(() => {
    if (!periodo || !generado) return []
    // Roster REAL de ese período (snapshot de quién fue procesado), no la
    // planilla activa de HOY — a diferencia del resto de reportes de este
    // archivo (Nómina, TSS, Costo por Departamento), este usaba
    // `empleados.filter(activo)` sin importar el período seleccionado, así
    // que "generar" para un mes de hace años mostraba (y sumaba) la nómina
    // de hoy, con nombres y montos completamente ajenos a ese mes real.
    const tieneSnapshots = periodo.resultadosPorEmpleado && Object.keys(periodo.resultadosPorEmpleado).length > 0
    const roster = tieneSnapshots
      ? Object.keys(periodo.resultadosPorEmpleado!).flatMap(id => {
          const e = empleados.find(x => x.id === id)
          return e ? [e] : []
        })
      : empleados.filter(e => e.activo)
    return roster
      .filter(e => e.numeroCuenta && e.banco)
      .filter(e => filtroBanco === 'todos' || e.banco === filtroBanco)
      .map(emp => {
        const res = resultadoHistorico(emp, periodo)
        return { emp, neto: res.salarioNeto }
      })
      .sort((a, b) => (a.emp.banco ?? '').localeCompare(b.emp.banco ?? '') || fullName(a.emp).localeCompare(fullName(b.emp)))
  }, [periodo, generado, empleados, filtroBanco])

  const filasVisible = useMemo(() => {
    if (!searchQ.trim()) return filas
    const q = searchQ.toLowerCase()
    return filas.filter(({ emp }) => fullName(emp).toLowerCase().includes(q) || emp.departamento.toLowerCase().includes(q))
  }, [filas, searchQ])

  const totalNeto = useMemo(() => filas.reduce((s, f) => s + f.neto, 0), [filas])

  // ─── Validación antes de enviar ────────────────────────────────────────────
  // No existen especificaciones públicas oficiales, exactas y unificadas por
  // banco dominicano para un archivo de transferencia (ACH) — cada institución
  // maneja su propio formato interno. Las reglas de abajo son una
  // interpretación GENÉRICA y defendible de Cielo Cloud (no una spec bancaria
  // oficial), pensada para atrapar los errores de captura más comunes antes de
  // cargar la planilla al banco manualmente.
  const validacion = useMemo(() => {
    const issues: { empId: string; nombre: string; banco: string; nivel: 'error' | 'advertencia'; motivo: string }[] = []

    // Regla 1 (bloqueante): cuenta bancaria requerida. Se evalúa sobre TODOS
    // los empleados activos, sin importar el filtro de banco seleccionado —
    // es un requisito de completitud de datos, no de la vista filtrada, y un
    // empleado sin cuenta no puede recibir su pago por ACH en absoluto.
    for (const e of empleados) {
      if (!e.activo) continue
      if (!e.banco && !e.numeroCuenta) {
        issues.push({ empId: e.id, nombre: fullName(e), banco: '—', nivel: 'error', motivo: 'Sin banco ni número de cuenta registrados' })
      } else if (!e.banco) {
        issues.push({ empId: e.id, nombre: fullName(e), banco: '—', nivel: 'error', motivo: 'Falta el banco' })
      } else if (!e.numeroCuenta) {
        issues.push({ empId: e.id, nombre: fullName(e), banco: e.banco, nivel: 'error', motivo: 'Falta el número de cuenta' })
      }
    }

    // Conteo de "banco + # cuenta" (normalizado) dentro de la planilla ya generada, para la Regla 4
    const conteoCuentas = new Map<string, number>()
    for (const { emp } of filas) {
      const norm = (emp.numeroCuenta ?? '').replace(/[-\s]/g, '')
      const clave = `${emp.banco}|${norm}`
      conteoCuentas.set(clave, (conteoCuentas.get(clave) ?? 0) + 1)
    }

    for (const { emp, neto } of filas) {
      const nombre = fullName(emp)
      const banco = emp.banco ?? '—'
      const cuentaRaw = emp.numeroCuenta ?? ''
      const cuentaNorm = cuentaRaw.replace(/[-\s]/g, '')

      // Regla 2 (bloqueante): formato de número de cuenta — solo dígitos (se
      // permiten guiones/espacios como separadores visuales) y una longitud
      // razonable de 8 a 20 caracteres. Umbral genérico: cubre cuentas de
      // ahorro/corriente típicas de la banca dominicana sin atarse a la regla
      // interna exacta de un banco en particular.
      if (!/^\d+$/.test(cuentaNorm) || cuentaNorm.length < 8 || cuentaNorm.length > 20) {
        issues.push({ empId: emp.id, nombre, banco, nivel: 'error', motivo: `Formato de cuenta inválido ("${cuentaRaw}") — se esperan solo dígitos y 8–20 caracteres` })
      }

      // Regla 3 (bloqueante): caracteres que rompen archivos de texto plano /
      // delimitados que suelen usar los bancos para carga masiva (comillas,
      // pipe "|" o tabulador).
      if (/["'|\t]/.test(nombre)) {
        issues.push({ empId: emp.id, nombre, banco, nivel: 'error', motivo: 'El nombre contiene caracteres no permitidos (comillas, "|" o tabulador)' })
      }

      // Regla 4 (advertencia, no bloqueante): cuentas duplicadas — mismo banco
      // y mismo número de cuenta en dos empleados de la misma planilla. Puede
      // ser legítimo en casos raros (p. ej. una cuenta mancomunada), así que
      // se señala pero no bloquea el envío.
      const clave = `${emp.banco}|${cuentaNorm}`
      if ((conteoCuentas.get(clave) ?? 0) > 1) {
        issues.push({ empId: emp.id, nombre, banco, nivel: 'advertencia', motivo: `Cuenta compartida con otro(s) empleado(s) de esta planilla (${conteoCuentas.get(clave)} coinciden)` })
      }

      // Regla 5 (bloqueante): el monto neto a transferir debe ser mayor a cero
      if (neto <= 0) {
        issues.push({ empId: emp.id, nombre, banco, nivel: 'error', motivo: `Monto a transferir inválido (${formatRD(neto, 2)}) — debe ser mayor a cero` })
      }
    }

    // Regla 6: reconciliación de suma — control de integridad simple, debería
    // ser trivialmente cierto, pero se verifica como sanity check.
    const sumaFilas = filas.reduce((s, f) => s + f.neto, 0)
    const reconciliaOk = Math.abs(sumaFilas - totalNeto) < 0.01

    const idsConError = new Set(issues.filter(i => i.nivel === 'error').map(i => i.empId))
    const idsConAdvertencia = new Set(issues.filter(i => i.nivel === 'advertencia' && !idsConError.has(i.empId)).map(i => i.empId))
    // Universo de "candidatos a fila": los que sí están en la planilla filtrada,
    // más los empleados activos excluidos de entrada por falta de cuenta (Regla 1).
    const totalCandidatos = filas.length + empleados.filter(e => e.activo && (!e.banco || !e.numeroCuenta)).length
    const pasaron = Math.max(0, totalCandidatos - idsConError.size - idsConAdvertencia.size)

    return {
      errores: issues.filter(i => i.nivel === 'error'),
      advertencias: issues.filter(i => i.nivel === 'advertencia'),
      reconciliaOk,
      pasaron,
      totalCandidatos,
    }
  }, [empleados, filas, totalNeto])

  function exportarPDF() {
    if (!periodo || filas.length === 0) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pdfHeader(doc, empresa, 'Planilla Bancaria / ACH', periodoLabel(periodo))
    autoTable(doc, {
      startY: 44,
      head: [['Empleado','Departamento','Banco','# Cuenta','Sal. Neto']],
      body: filas.map(({ emp, neto }) => [fullName(emp), emp.departamento, emp.banco ?? '—', emp.numeroCuenta ?? '—', neto.toFixed(2)]),
      foot: [['TOTALES', '', '', '', totalNeto.toFixed(2)]],
      theme: 'striped',
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      footStyles: { fillColor: [240, 240, 240], textColor: NAVY, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 4: { halign: 'right' } },
      didDrawPage: (data) => { doc.setFontSize(7); doc.setTextColor(150); doc.text(`Página ${data.pageNumber}`, 283, 205, { align: 'right' }) },
    })
    doc.save(`planilla-ach-${periodoLabel(periodo).replace(/\s+/g, '-').toLowerCase()}.pdf`)
  }

  function exportarXlsx() {
    if (!periodo || filas.length === 0) return
    exportarExcel({
      nombreArchivo: `planilla-ach-${periodoLabel(periodo).replace(/\s+/g, '-').toLowerCase()}`,
      empresa: empresa.nombre, logo: empresa.logo, rnc: empresa.rnc,
      hojas: [{
        nombre: 'ACH', titulo: 'Planilla Bancaria / ACH', subtitulo: periodoLabel(periodo),
        encabezados: ['Nombre','Apellido','Departamento','Banco','# Cuenta','Monto RD$'],
        filas: filas.map(({ emp, neto }) => [emp.nombre, emp.apellido, emp.departamento, emp.banco ?? '', emp.numeroCuenta ?? '', neto]),
        totales: ['TOTALES', '', '', '', '', totalNeto],
        anchos: [22, 22, 22, 18, 22, 16],
      }],
    })
  }

  return (
    <div className="space-y-5">
      <ReportHeader
        title="Planilla Bancaria / ACH"
        desc="Lista de transferencias por período, agrupadas por banco. Formato optimizado para carga bancaria."
        onPDF={filas.length > 0 ? exportarPDF : undefined}
        onExcel={filas.length > 0 ? exportarXlsx : undefined}
        disabled={validacion.errores.length > 0}
        disabledReason="Corrige los errores bloqueantes de la validación antes de exportar la planilla."
      />
      <FilterBar>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Período:
          <select value={periodoId} onChange={e => { setPeriodoId(e.target.value); setGenerado(false) }} className={selectCls}>
            {sorted.length === 0 ? <option value="">Sin períodos</option> : sorted.map(p => <option key={p.id} value={p.id}>{periodoLabel(p)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Banco:
          <select value={filtroBanco} onChange={e => { setFiltroBanco(e.target.value); setGenerado(false) }} className={selectCls}>
            <option value="todos">Todos</option>
            {bancos.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <button onClick={() => { setGenerado(true); setSearchQ('') }} disabled={!periodoId} className={primaryBtn}>
          <ChevronRight className="h-4 w-4" /> Generar
        </button>
      </FilterBar>
      {!generado ? <EmptyState message="Selecciona un período y haz clic en Generar." /> : filas.length === 0 ? <EmptyState message="No hay empleados con cuenta bancaria registrada para este filtro." /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Transferencias</p>
              <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{filas.length}</p>
            </div>
            <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-4 shadow-sm dark:shadow-none">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Total a Transferir</p>
              <p className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{formatRD(totalNeto)}</p>
            </div>
            {sinCuenta > 0 && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 p-4">
                <p className="text-xs text-amber-700 dark:text-amber-400">Sin cuenta bancaria</p>
                <p className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">{sinCuenta} emp.</p>
              </div>
            )}
          </div>

          {/* Validación antes de enviar — reglas genéricas de Cielo Cloud (ver comentario en `validacion` arriba) */}
          <div className={`rounded-lg border p-4 ${
            validacion.errores.length > 0
              ? 'border-rose-200 dark:border-rose-800/40 bg-rose-50/60 dark:bg-rose-950/10'
              : validacion.advertencias.length > 0
              ? 'border-amber-200 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/10'
              : 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/60 dark:bg-emerald-950/10'
          }`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                {validacion.errores.length > 0
                  ? <XCircle className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
                  : <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Validación antes de enviar</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-md">
                    Reglas genéricas de formato bancario — interpretación propia de Cielo Cloud ante la falta de especificaciones públicas exactas por banco.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm shrink-0 pl-7 sm:pl-0">
                <span className="tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">{validacion.pasaron} OK</span>
                <span className="tabular-nums font-semibold text-rose-700 dark:text-rose-400">{validacion.errores.length} error{validacion.errores.length === 1 ? '' : 'es'}</span>
                <span className="tabular-nums font-semibold text-amber-700 dark:text-amber-400">{validacion.advertencias.length} advertencia{validacion.advertencias.length === 1 ? '' : 's'}</span>
              </div>
            </div>

            {(validacion.errores.length > 0 || validacion.advertencias.length > 0) && (
              <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-zinc-200/70 dark:border-[#2e2e2e]/70 divide-y divide-zinc-200/70 dark:divide-[#2e2e2e]/70 bg-white/60 dark:bg-[#171717]/40">
                {[...validacion.errores, ...validacion.advertencias].map((iss, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    {iss.nivel === 'error'
                      ? <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                      : <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                    <span className="font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap">{iss.nombre}</span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500 whitespace-nowrap">{iss.banco}</span>
                    <span className={`text-xs ${iss.nivel === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>{iss.motivo}</span>
                  </div>
                ))}
              </div>
            )}

            {!validacion.reconciliaOk && (
              <p className="mt-3 flex items-center gap-2 text-xs font-medium text-rose-600 dark:text-rose-400">
                <XCircle className="h-3.5 w-3.5 shrink-0" />
                La suma de las filas individuales no coincide con el total mostrado — posible problema de datos, revisa antes de enviar.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] overflow-hidden shadow-sm dark:shadow-none">
            <div className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] px-5 py-2.5 flex items-center gap-2">
              <Search className="h-4 w-4 text-zinc-400 shrink-0" />
              <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Buscar por nombre o departamento…" className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none" />
              <span className="text-xs text-zinc-400 shrink-0">{filasVisible.length}/{filas.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] text-left">
                    {['Empleado','Departamento','Banco','# Cuenta','Sal. Neto'].map(h => (
                      <th key={h} className="px-5 py-3 text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500 dark:text-zinc-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                  {filasVisible.map(({ emp, neto }) => (
                    <tr key={emp.id} className="hover:bg-zinc-50 dark:hover:bg-[#262626] transition-colors">
                      <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{fullName(emp)}</td>
                      <td className="px-5 py-3 text-xs text-zinc-500 dark:text-zinc-400">{emp.departamento}</td>
                      <td className="px-5 py-3 text-xs text-zinc-600 dark:text-zinc-400">{emp.banco ?? '—'}</td>
                      <td className="px-5 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{emp.numeroCuenta ?? '—'}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">{formatRD(neto)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#c7cef0] dark:border-[#2e2e2e] bg-[#eef0fb] dark:bg-[#262626] text-[#1B2980] dark:text-indigo-300 font-bold">
                    <td colSpan={4} className="px-5 py-3 text-left text-xs uppercase tracking-wide">TOTAL TRANSFERIR ({filasVisible.length} cuentas)</td>
                    <td className="px-5 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-300">{formatRD(totalNeto)}</td>
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
