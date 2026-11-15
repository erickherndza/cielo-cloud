'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Scale, Save, RotateCcw, History, Calculator } from 'lucide-react'
import { apiJson } from '@/lib/storage'
import {
  PARAMETROS_POR_DEFECTO, RANGOS_PARAMETROS, getParametros, setParametros, mezclarConDefecto,
  type ParametrosLegales, type MotivoParam,
} from '@/lib/parametros-legales'
import {
  calcularCesantiaDetalle, calcularPreavisoDetalle, calcularAsistenciaEconomicaDetalle,
  calcularDiasVacacionesAcumulados, motivoGenera, MOTIVO_LIQUIDACION_LABELS,
} from '@/lib/dominican-labor'
import { formatRD } from '@/lib/utils'

interface Version { version: number; datos: unknown; motivo: string; email: string | null; creado_en: string }
type Grupo = keyof typeof RANGOS_PARAMETROS

const inputCls = 'w-24 rounded-lg border border-zinc-200 dark:border-[#252840] bg-white dark:bg-[#1a1d2e] dark:text-zinc-200 px-2 py-1.5 text-right text-sm tabular-nums focus:border-[#1B2980] focus:outline-none'
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' })

// Etiquetas de cada campo, con el artículo del Código de Trabajo que lo respalda.
const SECCIONES: { grupo: Grupo; titulo: string; nota: string; campos: Record<string, string> }[] = [
  { grupo: 'vacaciones', titulo: 'Vacaciones (Art. 177)', nota: 'Días laborables por año. Pasa a la tasa mayor cuando la antigüedad supera el umbral.',
    campos: { diasHasta5: 'Días por año hasta el umbral', diasMas5: 'Días por año después del umbral', umbralAnios: 'Umbral (más de N años)' } },
  { grupo: 'divisor', titulo: 'Salario diario', nota: 'Salario mensual ÷ divisor. Lo usan cesantía, preaviso, asistencia y vacaciones.',
    campos: { ordinario: 'Divisor régimen ordinario', intermitente: 'Divisor régimen intermitente (Res. 04-93)' } },
  { grupo: 'cesantia', titulo: 'Cesantía (Art. 80)', nota: 'Días de salario según la antigüedad.',
    campos: { d3a6m: '3 a 6 meses', d6a12m: '6 a 12 meses', diasAnio1a5: 'Por año, de 1 a menos de 5 años', diasAnio5mas: 'Por año, 5 años o más' } },
  { grupo: 'preaviso', titulo: 'Preaviso / desahucio (Art. 76)', nota: 'Días de preaviso. También es la anticipación que debe dar quien renuncia.',
    campos: { d3a6m: '3 a 6 meses', d6a12m: '6 a 12 meses', d12mas: '12 meses o más' } },
  { grupo: 'asistencia', titulo: 'Asistencia económica (Art. 82)', nota: 'Terminación de contratos por tiempo determinado u obra.',
    campos: { d3a6m: '3 a 6 meses', d6a12m: '6 a 12 meses', diasPorAnio: 'Por año cumplido (+ proporcional)' } },
]
const PRESTACIONES = [['cesantia', 'Cesantía'], ['preaviso', 'Preaviso'], ['asistencia', 'Asist. económica']] as const

function clonar(p: ParametrosLegales): ParametrosLegales { return JSON.parse(JSON.stringify(p)) }

// Calcula con los parámetros del borrador sin dejarlos activos: se restauran
// siempre los vigentes, aunque el cálculo falle.
function conParametros<T>(borrador: ParametrosLegales, fn: () => T): T {
  const previos = getParametros()
  setParametros(borrador)
  try { return fn() } finally { setParametros(previos) }
}

export function ParametrosLegalesPanel() {
  const [vigente, setVigente] = useState<ParametrosLegales>(PARAMETROS_POR_DEFECTO)
  const [versionVigente, setVersionVigente] = useState(0)
  const [borrador, setBorrador] = useState<ParametrosLegales>(clonar(PARAMETROS_POR_DEFECTO))
  const [motivo, setMotivo] = useState('')
  const [historial, setHistorial] = useState<Version[]>([])
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [sim, setSim] = useState({ salario: '40000', anos: '3', motivo: 'despido_sin_causa' as MotivoParam, intermitente: false })

  const cargar = useCallback(async () => {
    const r = await apiJson<Version>('/api/parametros-legales')
    if (r.ok) {
      const p = mezclarConDefecto(r.data.datos)
      setVigente(p); setBorrador(clonar(p)); setVersionVigente(r.data.version ?? 0)
      setParametros(r.data.datos, r.data.version ?? 0)
    }
    const h = await apiJson<Version[]>('/api/admin/parametros-legales/historial')
    if (h.ok) setHistorial(h.data)
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const cambios = useMemo(() => {
    const out: string[] = []
    for (const s of SECCIONES) for (const [k, etq] of Object.entries(s.campos)) {
      const a = (vigente[s.grupo] as Record<string, number>)[k], b = (borrador[s.grupo] as Record<string, number>)[k]
      if (a !== b) out.push(`${s.titulo} · ${etq}: ${a} → ${b}`)
    }
    for (const m of Object.keys(vigente.motivos) as MotivoParam[]) for (const [p, etq] of PRESTACIONES) {
      if (vigente.motivos[m][p] !== borrador.motivos[m][p]) {
        out.push(`${MOTIVO_LIQUIDACION_LABELS[m]} · ${etq}: ${vigente.motivos[m][p] ? 'sí' : 'no'} → ${borrador.motivos[m][p] ? 'sí' : 'no'}`)
      }
    }
    return out
  }, [vigente, borrador])

  const fueraDeRango = useMemo(() => SECCIONES.some(s => Object.entries(RANGOS_PARAMETROS[s.grupo]).some(([k, [min, max]]) => {
    const v = (borrador[s.grupo] as Record<string, number>)[k]
    return !Number.isFinite(v) || v < min || v > max
  })), [borrador])

  function setNum(grupo: Grupo, campo: string, valor: string) {
    setBorrador(b => ({ ...b, [grupo]: { ...b[grupo], [campo]: valor === '' ? NaN : Number(valor) } }))
  }
  function setMotivoPrest(m: MotivoParam, p: 'cesantia' | 'preaviso' | 'asistencia', v: boolean) {
    setBorrador(b => ({ ...b, motivos: { ...b.motivos, [m]: { ...b.motivos[m], [p]: v } } }))
  }

  async function guardar() {
    if (!cambios.length || fueraDeRango || motivo.trim().length < 5) return
    if (!window.confirm(`Se guardará una nueva versión con ${cambios.length} cambio(s). Las liquidaciones nuevas y los cálculos que se vuelvan a abrir usarán estos valores; lo ya finalizado no se modifica. ¿Continuar?`)) return
    setGuardando(true)
    const r = await apiJson<Version>('/api/admin/parametros-legales', { method: 'PUT', body: JSON.stringify({ datos: borrador, motivo: motivo.trim() }) })
    setGuardando(false)
    if (!r.ok) { setMsg({ tipo: 'error', texto: (r.data as { error?: string })?.error ?? 'No se pudo guardar' }); return }
    setMotivo(''); setMsg({ tipo: 'ok', texto: `Guardado como versión ${r.data.version}` }); void cargar()
  }

  // Simulador: calcula con el BORRADOR para ver el efecto antes de guardarlo.
  const simulacion = useMemo(() => {
    const salario = Number(sim.salario), anos = Number(sim.anos)
    if (!(salario > 0) || !(anos >= 0) || fueraDeRango) return null
    return conParametros(borrador, () => {
      const divisor = sim.intermitente ? borrador.divisor.intermitente : borrador.divisor.ordinario
      const lineas = [
        { nombre: 'Cesantía', genera: motivoGenera(sim.motivo, 'cesantia'), d: calcularCesantiaDetalle(salario, anos, divisor) },
        { nombre: 'Preaviso', genera: motivoGenera(sim.motivo, 'preaviso'), d: calcularPreavisoDetalle(salario, anos, divisor) },
        { nombre: 'Asistencia económica', genera: motivoGenera(sim.motivo, 'asistencia'), d: calcularAsistenciaEconomicaDetalle(salario, anos, divisor) },
      ].map(l => ({ ...l, monto: l.genera ? l.d.total : 0 }))
      const diasVac = calcularDiasVacacionesAcumulados(anos)
      return { lineas, diasVac, valorVac: diasVac * (salario / divisor) }
    })
  }, [borrador, sim, fueraDeRango])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300">
        Estos valores afectan a <strong>todas las empresas</strong>. Cámbialos solo con respaldo del abogado o del contador. Cada guardado crea una versión con su motivo y autor;
        las liquidaciones ya finalizadas conservan el cálculo con el que se hicieron. Las comisiones y los aumentos no tienen un parámetro legal fijo: se validan caso por caso.
      </div>

      {msg && (
        <div className={`flex items-center justify-between rounded-lg border px-4 py-2 text-sm ${msg.tipo === 'ok'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300'
          : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-950/20 dark:text-rose-300'}`}>
          {msg.texto}<button onClick={() => setMsg(null)} aria-label="Cerrar">×</button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <Scale className="h-4 w-4 text-[#1B2980] dark:text-indigo-400" />
            Versión vigente: <strong className="text-zinc-800 dark:text-zinc-200">{versionVigente === 0 ? 'valores de fábrica' : versionVigente}</strong>
          </p>

          {SECCIONES.map(s => (
            <section key={s.grupo} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-[#252840] dark:bg-[#141722]">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.titulo}</p>
              <p className="mb-3 text-xs text-zinc-500">{s.nota}</p>
              <div className="space-y-2">
                {Object.entries(s.campos).map(([k, etq]) => {
                  const [min, max] = (RANGOS_PARAMETROS[s.grupo] as Record<string, readonly [number, number]>)[k]
                  const v = (borrador[s.grupo] as Record<string, number>)[k]
                  const cambio = v !== (vigente[s.grupo] as Record<string, number>)[k]
                  return (
                    <label key={k} className="flex items-center justify-between gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                      <span>{etq}</span>
                      <input type="number" min={min} max={max} step="any" value={Number.isFinite(v) ? v : ''}
                        onChange={e => setNum(s.grupo, k, e.target.value)}
                        className={`${inputCls} ${cambio ? 'border-amber-400 dark:border-amber-500' : ''}`} />
                    </label>
                  )
                })}
              </div>
            </section>
          ))}

          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-[#252840] dark:bg-[#141722]">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Qué genera cada tipo de terminación</p>
            <p className="mb-3 text-xs text-zinc-500">Renuncia, despido, mutuo acuerdo o vencimiento de contrato: marca qué prestaciones se calculan automáticamente. En Liquidación siempre se puede ajustar el monto con motivo.</p>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-zinc-500"><th className="py-1 font-medium">Motivo</th>
                {PRESTACIONES.map(([, etq]) => <th key={etq} className="py-1 text-center font-medium">{etq}</th>)}</tr></thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-[#252840]">
                {(Object.keys(borrador.motivos) as MotivoParam[]).map(m => (
                  <tr key={m}>
                    <td className="py-2 text-zinc-700 dark:text-zinc-300">{MOTIVO_LIQUIDACION_LABELS[m]}</td>
                    {PRESTACIONES.map(([p, etq]) => (
                      <td key={p} className="py-2 text-center">
                        <input type="checkbox" aria-label={`${MOTIVO_LIQUIDACION_LABELS[m]}: ${etq}`} checked={borrador.motivos[m][p]}
                          onChange={e => setMotivoPrest(m, p, e.target.checked)} className="h-4 w-4 accent-[#1B2980]" />
                      </td>))}
                  </tr>))}
              </tbody>
            </table>
          </section>

          <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-[#252840] dark:bg-[#141722]">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Guardar cambios</p>
            {cambios.length ? (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-zinc-600 dark:text-zinc-400">{cambios.map(c => <li key={c}>{c}</li>)}</ul>
            ) : <p className="text-xs text-zinc-400">Sin cambios respecto a la versión vigente.</p>}
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={300} rows={2}
              placeholder="Motivo del cambio (obligatorio): quién lo validó y por qué"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-[#1B2980] focus:outline-none dark:border-[#252840] dark:bg-[#1a1d2e] dark:text-zinc-200" />
            <div className="flex flex-wrap gap-2">
              <button onClick={guardar} disabled={guardando || !cambios.length || fueraDeRango || motivo.trim().length < 5}
                className="flex items-center gap-1.5 rounded-lg bg-[#1B2980] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                <Save className="h-4 w-4" /> Guardar nueva versión</button>
              <button onClick={() => setBorrador(clonar(vigente))} disabled={!cambios.length}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 disabled:opacity-40 dark:border-[#252840] dark:text-zinc-300">Descartar</button>
              <button onClick={() => setBorrador(clonar(PARAMETROS_POR_DEFECTO))}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 dark:border-[#252840] dark:text-zinc-300">
                <RotateCcw className="h-4 w-4" /> Cargar valores de fábrica</button>
            </div>
            {fueraDeRango && <p className="text-xs text-rose-600 dark:text-rose-400">Hay valores vacíos o fuera del rango permitido.</p>}
          </section>
        </div>

        <aside className="h-fit space-y-5">
          <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-[#252840] dark:bg-[#141722]">
            <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><Calculator className="h-4 w-4" /> Simulador (con el borrador)</p>
            <p className="text-xs text-zinc-500">Prueba el efecto antes de guardar. Usa cifras ficticias, nunca el salario de una persona real.</p>
            <label className="block text-xs text-zinc-600 dark:text-zinc-400">Salario mensual (RD$)
              <input type="number" min="0" value={sim.salario} onChange={e => setSim({ ...sim, salario: e.target.value })} className={`${inputCls} mt-1 w-full`} /></label>
            <label className="block text-xs text-zinc-600 dark:text-zinc-400">Años de servicio
              <input type="number" min="0" step="0.1" value={sim.anos} onChange={e => setSim({ ...sim, anos: e.target.value })} className={`${inputCls} mt-1 w-full`} /></label>
            <label className="block text-xs text-zinc-600 dark:text-zinc-400">Motivo
              <select value={sim.motivo} onChange={e => setSim({ ...sim, motivo: e.target.value as MotivoParam })}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-[#252840] dark:bg-[#1a1d2e] dark:text-zinc-200">
                {Object.entries(MOTIVO_LIQUIDACION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" checked={sim.intermitente} onChange={e => setSim({ ...sim, intermitente: e.target.checked })} className="accent-[#1B2980]" /> Régimen intermitente</label>
            {simulacion ? (
              <div className="space-y-1 border-t border-zinc-200 pt-3 text-xs dark:border-[#252840]">
                {simulacion.lineas.map(l => (
                  <p key={l.nombre} className="flex justify-between gap-2 text-zinc-600 dark:text-zinc-400">
                    <span>{l.nombre} {l.genera ? <span className="text-zinc-400">({l.d.dias} d)</span> : <span className="text-zinc-400">(no aplica)</span>}</span>
                    <span className="tabular-nums text-zinc-800 dark:text-zinc-200">{formatRD(l.monto)}</span></p>))}
                <p className="flex justify-between gap-2 text-zinc-600 dark:text-zinc-400">
                  <span>Vacaciones acumuladas <span className="text-zinc-400">({simulacion.diasVac.toFixed(2)} d)</span></span>
                  <span className="tabular-nums text-zinc-800 dark:text-zinc-200">{formatRD(simulacion.valorVac)}</span></p>
              </div>
            ) : <p className="text-xs text-zinc-400">Completa salario y años con valores válidos.</p>}
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-[#252840] dark:bg-[#141722]">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><History className="h-4 w-4" /> Versiones</p>
            <div className="space-y-3 text-xs">
              {historial.map(h => (
                <div key={h.version} className="border-b border-zinc-100 pb-2 last:border-0 dark:border-[#252840]">
                  <p className="flex justify-between text-zinc-700 dark:text-zinc-300">
                    <span className="font-semibold">Versión {h.version}{h.version === versionVigente && ' · vigente'}</span>
                    <button onClick={() => setBorrador(mezclarConDefecto(h.datos))} className="text-[#1B2980] underline dark:text-indigo-300">cargar</button></p>
                  <p className="text-zinc-500">{fechaHora(h.creado_en)} · {h.email}</p>
                  <p className="text-zinc-600 dark:text-zinc-400">{h.motivo}</p>
                </div>))}
              {!historial.length && <p className="text-zinc-400">Aún no hay versiones: se usan los valores de fábrica.</p>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
