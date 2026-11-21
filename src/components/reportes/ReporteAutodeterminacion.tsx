'use client'

import { Fragment, useMemo, useState } from 'react'
import { FileDown, FileSpreadsheet } from 'lucide-react'
import { useEmpleados } from '@/lib/empleados-context'
import { usePeriodos } from '@/lib/periodos-context'
import { useEmpresa } from '@/lib/empresa-context'
import { useLiquidaciones } from '@/lib/liquidaciones-context'
import { construirAutodeterminacion, lineasAutodeterminacion, nombreArchivoAM } from '@/lib/tss-autodeterminacion'
import { BTN_PRIMARY, formatRD } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FileText } from 'lucide-react'
import { SelectorMes, PanelValidacion, NotaInfo, descargarTxt, periodoInicialSugerido, MESES_ES, verificarNominaPagada, BloqueoNominaNoPagada } from './comunes'

export function ReporteAutodeterminacion() {
  const { empleados } = useEmpleados()
  const { periodos } = usePeriodos()
  const { empresa } = useEmpresa()
  const { liquidaciones } = useLiquidaciones()
  const inicial = useMemo(() => periodoInicialSugerido(periodos), [periodos])
  const [sel, setSel] = useState<{ mes: number; anio: number } | null>(null)
  const { mes, anio } = sel ?? inicial

  const res = useMemo(
    () => construirAutodeterminacion({ empresa, empleados, periodos, liquidaciones, mes, anio }),
    [empresa, empleados, periodos, liquidaciones, mes, anio],
  )

  const gate = verificarNominaPagada(periodos, empresa, mes, anio)
  const errores = [
    ...res.erroresGlobales,
    ...res.filas.flatMap(f => f.errores.map(e => `${f.empleado.nombre} ${f.empleado.apellido}: ${e}`)),
  ]
  const avisos = res.filas.flatMap(f => f.avisos.map(e => `${f.empleado.nombre} ${f.empleado.apellido}: ${e}`))
  const bloqueado = errores.length > 0

  function descargarArchivo() {
    descargarTxt(lineasAutodeterminacion(empresa.rnc, mes, anio, res.filas), nombreArchivoAM(empresa.rnc, mes, anio))
  }

  // Llena la plantilla OFICIAL de la TSS (con su formato, logos y macro "Generar Archivo").
  async function descargarExcel() {
    const { plantillaAutodeterminacion, descargarBlob } = await import('@/lib/plantillas-oficiales')
    const blob = await plantillaAutodeterminacion({ rnc: empresa.rnc, mes, anio, filas: res.filas })
    descargarBlob(blob, nombreArchivoAM(empresa.rnc, mes, anio).replace(/\.txt$/, '.xlsm'))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Autodeterminación mensual · TSS</h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">Archivo de nómina que se envía a la Tesorería de la Seguridad Social (SUIRPLUS) cada mes.</p>
        </div>
        <SelectorMes mes={mes} anio={anio} onChange={(m, a) => setSel({ mes: m, anio: a })} />
      </div>

      {!gate.ok ? (
        <BloqueoNominaNoPagada faltantes={gate.faltantes} />
      ) : res.filas.length === 0 ? (
        <EmptyState icon={FileText} title={`Sin movimientos en ${MESES_ES[mes - 1]} ${anio}`} message="Este reporte se arma con la nómina procesada del mes (mensual o ambas quincenas), la Regalía/Bonificación pagadas y las liquidaciones con salida en ese mes. Procesa la nómina o cambia el mes." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Empleados a reportar', String(res.totales.empleados)],
              ['Salario cotizable SS', formatRD(res.totales.salarioSS)],
              ['Otras remuneraciones ISR', formatRD(res.totales.otras)],
              ['Ingresos exentos', formatRD(res.totales.exentos)],
            ].map(([k, v]) => (
              <div key={k} className="t-card px-4 py-3">
                <p className="t-subheader">{k}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{v}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">Se armó con: {res.periodosUsados.join(' · ') || '—'}</p>

          <PanelValidacion errores={errores} avisos={avisos} okTexto="Todo listo: el archivo cumple la estructura de la TSS. Revisa la tabla y descárgalo." />

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={descargarArchivo}
              disabled={bloqueado}
              title={bloqueado ? 'Corrige los puntos en rojo para poder descargar' : undefined}
              className={`${BTN_PRIMARY} inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <FileDown className="h-4 w-4" /> Descargar archivo TSS (.txt)
            </button>
            <button onClick={descargarExcel} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <FileSpreadsheet className="h-4 w-4" /> Descargar plantilla oficial TSS (Excel)
            </button>
            <span className="text-xs text-zinc-400">{nombreArchivoAM(empresa.rnc, mes, anio)}</span>
          </div>

          <div className="t-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-tabler-line dark:border-[#2e2e2e] bg-zinc-50 dark:bg-[#262626] text-left">
                    {['Empleado', 'Doc.', 'Salario SS', 'Otras remun.', 'Regalía (ex.)', 'Indemniz. (ex.)', 'Tipo', 'Origen'].map(h => (
                      <th key={h} className="t-subheader whitespace-nowrap px-4 py-2.5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-[#252840]">
                  {res.filas.map(f => (
                    <Fragment key={f.empleado.id}>
                    <tr className="hover:bg-zinc-50 dark:hover:bg-[#1a1d2e]">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-[#1B2980] dark:text-indigo-300">{f.empleado.nombre} {f.empleado.apellido}</p>
                        <p className="text-xs text-zinc-400">{f.documento || '—'}</p>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-500">{f.tipoDoc}</td>
                      <td className="px-4 py-2.5 tabular-nums text-zinc-500">{formatRD(f.salarioSS)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-zinc-500">{f.otrasRemuneraciones ? formatRD(f.otrasRemuneraciones) : '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-zinc-500">{f.exentoRegalia ? formatRD(f.exentoRegalia) : '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-zinc-500">{f.exentoIndemnizaciones ? formatRD(f.exentoIndemnizaciones) : '—'}</td>
                      <td className="px-4 py-2.5">
                        {f.tipoIngreso === '0009' ? <Badge variant="info">Entrada</Badge> : f.tipoIngreso === '0010' ? <Badge variant="warning">Salida</Badge> : <span className="text-zinc-400">Normal</span>}
                        {f.errores.length > 0 && <Badge variant="danger">Revisar</Badge>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-400">{f.detalleFuentes.join(' + ')}</td>
                    </tr>
                    {f.componentesSS.length > 0 && (
                      <tr className="bg-zinc-50/60 dark:bg-[#1a1d2e]/60">
                        <td colSpan={8} className="px-4 pb-2.5 pt-0 text-[11px] text-zinc-500">
                          <span className="font-semibold">Compone el salario SS (bruto):</span>{' '}
                          {f.componentesSS.map(c => `${c.concepto} ${formatRD(c.monto)}`).join(' · ')}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <NotaInfo>
        <p><strong>Salario SS en bruto:</strong> el salario cotizable se reporta antes de las deducciones del empleado (AFP, SFS e ISR). Por eso las vacaciones de una liquidación entran por su monto bruto, no por el neto que se le pagó al empleado. Debajo de cada empleado se detalla de qué se compone.</p>
        <p><strong>Cómo se envía:</strong> en SUIRPLUS (tss.gob.do) → «Gestión de Archivos», dentro del plazo: desde el día siguiente al tercer día hábil del mes hasta el tercer día hábil del mes siguiente. Cada envío sustituye al anterior. Si el mes ya cerró y hay que corregir, la TSS usa la autodeterminación retroactiva (AR).</p>
        <p className="mt-1.5"><strong>Criterios aplicados por Cielo Cloud</strong> (confírmalos con tu contador en el primer envío): se reporta el salario real sin topes; el aporte voluntario suma el del empleado y el de la empresa; los bonos, la bonificación por utilidades y los ingresos que pagan ISR pero no TSS van en «otras remuneraciones»; la regalía y la cesantía/preaviso van como ingresos exentos. No se informan: agente de retención único, remuneraciones de otros empleadores, saldo a favor ni salario INFOTEP distinto (quedan en ceros).</p>
      </NotaInfo>
    </div>
  )
}
