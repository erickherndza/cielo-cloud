'use client'

import { useCallback, useEffect, useState } from 'react'
import { Wallet, Plus, X } from 'lucide-react'
import { apiJson } from '@/lib/storage'
import { formatDate, hoyLocalISO } from '@/lib/utils'

export interface FilaCobro {
  id: string; nombre: string; rnc: string | null
  plan: string | null; monto: number | null; ciclo: 'mensual' | 'anual' | null
  fecha_renovacion: string | null; notas: string | null
  estado_cobro: 'sin_plan' | 'sin_fecha' | 'vencido' | 'por_vencer' | 'al_dia'; ultimo_pago: string | null
}
export interface CobrosData {
  empresas: FilaCobro[]; mrr: number; cobrado30: number; porCobrar: number
  cobradoPorMes: { mes: string; total: number }[]
}
interface Pago { id: string; monto: number; fecha_pago: string; metodo: string; referencia: string; nota: string; anulado: boolean }

const inputCls = 'w-full rounded-lg border border-zinc-200 dark:border-[#252840] bg-white dark:bg-[#1a1d2e] dark:text-zinc-200 px-3 py-2 text-sm focus:border-[#1B2980] focus:outline-none'
const rd = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const ESTADO: Record<FilaCobro['estado_cobro'], { l: string; c: string }> = {
  al_dia: { l: 'Al día', c: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' },
  por_vencer: { l: 'Vence pronto', c: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' },
  vencido: { l: 'Vencido', c: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400' },
  sin_fecha: { l: 'Sin fecha', c: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' },
  sin_plan: { l: 'Sin plan', c: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' },
}

// Cobros y renovaciones: registro manual de planes y pagos por empresa.
export function CobrosPanel({ onCambio }: { onCambio?: () => void }) {
  const [data, setData] = useState<CobrosData | null>(null)
  const [sel, setSel] = useState<FilaCobro | null>(null)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [plan, setPlan] = useState({ plan: '', monto: '', ciclo: 'mensual', fecha_renovacion: '', notas: '' })
  const [pago, setPago] = useState({ monto: '', fecha_pago: hoyLocalISO(), metodo: 'transferencia', referencia: '', nota: '', renovar: true })
  const [pagos, setPagos] = useState<Pago[]>([])

  const cargar = useCallback(async () => {
    const r = await apiJson<CobrosData>('/api/admin/cobros')
    if (r.ok) { setData(r.data); onCambio?.() }
  }, [onCambio])
  useEffect(() => { void cargar() }, [cargar])

  const cargarPagos = useCallback(async (id: string) => {
    const r = await apiJson<Pago[]>(`/api/admin/empresas/${id}/pagos`)
    if (r.ok) setPagos(r.data)
  }, [])

  function elegir(f: FilaCobro) {
    setSel(f); setMsg(null)
    setPlan({ plan: f.plan ?? '', monto: f.monto != null ? String(f.monto) : '', ciclo: f.ciclo ?? 'mensual', fecha_renovacion: f.fecha_renovacion ?? '', notas: f.notas ?? '' })
    setPago(p => ({ ...p, monto: f.monto ? String(f.monto) : '', referencia: '', nota: '' }))
    void cargarPagos(f.id)
  }
  const err = (r: { data: unknown }, d: string) => setMsg({ tipo: 'error', texto: (r.data as { error?: string })?.error ?? d })

  async function guardarPlan() {
    if (!sel) return
    const r = await apiJson(`/api/admin/empresas/${sel.id}/suscripcion`, {
      method: 'PUT', body: JSON.stringify({ ...plan, monto: Number(plan.monto || 0), fecha_renovacion: plan.fecha_renovacion || null }) })
    if (!r.ok) return err(r, 'No se pudo guardar el plan')
    setMsg({ tipo: 'ok', texto: 'Plan guardado' }); await cargar()
  }
  async function registrarPago() {
    if (!sel) return
    const r = await apiJson<{ renovacion: string | null }>(`/api/admin/empresas/${sel.id}/pagos`, {
      method: 'POST', body: JSON.stringify({ ...pago, monto: Number(pago.monto) }) })
    if (!r.ok) return err(r, 'No se pudo registrar el pago')
    setMsg({ tipo: 'ok', texto: r.data.renovacion ? `Pago registrado. Nueva renovación: ${formatDate(r.data.renovacion)}` : 'Pago registrado' })
    await cargar(); await cargarPagos(sel.id)
    setPlan(p => ({ ...p, fecha_renovacion: r.data.renovacion ?? p.fecha_renovacion }))
  }
  async function anular(id: string) {
    if (!sel || !window.confirm('¿Anular este pago? No cambia la fecha de renovación.')) return
    const r = await apiJson(`/api/admin/pagos/${id}/anular`, { method: 'POST' })
    if (!r.ok) return err(r, 'No se pudo anular')
    await cargar(); await cargarPagos(sel.id)
  }

  if (!data) return <p className="py-10 text-center text-sm text-zinc-400">Cargando cobros…</p>
  const cuenta = (e: FilaCobro['estado_cobro']) => data.empresas.filter(x => x.estado_cobro === e).length
  const max = Math.max(1, ...data.cobradoPorMes.map(m => m.total))
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Ingreso mensual recurrente', rd(data.mrr), 'planes anuales prorrateados a 12 meses'],
          ['Cobrado (30 días)', rd(data.cobrado30), undefined],
          ['Por cobrar (vencido)', rd(data.porCobrar), `${cuenta('vencido')} empresa(s) vencida(s)`],
          ['Vencen en 7 días', String(cuenta('por_vencer')), `${cuenta('sin_plan') + cuenta('sin_fecha')} sin plan o sin fecha`],
        ].map(([l, v, s]) => (
          <div key={l} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-[#252840] dark:bg-[#141722]">
            <p className="text-xs font-medium text-zinc-500">{l}</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{v}</p>
            {s && <p className="mt-1 text-[11px] text-zinc-400">{s}</p>}
          </div>))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-[#252840] dark:bg-[#141722]">
            <table className="w-full text-sm">
              <thead><tr className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-[#1a1d2e]">
                <th className="px-4 py-2 font-medium">Empresa</th><th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium text-right">Monto</th><th className="px-4 py-2 font-medium">Renovación</th>
                <th className="px-4 py-2 font-medium">Estado</th></tr></thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-[#252840]">
                {data.empresas.map(f => (
                  <tr key={f.id} onClick={() => elegir(f)}
                    className={`cursor-pointer hover:bg-zinc-50 dark:hover:bg-[#1a1d2e] ${sel?.id === f.id ? 'bg-[#eef0fb] dark:bg-[#1a1d2e]' : ''}`}>
                    <td className="px-4 py-2.5 font-medium text-[#1B2980] dark:text-indigo-300">{f.nombre || '(sin nombre)'}
                      <span className="block text-[11px] font-normal text-zinc-400">{f.ultimo_pago ? `Último pago ${formatDate(f.ultimo_pago)}` : 'Sin pagos registrados'}</span></td>
                    <td className="px-4 py-2.5 text-zinc-500">{f.plan || '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">{f.monto != null ? `${rd(f.monto)} ${f.ciclo === 'anual' ? '/año' : '/mes'}` : '—'}</td>
                    <td className="px-4 py-2.5 tabular-nums text-zinc-500">{f.fecha_renovacion ? formatDate(f.fecha_renovacion) : '—'}</td>
                    <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ESTADO[f.estado_cobro].c}`}>{ESTADO[f.estado_cobro].l}</span></td>
                  </tr>))}
                {!data.empresas.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-zinc-400"><Wallet className="mx-auto mb-2 h-6 w-6" />Sin empresas activas</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-[#252840] dark:bg-[#141722]">
            <p className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Cobrado por mes</p>
            {!data.cobradoPorMes.length ? <p className="py-4 text-center text-sm text-zinc-400">Aún no hay pagos registrados</p> : (
              <div className="space-y-1.5">
                {data.cobradoPorMes.map(m => (
                  <div key={m.mes} className="flex items-center gap-2 text-xs">
                    <span className="w-14 tabular-nums text-zinc-500">{m.mes}</span>
                    <div className="h-3 flex-1 rounded bg-zinc-100 dark:bg-[#1a1d2e]"><div className="h-3 rounded bg-emerald-600" style={{ width: `${(m.total / max) * 100}%` }} /></div>
                    <span className="w-28 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{rd(m.total)}</span>
                  </div>))}
              </div>)}
          </div>
        </div>

        <aside className="h-fit space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-[#252840] dark:bg-[#141722]">
          {!sel ? <p className="py-8 text-center text-sm text-zinc-400">Elige una empresa para ver su plan y registrar pagos</p> : (<>
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">{sel.nombre || '(sin nombre)'}</p>
            {msg && (
              <div className={`flex items-center justify-between rounded-lg border px-3 py-1.5 text-xs ${msg.tipo === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300'
                : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-950/20 dark:text-rose-300'}`}>
                {msg.texto}<button onClick={() => setMsg(null)}><X className="h-3.5 w-3.5" /></button></div>)}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Plan y renovación</p>
              <input className={inputCls} placeholder="Plan (ej. B · 11–50 empleados)" value={plan.plan} onChange={e => setPlan({ ...plan, plan: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <input className={inputCls} type="number" min="0" step="0.01" placeholder="Monto RD$" value={plan.monto} onChange={e => setPlan({ ...plan, monto: e.target.value })} />
                <select className={inputCls} value={plan.ciclo} onChange={e => setPlan({ ...plan, ciclo: e.target.value })}>
                  <option value="mensual">Mensual</option><option value="anual">Anual</option></select>
              </div>
              <label className="block text-[11px] text-zinc-500">Próxima renovación
                <input className={inputCls} type="date" value={plan.fecha_renovacion} onChange={e => setPlan({ ...plan, fecha_renovacion: e.target.value })} /></label>
              <input className={inputCls} placeholder="Notas (opcional)" value={plan.notas} onChange={e => setPlan({ ...plan, notas: e.target.value })} />
              <button onClick={guardarPlan} className="w-full rounded-lg bg-[#1B2980] px-3 py-2 text-xs font-semibold text-white">Guardar plan</button>
            </div>
            <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-[#252840]">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200"><Plus className="h-3.5 w-3.5" /> Registrar pago</p>
              <div className="grid grid-cols-2 gap-2">
                <input className={inputCls} type="number" min="0" step="0.01" placeholder="Monto RD$" value={pago.monto} onChange={e => setPago({ ...pago, monto: e.target.value })} />
                <input className={inputCls} type="date" value={pago.fecha_pago} onChange={e => setPago({ ...pago, fecha_pago: e.target.value })} />
              </div>
              <select className={inputCls} value={pago.metodo} onChange={e => setPago({ ...pago, metodo: e.target.value })}>
                {['transferencia', 'efectivo', 'tarjeta', 'cheque', 'otro'].map(m => <option key={m} value={m}>{m}</option>)}</select>
              <input className={inputCls} placeholder="Referencia (opcional)" value={pago.referencia} onChange={e => setPago({ ...pago, referencia: e.target.value })} />
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                <input type="checkbox" checked={pago.renovar} onChange={e => setPago({ ...pago, renovar: e.target.checked })} /> Correr la renovación un {plan.ciclo === 'anual' ? 'año' : 'mes'}</label>
              <button onClick={registrarPago} disabled={!(Number(pago.monto) > 0)} className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Registrar pago</button>
            </div>
            <div className="space-y-1 border-t border-zinc-200 pt-3 text-xs dark:border-[#252840]">
              <p className="font-semibold text-zinc-700 dark:text-zinc-200">Pagos de esta empresa</p>
              {pagos.map(p => (
                <p key={p.id} className={`flex items-center justify-between gap-2 ${p.anulado ? 'text-zinc-400 line-through' : 'text-zinc-500'}`}>
                  <span>{formatDate(p.fecha_pago)} · {rd(p.monto)} · {p.metodo}{p.referencia ? ` · ${p.referencia}` : ''}</span>
                  {!p.anulado && <button onClick={() => anular(p.id)} className="shrink-0 text-rose-600 underline dark:text-rose-400">anular</button>}</p>))}
              {!pagos.length && <p className="text-zinc-400">Sin pagos todavía</p>}
            </div>
          </>)}
        </aside>
      </div>
    </div>
  )
}
