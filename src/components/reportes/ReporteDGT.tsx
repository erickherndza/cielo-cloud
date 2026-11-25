'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { FileDown, FileSpreadsheet, Plus, Trash2 } from 'lucide-react'
import { useEmpleados } from '@/lib/empleados-context'
import { usePeriodos } from '@/lib/periodos-context'
import { useEmpresa } from '@/lib/empresa-context'
import { useLiquidaciones } from '@/lib/liquidaciones-context'
import { useAumentos } from '@/lib/aumentos-context'
import { useVacaciones } from '@/lib/vacaciones-context'
import { useHorasExtras } from '@/lib/horas-extras-context'
import { parseFechaLocal } from '@/lib/utils'
import { construirDGT, lineasDGT, nombreArchivoDGT, type TipoDGT, type ExtrasDGT } from '@/lib/dgt-mt'
import { cargarCatalogosMT } from '@/lib/catalogos-mt'
import { BTN_PRIMARY, formatRD } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FileText } from 'lucide-react'
import { SelectorMes, PanelValidacion, NotaInfo, descargarTxt, periodoInicialSugerido, MESES_ES, verificarNominaPagada, BloqueoNominaNoPagada } from './comunes'

const FORMULARIOS: { id: TipoDGT; nombre: string; desc: string }[] = [
  { id: 'DGT3', nombre: 'DGT-3', desc: 'Novedades de ingreso' },
  { id: 'DGT4', nombre: 'DGT-4', desc: 'Salidas, cambios de salario y vacaciones' },
  { id: 'DGT2', nombre: 'DGT-2', desc: 'Horas extras día por día' },
  { id: 'DGT5', nombre: 'DGT-5', desc: 'Personal móvil u ocasional (días × salario por día)' },
  { id: 'DGT11', nombre: 'DGT-11', desc: 'Personal de temporada (contrato estacional)' },
  { id: 'DGT12', nombre: 'DGT-12', desc: 'Salidas con establecimiento / localidad' },
]

const inp = 'rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#262626] px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200'
const fechaVista = (d: string) => (d ? d.replace(/(\d{2})(\d{2})(\d{4})/, '$1/$2/$3') : '—')

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
  const per = `${String(mes).padStart(2, '0')}${anio}`

  // Datos extra que piden DGT-5 y DGT-11 (no se guardan: se piden cada vez)
  const [fechaTemporada, setFechaTemporada] = useState('')
  const [duracion, setDuracion] = useState('')
  const [dias, setDias] = useState<Record<string, string>>({})
  const [salDia, setSalDia] = useState<Record<string, string>>({})
  const [incluir, setIncluir] = useState<Record<string, string[]>>({})
  const extras: ExtrasDGT = {
    incluirIds: incluir[tipo] ?? [],
    fechaInicioTemporada: fechaTemporada || undefined,
    duracionMeses: duracion ? Number(duracion) : undefined,
    diasTrabajados: Object.fromEntries(Object.entries(dias).filter(([, v]) => v).map(([k, v]) => [k, Number(v)])),
    salarioPorDia: Object.fromEntries(Object.entries(salDia).filter(([, v]) => v).map(([k, v]) => [k, Number(v)])),
  }

  const res = useMemo(
    () => construirDGT({ tipo, empresa, empleados, liquidaciones, aumentos, disfrutes, mes, anio, extras }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tipo, empresa, empleados, liquidaciones, aumentos, disfrutes, mes, anio, fechaTemporada, duracion, dias, salDia, incluir],
  )
  // Todos los formularios del mes, para el libro completo (un solo Excel con todas las hojas)
  const todos = useMemo(() => {
    const o = {} as Record<TipoDGT, ReturnType<typeof construirDGT>>
    for (const f of FORMULARIOS) o[f.id] = construirDGT({ tipo: f.id, empresa, empleados, liquidaciones, aumentos, disfrutes, mes, anio, extras: { ...extras, incluirIds: incluir[f.id] ?? [] } })
    return o
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa, empleados, liquidaciones, aumentos, disfrutes, mes, anio, fechaTemporada, duracion, dias, salDia, incluir])
  const gate = verificarNominaPagada(periodos, empresa, mes, anio)
  const nombre = (f: { empleado: { nombre: string; apellido: string } }) => `${f.empleado.nombre} ${f.empleado.apellido}`
  const errores = [...res.erroresGlobales, ...res.filas.flatMap(f => f.errores.map(e => `${nombre(f)} (${f.etiqueta}): ${e}`))]
  const avisos = res.filas.flatMap(f => f.avisos.map(e => `${nombre(f)}: ${e}`))
  const info = FORMULARIOS.find(f => f.id === tipo)!

  async function descargarExcel() {
    const { plantillaDGT, descargarBlob } = await import('@/lib/plantillas-oficiales')
    const cat = await cargarCatalogosMT().catch(() => null)
    const blob = await plantillaDGT({ rnc: empresa.rnc, mes, anio, tipo, filas: res.filas, cat, extras })
    descargarBlob(blob, nombreArchivoDGT(empresa.rnc, tipo, mes, anio).replace(/\.txt$/, '.xlsm'))
  }

  async function descargarLibroCompleto() {
    const { plantillaDGTCompleta, descargarBlob } = await import('@/lib/plantillas-oficiales')
    const cat = await cargarCatalogosMT().catch(() => null)
    const formularios = Object.fromEntries(FORMULARIOS.map(f => [f.id, todos[f.id].filas])) as Record<TipoDGT, typeof res.filas>
    const blob = await plantillaDGTCompleta({ rnc: empresa.rnc, mes, anio, cat, extras, formularios })
    descargarBlob(blob, `${(empresa.rnc ?? '').replace(/\D/g, '')}_${per}_DGT_COMPLETO.xlsm`)
  }

  // ── DGT-2: captura de horas extras por día ──
  const { registros: registrosHE } = useHorasExtras()
  const [empSel, setEmpSel] = useState('')
  const [diaSel, setDiaSel] = useState('1')
  const [horasSel, setHorasSel] = useState('')
  const [pctSel, setPctSel] = useState('35')
  const datos2 = empresa.horasExtrasDGT2?.[per] ?? {}
  function guardarDatos2(nuevo: typeof datos2) {
    const todo = { ...(empresa.horasExtrasDGT2 ?? {}) }
    if (Object.keys(nuevo).length) todo[per] = nuevo; else delete todo[per]
    guardar({ ...empresa, horasExtrasDGT2: todo })
  }
  // Registros diarios del módulo Horas Extras que caen en este mes, agrupados por empleado y día
  const desdeModulo = useMemo(() => {
    const out: Record<string, Record<string, { h: number; pct: number }>> = {}
    for (const r of registrosHE) {
      const f = parseFechaLocal(r.fecha)
      if (f.getMonth() + 1 !== mes || f.getFullYear() !== anio) continue
      const dia = String(f.getDate())
      const d = (out[r.empleadoId] ??= {})
      const prev = d[dia]
      // Si un mismo día mezcla 35% y 100%, el formulario admite un solo porcentaje: se usa 100
      d[dia] = { h: Math.round(((prev?.h ?? 0) + r.horas) * 100) / 100, pct: r.tipo === 'he100' || prev?.pct === 100 ? 100 : 35 }
    }
    return out
  }, [registrosHE, mes, anio])
  function importarDesdeModulo() {
    const nuevo = { ...datos2 }
    for (const [id, dias] of Object.entries(desdeModulo)) {
      const actual = nuevo[id] ?? { causa: '', dias: {} }
      nuevo[id] = { ...actual, dias: { ...actual.dias, ...dias } }
    }
    guardarDatos2(nuevo)
  }
  function agregarDia() {
    const h = Number(horasSel)
    if (!empSel || !(h > 0) || h >= 100) return
    const actual = datos2[empSel] ?? { causa: '', dias: {} }
    guardarDatos2({ ...datos2, [empSel]: { ...actual, dias: { ...actual.dias, [diaSel]: { h, pct: Number(pctSel) } } } })
    setHorasSel('')
  }
  // Quienes pudieron trabajar horas extras ese mes: activos y también los que salieron durante el mes o después
  const trabajaronEnMes = empleados.filter(e => {
    const ini = new Date(anio, mes - 1, 1), fin = new Date(anio, mes, 0)
    if (new Date(e.fechaIngreso + 'T00:00:00') > fin) return false
    const salida = liquidaciones.find(l => l.empleadoId === e.id)?.fechaTerminacion ?? e.fechaSalidaPendiente
    return e.activo || !!(salida && new Date(salida + 'T00:00:00') >= ini)
  })
  // Horas extras que la nómina ya trae en este mes (solo el total; el Ministerio las pide por día)
  const heNomina = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of periodos) {
      if ((p.tipo !== 'mensual' && p.tipo !== 'quincenal') || p.mes !== mes || p.anio !== anio) continue
      for (const [id, ajs] of Object.entries(p.ajustesPorEmpleado ?? {}))
        for (const a of ajs) if (a.concepto === 'horas_extras_35' || a.concepto === 'horas_extras_100') m.set(id, (m.get(id) ?? 0) + a.valor)
    }
    return Array.from(m.entries())
  }, [periodos, mes, anio])

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
        {FORMULARIOS.map(f => (
          <button
            key={f.id}
            onClick={() => setTipo(f.id)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              tipo === f.id ? 'border-[#1B2980] bg-[#1B2980] text-white' : 'border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-[#262626]'
            }`}
          >
            {f.nombre}
          </button>
        ))}
      </div>
      {gate.ok && (
        <div className="t-card flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Libro completo: todos los DGT en un solo Excel</p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {FORMULARIOS.map(f => `${f.nombre}: ${todos[f.id].filas.length}`).join(' · ')} registro(s) en {MESES_ES[mes - 1]} {anio}.
              {FORMULARIOS.some(f => todos[f.id].filas.some(x => x.errores.length > 0) || todos[f.id].erroresGlobales.length > 0) && ' Hay datos por completar en algún formulario (revísalos en su pestaña); el libro se descarga igual, como borrador.'}
            </p>
          </div>
          <button onClick={descargarLibroCompleto} className={`${BTN_PRIMARY} inline-flex items-center gap-2`}>
            <FileSpreadsheet className="h-4 w-4" /> Descargar libro completo (Excel)
          </button>
        </div>
      )}
      <p className="text-sm text-zinc-500 dark:text-zinc-400"><strong className="text-zinc-700 dark:text-zinc-200">{info.nombre}</strong> — {info.desc}</p>

      {!gate.ok ? (
        <BloqueoNominaNoPagada faltantes={gate.faltantes} />
      ) : (
        <>
          <div className="t-card grid gap-3 p-4 sm:grid-cols-2">
            <p className="t-subheader sm:col-span-2">Valores por defecto de la empresa (se usan si el empleado no tiene el suyo)</p>
            <label className="text-xs text-zinc-500">
              ID de establecimiento (últimos dígitos del RNL)
              <input
                defaultValue={empresa.dgtEstablecimientoRNL ?? ''}
                onBlur={e => e.target.value !== (empresa.dgtEstablecimientoRNL ?? '') && guardar({ ...empresa, dgtEstablecimientoRNL: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                inputMode="numeric" placeholder="Ej. 1234" className={`mt-1 w-full ${inp}`}
              />
            </label>
            <label className="text-xs text-zinc-500">
              ID de turno de horario
              <input
                defaultValue={empresa.dgtTurnoId ?? ''}
                onBlur={e => e.target.value !== (empresa.dgtTurnoId ?? '') && guardar({ ...empresa, dgtTurnoId: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                inputMode="numeric" placeholder="Ej. 1" className={`mt-1 w-full ${inp}`}
              />
            </label>
          </div>

          {(tipo === 'DGT5' || tipo === 'DGT11') && (
            <div className="t-card p-4">
              <p className="t-subheader mb-1">Empleados a incluir</p>
              <p className="mb-3 text-xs text-zinc-500">Se incluyen automáticamente los de contrato «{tipo === 'DGT5' ? 'Móvil / Ocasional' : 'Estacional / Temporada'}». Marca aquí a otros empleados que también quieras reportar.</p>
              <div className="flex flex-wrap gap-2">
                {empleados.filter(e => e.activo && e.tipoContrato !== (tipo === 'DGT5' ? 'ocasional' : 'estacional')).map(e => {
                  const on = (incluir[tipo] ?? []).includes(e.id)
                  return (
                    <button key={e.id} onClick={() => setIncluir({ ...incluir, [tipo]: on ? (incluir[tipo] ?? []).filter(x => x !== e.id) : [...(incluir[tipo] ?? []), e.id] })}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${on ? 'border-[#1B2980] bg-[#1B2980] text-white' : 'border-tabler-line dark:border-[#2e2e2e] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-[#262626]'}`}>
                      {e.nombre} {e.apellido}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {tipo === 'DGT11' && (
            <div className="t-card grid gap-3 p-4 sm:grid-cols-2">
              <p className="t-subheader sm:col-span-2">Datos de la temporada</p>
              <label className="text-xs text-zinc-500">Fecha de inicio de la temporada
                <input type="date" value={fechaTemporada} onChange={e => setFechaTemporada(e.target.value)} className={`mt-1 w-full ${inp}`} />
              </label>
              <label className="text-xs text-zinc-500">Duración (meses)
                <input inputMode="numeric" value={duracion} onChange={e => setDuracion(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="Ej. 3" className={`mt-1 w-full ${inp}`} />
              </label>
            </div>
          )}

          {tipo === 'DGT5' && res.filas.length > 0 && (
            <div className="t-card p-4">
              <p className="t-subheader mb-3">Días trabajados y salario por día (personal móvil u ocasional)</p>
              <div className="space-y-2">
                {res.filas.map(f => (
                  <div key={f.empleado.id} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="w-56 truncate font-medium text-zinc-700 dark:text-zinc-200">{nombre(f)}</span>
                    <input aria-label="Días trabajados" inputMode="numeric" placeholder="Días" value={dias[f.empleado.id] ?? ''} onChange={e => setDias({ ...dias, [f.empleado.id]: e.target.value.replace(/\D/g, '').slice(0, 2) })} className={`w-24 ${inp}`} />
                    <input aria-label="Salario por día" inputMode="decimal" placeholder={`Salario/día (${(f.salarioDia ?? 0).toFixed(2)})`} value={salDia[f.empleado.id] ?? ''} onChange={e => setSalDia({ ...salDia, [f.empleado.id]: e.target.value.replace(/[^\d.]/g, '') })} className={`w-52 ${inp}`} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {tipo === 'DGT2' && (
            <div className="t-card space-y-4 p-4">
              <p className="t-subheader">Horas extras día por día — {MESES_ES[mes - 1]} {anio}</p>
              <p className="text-xs text-zinc-500">La nómina guarda solo el total de horas del período; el Ministerio las pide por día. Captúralas aquí (una fila por día, un porcentaje por día).</p>
              {heNomina.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  Con horas extras en la nómina de este mes:
                  {heNomina.map(([id, h]) => {
                    const e = empleados.find(x => x.id === id)
                    return e ? (
                      <button key={id} onClick={() => setEmpSel(id)} className="rounded-full border border-tabler-line dark:border-[#2e2e2e] px-2.5 py-1 font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-[#262626]">
                        {e.nombre} {e.apellido} · {h} h en total
                      </button>
                    ) : null
                  })}
                </div>
              )}
              {Object.keys(desdeModulo).length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-[#eef0fb] dark:bg-[#1a1d2e] px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">
                  <span>El módulo Horas Extras tiene registros de este mes para {Object.keys(desdeModulo).length} empleado(s).</span>
                  <button onClick={importarDesdeModulo} className="rounded-lg border border-[#1B2980] px-2.5 py-1 font-medium text-[#1B2980] dark:text-indigo-300 dark:border-indigo-300">Traer desde Horas Extras</button>
                  <span className="text-zinc-500">Si un día mezcla 35% y 100%, se usa 100%. Falta indicar la causa A–E de cada empleado.</span>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-zinc-500">Empleado
                  <select value={empSel} onChange={e => setEmpSel(e.target.value)} className={`mt-1 block w-56 ${inp}`}>
                    <option value="">— Seleccionar —</option>
                    {trabajaronEnMes.map(e => <option key={e.id} value={e.id}>{e.nombre} {e.apellido}{e.activo ? '' : ' (salió)'}</option>)}
                  </select>
                </label>
                <label className="text-xs text-zinc-500">Día
                  <select value={diaSel} onChange={e => setDiaSel(e.target.value)} className={`mt-1 block w-20 ${inp}`}>
                    {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                  </select>
                </label>
                <label className="text-xs text-zinc-500">Horas
                  <input inputMode="decimal" value={horasSel} onChange={e => setHorasSel(e.target.value.replace(/[^\d.]/g, ''))} placeholder="2" className={`mt-1 block w-20 ${inp}`} />
                </label>
                <label className="text-xs text-zinc-500">Recargo %
                  <select value={pctSel} onChange={e => setPctSel(e.target.value)} className={`mt-1 block w-24 ${inp}`}>
                    <option value="35">35</option><option value="100">100</option>
                  </select>
                </label>
                <button onClick={agregarDia} className="inline-flex items-center gap-1.5 rounded-lg border border-[#1B2980] px-3 py-2 text-sm font-medium text-[#1B2980] dark:text-indigo-300 dark:border-indigo-400">
                  <Plus className="h-4 w-4" /> Agregar
                </button>
              </div>
              {Object.entries(datos2).map(([id, d]) => {
                const e = empleados.find(x => x.id === id)
                if (!e) return null
                const total = Object.values(d.dias).reduce((s, v) => s + v.h, 0)
                return (
                  <div key={id} className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{e.nombre} {e.apellido} <span className="text-xs font-normal text-zinc-400">· {total.toFixed(2)} h en {Object.keys(d.dias).length} día(s)</span></p>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-zinc-500">Causa de prolongación
                          <select value={d.causa} onChange={ev => guardarDatos2({ ...datos2, [id]: { ...d, causa: ev.target.value } })} className={`ml-2 ${inp}`}>
                            <option value="">—</option>{['A', 'B', 'C', 'D', 'E'].map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </label>
                        <button aria-label="Quitar empleado" onClick={() => { const n = { ...datos2 }; delete n[id]; guardarDatos2(n) }} className="text-zinc-400 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(d.dias).sort((a, b) => Number(a[0]) - Number(b[0])).map(([dia, v]) => (
                        <span key={dia} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-[#262626] px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-300">
                          Día {dia}: {v.h} h · {v.pct}%
                          <button aria-label={`Quitar día ${dia}`} onClick={() => { const dd = { ...d.dias }; delete dd[dia]; guardarDatos2({ ...datos2, [id]: { ...d, dias: dd } }) }} className="text-zinc-400 hover:text-rose-500">×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {res.filas.length === 0 ? (
            <>
              {res.erroresGlobales.length > 0 && <PanelValidacion errores={res.erroresGlobales} avisos={[]} okTexto="" />}
              <EmptyState
                icon={FileText}
                title={`Sin registros de ${info.nombre} en ${MESES_ES[mes - 1]} ${anio}`}
                message={
                  tipo === 'DGT3' ? 'No hay empleados con fecha de ingreso en este mes.'
                  : tipo === 'DGT4' ? 'No hay salidas, cambios de salario aplicados ni vacaciones registradas en este mes.'
                  : tipo === 'DGT5' ? 'No hay empleados con contrato «Móvil / Ocasional». Se asigna en Empleados → Contrato.'
                  : tipo === 'DGT11' ? 'No hay empleados con contrato «Estacional / Temporada». Se asigna en Empleados → Contrato.'
                  : tipo === 'DGT12' ? 'No hay salidas (liquidadas o marcadas) en este mes.'
                  : 'Captura arriba las horas extras por día de al menos un empleado.'
                }
              />
            </>
          ) : (
            <>
              <PanelValidacion errores={errores} avisos={avisos} okTexto="Todo listo: el archivo cumple la estructura del Ministerio. Revisa la tabla y descárgalo." />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => descargarTxt(lineasDGT(empresa.rnc, tipo, mes, anio, res.filas, extras), nombreArchivoDGT(empresa.rnc, tipo, mes, anio))}
                  disabled={errores.length > 0}
                  title={errores.length > 0 ? 'Corrige los puntos en rojo para poder descargar' : undefined}
                  className={`${BTN_PRIMARY} inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <FileDown className="h-4 w-4" /> Descargar {info.nombre} (.txt)
                </button>
                <button onClick={descargarExcel} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  <FileSpreadsheet className="h-4 w-4" /> Descargar plantilla oficial {info.nombre} (Excel)
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
                          <td className="px-4 py-2.5 text-zinc-500">{fechaVista(f.fechaIngreso)}</td>
                          <td className="px-4 py-2.5 text-zinc-500">
                            {fechaVista([f.fechaSalida, f.fechaCambio].find(Boolean) ?? '')}
                            {f.inicioVac && <span className="block text-xs text-zinc-400">Vac. {fechaVista(f.inicioVac)} – {fechaVista(f.finVac)}</span>}
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
        <p className="mt-1.5"><strong>Criterios de Cielo Cloud</strong> (confírmalos en el primer envío): el salario reportado es el salario mensual vigente (en cambios, el nuevo); las vacaciones y las salidas marcadas sin liquidar también se informan en el DGT-4; el DGT-11 toma a los empleados con contrato «Estacional» y el DGT-5 a los «Móvil / Ocasional»; en el DGT-12 el establecimiento se usa como localidad; la causa de prolongación del DGT-2 es la letra A–E del formulario del Ministerio.</p>
      </NotaInfo>
    </div>
  )
}
