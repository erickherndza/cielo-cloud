'use client'

import { useCallback, useEffect, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { Toast } from '@/components/ui/Toast'
import { Badge } from '@/components/ui/Badge'
import { useConfirm } from '@/lib/confirm-context'
import { apiJson, getAcceso, REMOTE_ENABLED } from '@/lib/storage'
import { formatDate, BTN_PRIMARY } from '@/lib/utils'
import { UserPlus, Mail, Send, X, Trash2, Info } from 'lucide-react'

const ROLES = [
  { v: 'admin', l: 'Gerente de nómina / Administrador', d: 'Acceso completo, incluida la configuración y el equipo.' },
  { v: 'analista', l: 'Analista de nómina y RR. HH.', d: 'Procesa nómina, empleados y liquidaciones. No cambia la configuración de la empresa.' },
  { v: 'auxiliar', l: 'Auxiliar de nómina / RR. HH.', d: 'Solo captura: horas extras, licencias, vacaciones y préstamos. No ve salarios.' },
]
const etiqueta = (r: string) => ROLES.find(x => x.v === r)?.l ?? r
const input = 'w-full rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] dark:text-zinc-200 px-3 py-2 text-sm focus:border-[#1B2980] focus:outline-none'

interface Miembro { uid: string; email: string | null; rol: string; creado_en: string }
interface Invitacion { id: string; email: string; rol: string; creado_en: string; expira_en: string }
interface Equipo { yo: string; correoActivo: boolean; miembros: Miembro[]; invitaciones: Invitacion[] }

export default function EquipoPage() {
  const confirmar = useConfirm()
  const empresaId = getAcceso()?.activa?.id ?? null
  const [eq, setEq] = useState<Equipo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [rol, setRol] = useState('auxiliar')
  const [enviando, setEnviando] = useState(false)
  const [toast, setToast] = useState<{ texto: string; tipo: 'success' | 'error' | 'info' } | null>(null)

  const cargar = useCallback(async () => {
    if (!empresaId) return
    const r = await apiJson<Equipo & { error?: string }>(`/api/empresas/${empresaId}/equipo`)
    if (r.ok) { setEq(r.data); setError(null) } else setError(r.data.error ?? 'No se pudo cargar el equipo')
  }, [empresaId])
  useEffect(() => { void cargar() }, [cargar])

  const base = `/api/empresas/${empresaId}/equipo`
  const aviso = (texto: string, tipo: 'success' | 'error' | 'info' = 'success') => setToast({ texto, tipo })

  async function invitar(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || enviando) return
    setEnviando(true)
    const r = await apiJson<{ enviado?: boolean; error?: string }>(`${base}/invitaciones`, { method: 'POST', body: JSON.stringify({ email: email.trim(), rol }) })
    setEnviando(false)
    if (!r.ok) return aviso(r.data.error ?? 'No se pudo invitar', 'error')
    setEmail('')
    aviso(r.data.enviado ? `Invitación enviada a ${email.trim()}` : 'Invitación creada, pero el correo no pudo enviarse. Avísale tú a la persona.', r.data.enviado ? 'success' : 'info')
    void cargar()
  }

  async function accion(ruta: string, init: RequestInit, ok: string) {
    const r = await apiJson<{ error?: string; enviado?: boolean }>(`${base}${ruta}`, init)
    if (!r.ok) return aviso(r.data.error ?? 'No se pudo completar', 'error')
    aviso(r.data.enviado === false ? 'No se pudo enviar el correo' : ok, r.data.enviado === false ? 'error' : 'success')
    void cargar()
  }

  async function quitar(m: Miembro) {
    if (!await confirmar({ titulo: 'Quitar acceso', mensaje: `${m.email ?? 'Esta persona'} dejará de entrar a la empresa. Sus datos de la empresa no se borran.`, confirmarLabel: 'Quitar', peligroso: true })) return
    await accion(`/miembros/${encodeURIComponent(m.uid)}`, { method: 'DELETE' }, 'Acceso quitado')
  }
  async function revocar(i: Invitacion) {
    if (!await confirmar({ titulo: 'Cancelar invitación', mensaje: `${i.email} ya no podrá entrar con esta invitación.`, confirmarLabel: 'Cancelar invitación', peligroso: true })) return
    await accion(`/invitaciones/${i.id}/revocar`, { method: 'POST' }, 'Invitación cancelada')
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Equipo" subtitle="Invita a tus colaboradores y define qué puede hacer cada uno" />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-4xl">
        {!REMOTE_ENABLED && <p className="text-sm text-zinc-500">La gestión del equipo requiere la plataforma en línea.</p>}
        {error && <div className="rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 text-sm px-4 py-3">{error}</div>}

        <section className="rounded-xl border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100"><UserPlus className="h-4 w-4 text-[#1B2980] dark:text-indigo-300" /> Invitar a una persona</h2>
          <form onSubmit={invitar} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-zinc-500">Correo
                <input type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="nombre@empresa.com" className={`${input} mt-1`} />
              </label>
              <label className="text-xs text-zinc-500">Rol
                <select value={rol} onChange={e => setRol(e.target.value)} className={`${input} mt-1`}>
                  {ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                </select>
              </label>
            </div>
            <button type="submit" disabled={enviando} className={`${BTN_PRIMARY} self-end flex items-center justify-center gap-2 disabled:opacity-60`}>
              <Send className="h-4 w-4" /> {enviando ? 'Enviando…' : 'Enviar invitación'}
            </button>
          </form>
          <p className="mt-3 flex gap-2 text-xs text-zinc-500"><Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />{ROLES.find(r => r.v === rol)?.d}</p>
          <p className="mt-2 flex gap-2 text-xs text-zinc-500"><Mail className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            {eq && !eq.correoActivo ? 'El envío de correo no está activo: crea la invitación y avísale tú a la persona.' : 'La persona recibe un correo con un enlace. Crea su cuenta con ese mismo correo y entra directo a tu empresa con el rol elegido.'}
          </p>
        </section>

        {!!eq?.invitaciones.length && (
          <section className="rounded-xl border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f]">
            <h2 className="px-5 py-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100 border-b border-tabler-line dark:border-[#2e2e2e]">Invitaciones pendientes</h2>
            <ul className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
              {eq.invitaciones.map(i => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-zinc-800 dark:text-zinc-100">{i.email}</p>
                    <p className="text-xs text-zinc-500">{etiqueta(i.rol)} · enviada el {formatDate(i.creado_en)}</p>
                  </div>
                  <button onClick={() => accion(`/invitaciones/${i.id}/reenviar`, { method: 'POST' }, 'Invitación reenviada')} className="text-xs text-[#1B2980] dark:text-indigo-300 hover:underline">Reenviar</button>
                  <button onClick={() => revocar(i)} className="p-1.5 text-zinc-400 hover:text-rose-500" title="Cancelar invitación"><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-xl border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f]">
          <h2 className="px-5 py-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100 border-b border-tabler-line dark:border-[#2e2e2e]">Personas con acceso {eq && <span className="font-normal text-zinc-400">({eq.miembros.length})</span>}</h2>
          <ul className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
            {eq?.miembros.map(m => {
              const yo = m.uid === eq.yo
              return (
                <li key={m.uid} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-zinc-800 dark:text-zinc-100">{m.email ?? m.uid} {yo && <Badge variant="info">Tú</Badge>}</p>
                    <p className="text-xs text-zinc-500">Desde {formatDate(m.creado_en)}</p>
                  </div>
                  {yo ? <span className="text-xs text-zinc-500">{etiqueta(m.rol)}</span> : (
                    <>
                      <select value={m.rol} onChange={e => accion(`/miembros/${encodeURIComponent(m.uid)}`, { method: 'PUT', body: JSON.stringify({ rol: e.target.value }) }, 'Rol actualizado')} className={`${input} !w-auto`}>
                        {ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                      </select>
                      <button onClick={() => quitar(m)} className="p-1.5 text-zinc-400 hover:text-rose-500" title="Quitar acceso"><Trash2 className="h-4 w-4" /></button>
                    </>
                  )}
                </li>
              )
            })}
            {eq && !eq.miembros.length && <li className="px-5 py-4 text-sm text-zinc-400">Sin personas todavía</li>}
          </ul>
        </section>
      </div>
      {toast && <Toast message={toast.texto} type={toast.tipo} onClose={() => setToast(null)} duration={4500} />}
    </div>
  )
}
