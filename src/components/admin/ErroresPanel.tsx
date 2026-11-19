'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bug, CheckCircle2 } from 'lucide-react'
import { apiJson } from '@/lib/storage'

interface ErrorAgrupado {
  huella: string; origen: 'web' | 'api'; mensaje: string; ruta: string; veces: number
  empresas: number; usuarios: number; primera: string; ultima: string; detalle: string; resuelto: boolean
}
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' })

// Registro de errores de la plataforma, agrupados por mensaje y pantalla.
export function ErroresPanel() {
  const [lista, setLista] = useState<ErrorAgrupado[] | null>(null)
  const [resueltos, setResueltos] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const r = await apiJson<ErrorAgrupado[]>(`/api/admin/errores${resueltos ? '?resueltos=1' : ''}`)
    if (r.ok) setLista(r.data)
  }, [resueltos])
  useEffect(() => { setLista(null); void cargar() }, [cargar])

  async function marcar(e: ErrorAgrupado) {
    await apiJson(`/api/admin/errores/${e.huella}/resolver`, { method: 'POST', body: JSON.stringify({ resuelto: !e.resuelto }) })
    void cargar()
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-[#2e2e2e] dark:bg-[#1f1f1f]">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-[#2e2e2e]">
        <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><Bug className="h-4 w-4 text-[#1B2980] dark:text-indigo-400" /> Registro de errores</p>
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-[#262626]">
          {[false, true].map(v => (
            <button key={String(v)} onClick={() => setResueltos(v)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${resueltos === v ? 'bg-white text-[#1B2980] shadow-sm dark:bg-[#2e2e2e] dark:text-indigo-300' : 'text-zinc-500'}`}>{v ? 'Resueltos' : 'Pendientes'}</button>))}
        </div>
      </div>
      {!lista ? <p className="py-10 text-center text-sm text-zinc-400">Cargando…</p> : !lista.length ? (
        <p className="py-10 text-center text-sm text-zinc-400"><CheckCircle2 className="mx-auto mb-2 h-6 w-6" />{resueltos ? 'Sin errores resueltos' : 'Sin errores pendientes'}</p>
      ) : (
        <ul className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
          {lista.map(e => (
            <li key={e.huella} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <button onClick={() => setAbierto(abierto === e.huella ? null : e.huella)} className="min-w-0 text-left">
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${e.origen === 'api' ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400' : 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400'}`}>{e.origen}</span>{e.mensaje}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">{e.ruta || '—'} · {e.veces} vez/veces · {e.usuarios} usuario(s) · {e.empresas} empresa(s) · última {fechaHora(e.ultima)}</p>
                </button>
                <button onClick={() => marcar(e)} className="shrink-0 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:border-[#2e2e2e] dark:text-zinc-300">
                  {e.resuelto ? 'Reabrir' : 'Marcar resuelto'}</button>
              </div>
              {abierto === e.huella && (
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-zinc-50 p-3 text-[11px] text-zinc-600 dark:bg-[#262626] dark:text-zinc-300">{e.detalle || 'Sin detalle técnico'}</pre>)}
            </li>))}
        </ul>)}
      <p className="border-t border-zinc-200 px-4 py-2 text-[10px] text-zinc-400 dark:border-[#2e2e2e]">Solo mensaje, pantalla y detalle técnico: nunca datos de empleados. Se conservan 90 días.</p>
    </div>
  )
}
