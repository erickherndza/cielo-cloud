'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { FileDown, FileSpreadsheet, Lock } from 'lucide-react'
import { useEmpleados } from '@/lib/empleados-context'
import { usePeriodos } from '@/lib/periodos-context'
import { useEmpresa } from '@/lib/empresa-context'
import { useLiquidaciones } from '@/lib/liquidaciones-context'
import { useAumentos } from '@/lib/aumentos-context'
import { useVacaciones } from '@/lib/vacaciones-context'
import { construirDGT, lineasDGT, nombreArchivoDGT, type TipoDGT } from '@/lib/dgt-mt'
import { BTN_PRIMARY, formatRD } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FileText } from 'lucide-react'
import { cargarCatalogosMT } from '@/lib/catalogos-mt'
import { SelectorMes, PanelValidacion, NotaInfo, descargarTxt, periodoInicialSugerido, MESES_ES, verificarNominaPagada, BloqueoNominaNoPagada } from './comunes'

const FORMULARIOS: { id: string; nombre: string; desc: string; listo: boolean; motivo?: string }[] = [
  { id: 'DGT3', nombre: 'DGT-3', desc: 'Novedades de ingreso', listo: true },
  { id: 'DGT4', nombre: 'DGT-4', desc: 'Salidas, cambios de salario y vacaciones', listo: true },
  { id: 'DGT2', nombre: 'DGT-2', desc: 'Horas extras día por día', listo: false, motivo: 'Requiere registrar las horas extras por día; hoy el sistema las guarda por período.' },
  { id: 'DGT5', nombre: 'DGT-5', desc: 'Personal móvil u ocasional (días × salario por día)', listo: false, motivo: 'Requiere días trabajados y salario por día por trabajador.' },
  { id: 'DGT11', nombre: 'DGT-11', desc: 'Personal de temporada', listo: false, motivo: 'Requiere fecha y duración de la temporada.' },
  { id: 'DGT12', nombre: 'DGT-12', desc: 'Salida por localidad', listo: false, motivo: 'Requiere el código de localidad.' },
]

export function ReporteDGT() {
  const { empleados } = useEmpleados()
  const { periodos } = usePeriodos()
  const { empresa, guardar } = useEmpresa()
  const { liquidaciones } = useLiquidaciones()
  const { aumentos } = useAumentos()
  const { disfrutes } = useVacaciones()
  const inicial = useMemo(() => periodoInicialSugerido(periodos), [periodos])
  const [sel, setSel] = useState<{ mes: number; anio: number } | null>(null)
  const { mes, anio } = sel ?? inicial
  const [tipo, setTipo] = useState<TipoDGT>('DGT3')
  const [pendiente, setPendiente] = useState<string | null>(null)

  const res = useMemo(
    () => construirDGT({ tipo, empresa, empleados, liquidaciones, aumentos, disfrutes, mes, anio }),
    [tipo, empresa, empleados, liquidaciones, aumentos, disfrutes, mes, anio],
  )
  const gate = verificarNominaPagada(periodos, empresa, mes, anio)
  // Mismo orden de columnas que las hojas "Plantilla DGT3-DGT4" de la Plantilla General del Ministerio.
  async function descargarExcel() {
    const { exportarExcel } = await import('@/lib/excel-export')
    const per = `${String(mes).padStart(2, '0')}${anio}`
    const cat = await cargarCatalogosMT().catch(() => null)
    const etq = (lista: [string, string][] | undefined, c: string) => { const x = lista?.find(([, k]) => k === c); return x ? `${x[0]}-${x[1]}` : c }
    const nov = (t: string) => (t === 'NI' ? 'Ingreso' : t === 'NS' ? 'Salida' : 'Cambio')
    await exportarExcel({
      nombreArchivo: `${(empresa.rnc ?? '').replace(/\D/g, '')}_${per}_${tipo}`,
      empresa: empresa.nombre, logo: empresa.logo, rnc: empresa.rnc,
      hojas: [{
        nombre: `Plantilla ${tipo.replace('DGT', 'DGT-')}`,
        titulo: `Plantilla de Archivos ${tipo.replace('DGT', 'DGT-')} — Ministerio de Trabajo`,
        subtitulo: `RNC ${empresa.rnc} · Período ${per} (MMAAAA) · Tipo planilla ${tipo}`,
        encabezados: ['Tipo Nov.', 'Número', 'Tipo Doc.', 'Número Doc.', 'Nombres', '1er. Apellido', '2do. Apellido', 'Sexo', 'Nacionalidad', 'Fecha Nacimiento', 'Salario', 'Fecha Ingreso', 'Fecha Salida', 'Ocupación', 'Desc. Ocupación', 'Inicio Vacaciones', 'Fin Vacaciones', 'ID Turno', 'ID Establecimiento', 'Fecha Cambio', 'Nivel educativo', 'Discapacidad'],
        filas: res.filas.map((f, i) => [nov(f.tipoNov), i + 1, f.tipoDoc, f.documento, f.nombres, f.apellido1, f.apellido2, f.sexo, etq(cat?.nac, f.nacionalidad), f.fechaNac, f.salario, f.fechaIngreso, f.fechaSalida, f.ocupacion ? `${f.ocupacionDesc}-${f.ocupacion}` : '', f.ocupacionDesc, f.inicioVac, f.finVac, f.turno, f.establecimiento, f.fechaCambio, etq(cat?.edu, f.nivelEdu), f.discapacidades.split(',').filter(Boolean).map(c => etq(cat?.disc, c)).join(', ')]),
        anchos: [10, 8, 8, 18, 22, 18, 18, 7, 20, 14, 14, 14, 14, 34, 30, 14, 14, 9, 14, 14, 36, 28],
        columnasEnteras: [1],
      }],
    })
  }

  const nombre = (f: { empleado: { nombre: string; apellido: string } }) => `${f.empleado.nombre} ${f.empleado.apellido}`
  const errores = [...res.erroresGlobales, ...res.filas.flatMap(f => f.errores.map(e => `${nombre(f)} (${f.etiqueta}): ${e}`))]
  const avisos = res.filas.flatMap(f => f.avisos.map(e => `${nombre(f)}: ${e}`))
  const info = FORMULARIOS.find(f => f.id === (pendiente ?? tipo))!

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Ministerio de Trabajo · Formularios DGT</h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">Archivos de carga para el sistema SIRLA (sirla.mt.gob.do), listos desde los datos de tus empleados.</p>
        </div>
        <SelectorMes mes={mes} anio={anio} onChange={(m, a) => setSel({ mes: m, anio: a })} />
      </div>

      <div className="flex flex-wrap gap-2">
        {FORMULARIOS.map(f => {
          const activo = (pendiente ?? tipo) === f.id
          return (
            <button
              key={f.id}
              onClick={() => (f.listo ? (setTipo(f.id as TipoDGT), setPendiente(null)) : setPendiente(f.id))}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                activo ? 'border-[#1B2980] bg-[#1B2980] text-white' : 'border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-[#262626]'
              }`}
            >
              {f.nombre}
              {!f.listo && <Lock className="h-3 w-3 opacity-60" />}
            </button>
          )
        })}
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400"><strong className="text-zinc-700 dark:text-zinc-200">{info.nombre}</strong> — {info.desc}</p>

      {pendiente ? (
        <EmptyState icon={FileText} title={`${info.nombre} aún no está disponible`} message={info.motivo ?? ''} />
      ) : (
        <>
          <div className="t-card grid gap-3 p-4 sm:grid-cols-2">
            <p className="t-subheader sm:col-span-2">Valores por defecto de la empresa (se usan si el empleado no tiene el suyo)</p>
            <label className="text-xs text-zinc-500">
              ID de establecimiento (últimos dígitos del RNL)
              <input
                defaultValue={empresa.dgtEstablecimientoRNL ?? ''}
                onBlur={e => e.target.value !== (empresa.dgtEstablecimientoRNL ?? '') && guardar({ ...empresa, dgtEstablecimientoRNL: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                inputMode="numeric" placeholder="Ej. 1234"
                className="mt-1 w-full rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#262626] px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200"
              />
            </label>
            <label className="text-xs text-zinc-500">
              ID de turno de horario
              <input
                defaultValue={empresa.dgtTurnoId ?? ''}
                onBlur={e => e.target.value !== (empresa.dgtTurnoId ?? '') && guardar({ ...empresa, dgtTurnoId: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                inputMode="numeric" placeholder="Ej. 1"
                className="mt-1 w-full rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#262626] px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200"
              />
            </label>
          </div>

          {!gate.ok ? (
            <BloqueoNominaNoPagada faltantes={gate.faltantes} />
          ) : res.filas.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={`Sin novedades en ${MESES_ES[mes - 1]} ${anio}`}
              message={tipo === 'DGT3' ? 'No hay empleados con fecha de ingreso en este mes.' : 'No hay salidas, cambios de salario aplicados ni vacaciones registradas en este mes.'}
            />
          ) : (
            <>
              <PanelValidacion errores={errores} avisos={avisos} okTexto="Todo listo: el archivo cumple la estructura del Ministerio. Revisa la tabla y descárgalo." />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => descargarTxt(lineasDGT(empresa.rnc, tipo, mes, anio, res.filas), nombreArchivoDGT(empresa.rnc, tipo, mes, anio))}
                  disabled={errores.length > 0}
                  title={errores.length > 0 ? 'Corrige los puntos en rojo para poder descargar' : undefined}
                  className={`${BTN_PRIMARY} inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <FileDown className="h-4 w-4" /> Descargar {info.nombre} (.txt)
                </button>
                <button onClick={descargarExcel} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  <FileSpreadsheet className="h-4 w-4" /> Descargar Excel (plantilla {info.nombre})
                </button>
                <span className="text-xs text-zinc-400">{nombreArchivoDGT(empresa.rnc, tipo, mes, anio)}</span>
              </div>
              <div className="t-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-tabler-line dark:border-[#2e2e2e] bg-zinc-50 dark:bg-[#262626] text-left">
                        {['Empleado', 'Novedad', 'Salario', 'Ingreso', 'Salida / cambio', 'Ocupación', 'Estado'].map(h => (
                          <th key={h} className="t-subheader whitespace-nowrap px-4 py-2.5">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-[#252840]">
                      {res.filas.map((f, i) => (
                        <tr key={`${f.empleado.id}-${i}`} className="hover:bg-zinc-50 dark:hover:bg-[#1a1d2e]">
                          <td className="px-4 py-2.5">
                            <Link href={`/empleados?ver=${f.empleado.id}`} className="font-medium text-[#1B2980] dark:text-indigo-300 hover:underline">{nombre(f)}</Link>
                            <p className="text-xs text-zinc-400">{f.documento || '—'}</p>
                          </td>
                          <td className="px-4 py-2.5"><Badge variant={f.tipoNov === 'NI' ? 'info' : f.tipoNov === 'NS' ? 'warning' : 'neutral'}>{f.etiqueta}</Badge></td>
                          <td className="px-4 py-2.5 tabular-nums text-zinc-500">{formatRD(f.salario)}</td>
                          <td className="px-4 py-2.5 text-zinc-500">{f.fechaIngreso ? `${f.fechaIngreso.slice(0, 2)}/${f.fechaIngreso.slice(2, 4)}/${f.fechaIngreso.slice(4)}` : '—'}</td>
                          <td className="px-4 py-2.5 text-zinc-500">
                            {[f.fechaSalida, f.fechaCambio].find(Boolean)?.replace(/(\d{2})(\d{2})(\d{4})/, '$1/$2/$3') ?? '—'}
                            {f.inicioVac && <span className="block text-xs text-zinc-400">Vac. {f.inicioVac.replace(/(\d{2})(\d{2})(\d{4})/, '$1/$2/$3')} – {f.finVac.replace(/(\d{2})(\d{2})(\d{4})/, '$1/$2/$3')}</span>}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-zinc-500">{f.ocupacionDesc || '—'}</td>
                          <td className="px-4 py-2.5">{f.errores.length ? <Badge variant="danger">Faltan datos</Badge> : <Badge variant="success">Listo</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <NotaInfo>
        <p><strong>Datos del empleado que piden estos formularios:</strong> sexo, nacionalidad (catálogo del Ministerio), ocupación, turno, establecimiento (RNL), nivel educativo y discapacidad. Se completan en Empleados → editar → «Datos para TSS y Ministerio de Trabajo». Haz clic en el nombre de un empleado de la tabla para ir a su ficha.</p>
        <p className="mt-1.5"><strong>Criterios de Cielo Cloud</strong> (confírmalos en el primer envío): el salario reportado es el salario mensual vigente (en cambios, el nuevo); las vacaciones se informan como «cambio» con fecha de inicio y fin; los códigos faltantes se rellenan con ceros como hace la plantilla oficial.</p>
      </NotaInfo>
    </div>
  )
}
