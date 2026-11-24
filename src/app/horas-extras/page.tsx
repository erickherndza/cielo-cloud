'use client'

import { useMemo, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { StatCard } from '@/components/ui/StatCard'
import { Toast } from '@/components/ui/Toast'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEmpleados } from '@/lib/empleados-context'
import { useHorasExtras, inicioSemana, TOPE_SEMANAL_HE } from '@/lib/horas-extras-context'
import { useFeriados } from '@/lib/feriados-context'
import { fullName, formatDate, BTN_PRIMARY, hoyLocalISO, parseFechaLocal, cn } from '@/lib/utils'
import type { TipoHoraExtra } from '@/types'
import { Timer, Plus, Trash2, AlertTriangle, Info, Search } from 'lucide-react'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const input = 'w-full rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] dark:text-zinc-200 px-3 py-2 text-sm focus:border-[#1B2980] focus:outline-none'

export default function HorasExtrasPage() {
  const { empleadosEnNomina } = useEmpleados()
  const { empleados } = useEmpleados()
  const { registros, registrar, eliminar, horasSemana } = useHorasExtras()
  const { getFeriados } = useFeriados()

  const hoy = new Date()
  const [mes, setMes] = useState(hoy.getMonth() + 1)
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [busqueda, setBusqueda] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const [empId, setEmpId] = useState('')
  const [fecha, setFecha] = useState(hoyLocalISO())
  const [horas, setHoras] = useState('')
  const [tipo, setTipo] = useState<TipoHoraExtra>('he35')
  const [motivo, setMotivo] = useState('')
  const [tipoManual, setTipoManual] = useState(false)

  const esFeriado = useMemo(() => {
    const f = parseFechaLocal(fecha)
    return getFeriados(f.getFullYear()).some(x => x.fecha === fecha)
  }, [fecha, getFeriados])
  const esDomingo = parseFechaLocal(fecha).getDay() === 0
  const tipoSugerido: TipoHoraExtra = esFeriado || esDomingo ? 'he100' : 'he35'
  const tipoEfectivo = tipoManual ? tipo : tipoSugerido

  const nombreDe = (id: string) => { const e = empleados.find(x => x.id === id); return e ? fullName(e) : 'Empleado eliminado' }

  const horasNum = parseFloat(horas.replace(',', '.'))
  const horasValidas = Number.isFinite(horasNum) && horasNum > 0 && horasNum <= 24
  const acumSemana = empId && fecha ? horasSemana(empId, fecha) : 0
  const excedeSemana = horasValidas && acumSemana + horasNum > TOPE_SEMANAL_HE

  function guardar() {
    if (!empId || !horasValidas || !fecha) return
    registrar({ empleadoId: empId, fecha, horas: horasNum, tipo: tipoEfectivo, motivo })
    setHoras(''); setMotivo(''); setTipoManual(false)
    setToast(`Se registraron ${horasNum} h a ${nombreDe(empId)} el ${formatDate(fecha)}`)
  }

  const delMes = useMemo(() => registros
    .filter(r => { const f = parseFechaLocal(r.fecha); return f.getMonth() + 1 === mes && f.getFullYear() === anio })
    .filter(r => !busqueda.trim() || nombreDe(r.empleadoId).toLowerCase().includes(busqueda.toLowerCase()))
    .sort((a, b) => b.fecha.localeCompare(a.fecha)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [registros, mes, anio, busqueda, empleados])

  const totales = useMemo(() => {
    const t = { he35: 0, he100: 0 }
    for (const r of delMes) { if (r.tipo === 'he100') t.he100 += r.horas; else t.he35 += r.horas }
    return t
  }, [delMes])

  // Semanas (lunes–domingo) del mes en que un empleado supera el tope legal de 24 h.
  const semanasExcedidas = useMemo(() => {
    const m = new Map<string, { nombre: string; semana: string; horas: number }>()
    for (const r of delMes) {
      const ini = inicioSemana(parseFechaLocal(r.fecha))
      const k = `${r.empleadoId}|${ini.getTime()}`
      if (m.has(k)) continue
      const h = horasSemana(r.empleadoId, r.fecha)
      if (h > TOPE_SEMANAL_HE) m.set(k, { nombre: nombreDe(r.empleadoId), semana: `${ini.getDate()} ${MESES[ini.getMonth()].slice(0, 3).toLowerCase()}`, horas: h })
    }
    return [...m.values()]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delMes, registros])

  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - 4 + i)

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header title="Horas Extras" subtitle="Registro diario — se suma a la nómina del período y controla el tope legal (Art. 155)" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="H.E. 35% del mes" value={`${totales.he35.toFixed(2)} h`} icon={Timer} />
          <StatCard label="H.E. 100% del mes" value={`${totales.he100.toFixed(2)} h`} icon={Timer} />
          <StatCard label="Registros del mes" value={String(delMes.length)} icon={Info} />
        </div>

        <div className="rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-5">
          <p className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">Registrar horas extras</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs text-zinc-500">Empleado</label>
              <select value={empId} onChange={e => setEmpId(e.target.value)} className={input}>
                <option value="">Selecciona…</option>
                {empleadosEnNomina.map(e => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Fecha</label>
              <input type="date" value={fecha} max={hoyLocalISO()} onChange={e => { setFecha(e.target.value); setTipoManual(false) }} className={input} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Horas</label>
              <input inputMode="decimal" value={horas} onChange={e => setHoras(e.target.value)} placeholder="Ej. 2.5" className={input} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Recargo</label>
              <select value={tipoEfectivo} onChange={e => { setTipo(e.target.value as TipoHoraExtra); setTipoManual(true) }} className={input}>
                <option value="he35">35% (día laborable)</option>
                <option value="he100">100% (feriado/descanso)</option>
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={guardar} disabled={!empId || !horasValidas || !fecha}
                className={cn(BTN_PRIMARY, 'w-full justify-center disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none')}>
                <Plus className="h-4 w-4" /> Registrar
              </button>
            </div>
          </div>
          <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo (opcional): cierre de mes, inventario…" className={cn(input, 'mt-3')} />
          {(esFeriado || esDomingo) && !tipoManual && (
            <p className="mt-2 text-xs text-sky-700 dark:text-sky-400">
              {esFeriado ? 'Esa fecha es feriado' : 'Esa fecha es domingo'}: se sugiere recargo de 100% (Art. 203). Puedes cambiarlo.
            </p>
          )}
          {excedeSemana && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Con estas horas el empleado llegaría a {(acumSemana + horasNum).toFixed(2)} h extra esa semana; el tope legal es {TOPE_SEMANAL_HE} h (Art. 155). Puedes registrarlas igual, queda la alerta.
            </p>
          )}
        </div>

        {semanasExcedidas.length > 0 && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 px-5 py-3.5 text-sm text-amber-900 dark:text-amber-200">
            <strong>Tope semanal superado:</strong>{' '}
            {semanasExcedidas.map(s => `${s.nombre} — semana del ${s.semana}: ${s.horas.toFixed(2)} h`).join(' · ')}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f]">
          <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 dark:border-[#2a2a2a] px-5 py-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar empleado…" className={cn(input, 'pl-8 py-1.5 text-xs')} />
            </div>
            <select value={mes} onChange={e => setMes(Number(e.target.value))} className={cn(input, 'w-auto py-1.5 text-xs')}>
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select value={anio} onChange={e => setAnio(Number(e.target.value))} className={cn(input, 'w-auto py-1.5 text-xs')}>
              {anios.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {delMes.length === 0 ? (
            <div className="p-8"><EmptyState icon={Timer} message="No hay horas extras registradas en este mes." /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-[#2a2a2a] bg-zinc-50 dark:bg-[#262626] text-left text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-500">
                  <th className="px-5 py-3">Fecha</th><th className="px-4 py-3">Empleado</th>
                  <th className="px-4 py-3 text-right">Horas</th><th className="px-4 py-3">Recargo</th>
                  <th className="px-4 py-3">Motivo</th><th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                {delMes.map(r => (
                  <tr key={r.id} className="hover:bg-zinc-50 dark:hover:bg-[#262626]">
                    <td className="px-5 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">{formatDate(r.fecha)}</td>
                    <td className="px-4 py-3 font-medium text-[#1B2980] dark:text-indigo-400">{nombreDe(r.empleadoId)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-800 dark:text-zinc-200">{r.horas.toFixed(2)}</td>
                    <td className="px-4 py-3"><Badge variant={r.tipo === 'he100' ? 'warning' : 'default'}>{r.tipo === 'he100' ? '100%' : '35%'}</Badge></td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{r.motivo ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => eliminar(r.id)} title="Eliminar registro" className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Para pagarlas: abre el período en <strong>Cálculo de Nómina</strong> y pulsa <strong>«Cargar horas registradas»</strong>. Las horas del período se suman a cada empleado como H.E. 35% / 100%.
        </p>
      </div>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  )
}
