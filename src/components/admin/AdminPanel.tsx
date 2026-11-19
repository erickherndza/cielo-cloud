'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2, Search, Plus, UserPlus, ShieldAlert, LogIn, Pause, Play, X, History, Users, LayoutDashboard, Activity } from 'lucide-react'
import { apiJson, elegirEmpresa, getAcceso } from '@/lib/storage'
import { formatDate } from '@/lib/utils'
import { rncValido } from '@/lib/rnc'
import { RncField } from '@/components/empresa/RncField'
import { ParametrosLegalesPanel } from './ParametrosLegalesPanel'
import { CobrosPanel, type CobrosData } from './CobrosPanel'
import { ErroresPanel } from './ErroresPanel'

interface EmpresaAdmin { id: string; nombre: string; rnc: string | null; estado: 'activa' | 'suspendida'; creado_en: string; miembros: number
  contacto: string | null; empleados: number | null; periodos: number | null; ultima_actividad: string | null }
interface Invitacion { id: string; email: string; rol: string; estado: string; expira_en: string }
interface Miembro { uid: string; email: string | null; rol: string }
interface Resumen {
  empresas: { total: number; activas: number; suspendidas: number; nuevas_30d: number; sin_rnc: number }
  usuarios: number; empleados: number; activas7d: number; activas30d: number
  altasPorMes: { mes: string; n: number }[]
}
interface UsuarioAdmin { uid: string; email: string | null; rol: string; creado_en: string; empresa_id: string; empresa: string; rnc: string | null; estado: string; ultima_actividad: string | null; ultimo_acceso: string | null }
interface Acceso { id: number; empresa: string; rnc: string | null; email: string | null; accion: string; creado_en: string }

const ROLES = [
  { v: 'admin', l: 'Administrador' }, { v: 'gerente', l: 'Gerente' },
  { v: 'rrhh', l: 'RRHH' }, { v: 'contador', l: 'Contador' },
]
const inputCls = 'w-full rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#262626] dark:text-zinc-200 px-3 py-2 text-sm focus:border-[#1B2980] focus:outline-none'
const DIA = 86_400_000
const hace = (iso: string | null) => {
  if (!iso) return 'Nunca'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / DIA)
  return d <= 0 ? 'Hoy' : d === 1 ? 'Ayer' : `Hace ${d} días`
}
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' })

// Administración de la plataforma (solo super admin). Nunca muestra datos de
// empleados: solo empresas, accesos e invitaciones.
export function AdminPanel() {
  const [empresas, setEmpresas] = useState<EmpresaAdmin[]>([])
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [nuevo, setNuevo] = useState({ nombre: '', rnc: '' })
  const [sel, setSel] = useState<EmpresaAdmin | null>(null)
  const [det, setDet] = useState<{ invitaciones: Invitacion[]; miembros: Miembro[] } | null>(null)
  const [inv, setInv] = useState({ email: '', rol: 'contador' })
  const [vista, setVista] = useState<'resumen' | 'empresas' | 'usuarios' | 'cobros' | 'errores' | 'accesos' | 'legal'>('resumen')
  const [accesos, setAccesos] = useState<Acceso[]>([])
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [cobros, setCobros] = useState<CobrosData | null>(null)
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([])
  const miEmpresa = getAcceso()?.empresas.find(e => e.estado !== 'suspendida') ?? null

  const cargar = useCallback(async () => {
    const r = await apiJson<EmpresaAdmin[]>(`/api/admin/empresas?q=${encodeURIComponent(q)}`)
    if (r.ok) setEmpresas(r.data)
  }, [q])
  useEffect(() => { const t = setTimeout(() => { void cargar() }, 250); return () => clearTimeout(t) }, [cargar])

  const cargarDetalle = useCallback(async (id: string) => {
    const r = await apiJson<{ invitaciones: Invitacion[]; miembros: Miembro[] }>(`/api/admin/empresas/${id}/invitaciones`)
    if (r.ok) setDet(r.data)
  }, [])
  useEffect(() => { if (sel) void cargarDetalle(sel.id); else setDet(null) }, [sel, cargarDetalle])
  useEffect(() => {
    if (vista === 'resumen') {
      void apiJson<Resumen>('/api/admin/resumen').then(r => { if (r.ok) setResumen(r.data) })
      void apiJson<CobrosData>('/api/admin/cobros').then(r => { if (r.ok) setCobros(r.data) })
    }
    if (vista === 'usuarios') void apiJson<UsuarioAdmin[]>('/api/admin/usuarios').then(r => { if (r.ok) setUsuarios(r.data) })
  }, [vista])
  useEffect(() => {
    if (vista !== 'accesos') return
    void apiJson<Acceso[]>('/api/admin/accesos').then(r => { if (r.ok) setAccesos(r.data) })
  }, [vista])

  const error = (r: { data: unknown }, def: string) =>
    setMsg({ tipo: 'error', texto: (r.data as { error?: string })?.error ?? def })

  async function crear() {
    const r = await apiJson('/api/admin/empresas', { method: 'POST', body: JSON.stringify(nuevo) })
    if (!r.ok) return error(r, 'No se pudo crear la empresa')
    setNuevo({ nombre: '', rnc: '' }); setMsg({ tipo: 'ok', texto: 'Empresa creada' }); void cargar()
  }
  async function cambiarEstado(e: EmpresaAdmin) {
    const estado = e.estado === 'activa' ? 'suspendida' : 'activa'
    if (estado === 'suspendida' && !window.confirm(`¿Suspender ${e.nombre}? Sus usuarios no podrán entrar hasta reactivarla.`)) return
    const r = await apiJson<EmpresaAdmin>(`/api/admin/empresas/${e.id}`, { method: 'PUT', body: JSON.stringify({ estado }) })
    if (!r.ok) return error(r, 'No se pudo cambiar el estado')
    setSel({ ...e, estado }); void cargar()
  }
  async function invitar() {
    if (!sel) return
    const r = await apiJson(`/api/admin/empresas/${sel.id}/invitaciones`, { method: 'POST', body: JSON.stringify(inv) })
    if (!r.ok) return error(r, 'No se pudo invitar')
    setInv({ email: '', rol: inv.rol }); setMsg({ tipo: 'ok', texto: 'Invitación creada: la persona queda asignada al entrar con ese correo' })
    void cargarDetalle(sel.id); void cargar()
  }
  // Mensaje listo para pegar en WhatsApp o correo. El correo va en el texto,
  // no en la URL (datos personales fuera de los enlaces).
  async function copiarInvitacion(email: string, rol: string) {
    const rolLabel = ROLES.find(r => r.v === rol)?.l ?? rol
    const texto =
      `Te invité a ${sel?.nombre ?? 'tu empresa'} en Cielo Cloud Nómina con el rol de ${rolLabel}.\n` +
      `1) Entra a ${window.location.origin}/registro/\n` +
      `2) Regístrate con Google o con correo y contraseña usando EXACTAMENTE este correo: ${email}\n` +
      `3) Si usas contraseña, verifica tu correo desde el mensaje que te llegará.\n` +
      `Al entrar con ese correo verificado, verás la empresa asignada.`
    try {
      await navigator.clipboard.writeText(texto)
      setMsg({ tipo: 'ok', texto: 'Mensaje de invitación copiado: pégalo en WhatsApp o correo' })
    } catch {
      setMsg({ tipo: 'error', texto: 'No se pudo copiar. Tu navegador bloqueó el portapapeles.' })
    }
  }
  async function revocar(id: string) {
    if (!sel) return
    const r = await apiJson(`/api/admin/empresas/${sel.id}/invitaciones/${id}/revocar`, { method: 'POST' })
    if (!r.ok) return error(r, 'No se pudo revocar')
    void cargarDetalle(sel.id)
  }
  async function quitarMiembro(m: Miembro) {
    if (!sel) return
    if (!window.confirm(`¿Quitar a ${m.email ?? m.uid} de ${sel.nombre}? Pierde el acceso de inmediato.`)) return
    const r = await apiJson(`/api/admin/empresas/${sel.id}/miembros/${encodeURIComponent(m.uid)}`, { method: 'DELETE' })
    if (!r.ok) return error(r, 'No se pudo quitar')
    setMsg({ tipo: 'ok', texto: 'Usuario quitado de la empresa' })
    void cargarDetalle(sel.id); void cargar()
  }
  async function cambiarRol(m: Miembro, rol: string) {
    if (!sel || rol === m.rol) return
    const r = await apiJson(`/api/admin/empresas/${sel.id}/miembros/${encodeURIComponent(m.uid)}`, { method: 'PUT', body: JSON.stringify({ rol }) })
    if (!r.ok) return error(r, 'No se pudo cambiar el rol')
    void cargarDetalle(sel.id)
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#1B2980] to-[#2f3fa8] text-white">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Consola de Cielo Cloud</h1>
            <p className="text-xs text-zinc-500">Uso de la plataforma, empresas, usuarios y parámetros legales. No muestra datos de empleados.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {miEmpresa && (
          <button onClick={() => elegirEmpresa(miEmpresa)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-[#2e2e2e] dark:text-zinc-300">
            <Building2 className="h-3.5 w-3.5" /> Ir a mi empresa</button>
        )}
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-[#262626]">
          {(['resumen', 'empresas', 'usuarios', 'cobros', 'errores', 'legal', 'accesos'] as const).map(v => (
            <button key={v} onClick={() => setVista(v)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${vista === v ? 'bg-white text-[#1B2980] shadow-sm dark:bg-[#2e2e2e] dark:text-indigo-300' : 'text-zinc-500'}`}>
              {v === 'accesos' ? 'Historial de accesos' : v === 'legal' ? 'Parámetros legales' : v}
            </button>
          ))}
        </div>
        </div>
      </div>

      {msg && (
        <div className={`flex items-center justify-between rounded-lg border px-4 py-2 text-sm ${msg.tipo === 'ok'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300'
          : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-950/20 dark:text-rose-300'}`}>
          {msg.texto}<button onClick={() => setMsg(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {vista === 'resumen' ? (
        <ResumenVista r={resumen} empresas={empresas} cobros={cobros} irA={setVista} />
      ) : vista === 'usuarios' ? (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-[#2e2e2e] dark:bg-[#1f1f1f]">
          <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-[#2e2e2e] dark:text-zinc-100">
            <Users className="h-4 w-4 text-[#1B2980] dark:text-indigo-400" /> Usuarios con acceso ({usuarios.length})
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-zinc-50 text-left text-zinc-500 dark:bg-[#262626]">
              <th className="px-4 py-2 font-medium">Correo</th><th className="px-4 py-2 font-medium">Rol</th>
              <th className="px-4 py-2 font-medium">Empresa</th><th className="px-4 py-2 font-medium">Desde</th>
              <th className="px-4 py-2 font-medium">Último acceso</th><th className="px-4 py-2 font-medium">Actividad de la empresa</th></tr></thead>
            <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
              {usuarios.map(u => (
                <tr key={`${u.empresa_id}-${u.uid}`}>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{u.email ?? u.uid}</td>
                  <td className="px-4 py-2 text-zinc-500">{ROLES.find(r => r.v === u.rol)?.l ?? u.rol}</td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{u.empresa || '(sin nombre)'} <span className="text-zinc-400">{u.rnc}</span>
                    {u.estado === 'suspendida' && <span className="ml-1 text-amber-600">· suspendida</span>}</td>
                  <td className="px-4 py-2 tabular-nums text-zinc-500">{formatDate(u.creado_en)}</td>
                  <td className="px-4 py-2 text-zinc-500">{hace(u.ultimo_acceso)}</td>
                  <td className="px-4 py-2 text-zinc-500">{hace(u.ultima_actividad)}</td></tr>
              ))}
              {!usuarios.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-400">Sin usuarios</td></tr>}
            </tbody>
          </table>
          <p className="border-t border-zinc-200 px-4 py-2 text-[10px] text-zinc-400 dark:border-[#2e2e2e]">«Último acceso» se registra desde que se aplicó la actualización; antes aparece como «Nunca». La actividad de la empresa es la de su último guardado.</p>
        </div>
      ) : vista === 'cobros' ? (
        <CobrosPanel />
      ) : vista === 'errores' ? (
        <ErroresPanel />
      ) : vista === 'legal' ? (
        <ParametrosLegalesPanel />
      ) : vista === 'accesos' ? (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-[#2e2e2e] dark:bg-[#1f1f1f]">
          <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-[#2e2e2e] dark:text-zinc-100">
            <History className="h-4 w-4 text-[#1B2980] dark:text-indigo-400" /> Accesos de super admin a empresas
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-zinc-50 text-left text-zinc-500 dark:bg-[#262626]">
              <th className="px-4 py-2 font-medium">Fecha</th><th className="px-4 py-2 font-medium">Quién</th>
              <th className="px-4 py-2 font-medium">Empresa</th><th className="px-4 py-2 font-medium">Acción</th></tr></thead>
            <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
              {accesos.map(a => (
                <tr key={a.id}><td className="px-4 py-2 tabular-nums text-zinc-500">{fechaHora(a.creado_en)}</td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{a.email}</td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{a.empresa} <span className="text-zinc-400">{a.rnc}</span></td>
                  <td className="px-4 py-2 font-mono text-zinc-500">{a.accion}</td></tr>
              ))}
              {!accesos.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-400">Sin accesos registrados</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-[#2e2e2e] dark:bg-[#1f1f1f]">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><Plus className="h-4 w-4" /> Nueva empresa</p>
              <div className="grid items-start gap-3 sm:grid-cols-[1fr_20rem_auto]">
                <input className={inputCls} placeholder="Nombre de la empresa" value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} />
                <RncField id="rnc-nueva" value={nuevo.rnc} onChange={v => setNuevo(p => ({ ...p, rnc: v }))}
                  onDatos={d => setNuevo(p => ({ ...p, nombre: p.nombre.trim() ? p.nombre : d.razonSocial }))} />
                <button onClick={crear} disabled={!nuevo.nombre.trim() || !rncValido(nuevo.rnc)}
                  className="rounded-lg bg-[#1B2980] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Crear</button>
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <input className={`${inputCls} pl-9`} placeholder="Buscar por nombre o RNC" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-[#2e2e2e] dark:bg-[#1f1f1f]">
              <table className="w-full text-sm">
                <thead><tr className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-[#262626]">
                  <th className="px-4 py-2 font-medium">Empresa</th><th className="px-4 py-2 font-medium">RNC</th>
                  <th className="px-4 py-2 font-medium text-right">Empleados</th><th className="px-4 py-2 font-medium text-right">Usuarios</th>
                  <th className="px-4 py-2 font-medium">Actividad</th><th className="px-4 py-2 font-medium">Estado</th></tr></thead>
                <tbody className="divide-y divide-tabler-line dark:divide-[#2e2e2e]">
                  {empresas.map(e => (
                    <tr key={e.id} onClick={() => setSel(e)}
                      className={`cursor-pointer hover:bg-zinc-50 dark:hover:bg-[#262626] ${sel?.id === e.id ? 'bg-[#eef0fb] dark:bg-[#262626]' : ''}`}>
                      <td className="px-4 py-2.5 font-medium text-[#1B2980] dark:text-indigo-300">{e.nombre || '(sin nombre)'}
                        {e.contacto && <span className="block text-[11px] font-normal text-zinc-400">{e.contacto}</span>}</td>
                      <td className="px-4 py-2.5 tabular-nums text-zinc-500">{e.rnc ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">{e.empleados ?? 0}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">{e.miembros}</td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500">{hace(e.ultima_actividad)}</td>
                      <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${e.estado === 'activa'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'}`}>{e.estado}</span></td>
                    </tr>
                  ))}
                  {!empresas.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-zinc-400"><Building2 className="mx-auto mb-2 h-6 w-6" />Sin empresas</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="h-fit space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-[#2e2e2e] dark:bg-[#1f1f1f]">
            {!sel ? <p className="py-8 text-center text-sm text-zinc-400">Elige una empresa para administrarla</p> : (<>
              <div>
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">{sel.nombre || '(sin nombre)'}</p>
                <p className="text-xs text-zinc-500">RNC {sel.rnc ?? '—'} · creada {formatDate(sel.creado_en)}</p>
                <p className="text-xs text-zinc-500">{sel.empleados ?? 0} empleados · {sel.periodos ?? 0} períodos · actividad: {hace(sel.ultima_actividad)}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => elegirEmpresa({ id: sel.id, nombre: sel.nombre, rnc: sel.rnc })}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#1B2980] px-3 py-2 text-xs font-semibold text-white">
                  <LogIn className="h-3.5 w-3.5" /> Entrar (queda registrado)</button>
                <button onClick={() => cambiarEstado(sel)}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 dark:border-[#2e2e2e] dark:text-zinc-300">
                  {sel.estado === 'activa' ? <><Pause className="h-3.5 w-3.5" /> Suspender</> : <><Play className="h-3.5 w-3.5" /> Reactivar</>}</button>
              </div>
              <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-[#2e2e2e]">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200"><UserPlus className="h-3.5 w-3.5" /> Invitar usuario</p>
                <input className={inputCls} type="email" placeholder="correo@empresa.com" value={inv.email} onChange={e => setInv({ ...inv, email: e.target.value })} />
                <div className="flex gap-2">
                  <select className={inputCls} value={inv.rol} onChange={e => setInv({ ...inv, rol: e.target.value })}>
                    {ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}</select>
                  <button onClick={invitar} disabled={!inv.email.trim()} className="rounded-lg bg-[#1B2980] px-3 text-xs font-semibold text-white disabled:opacity-40">Invitar</button>
                </div>
                <p className="text-[10px] text-zinc-400">No se envía correo: usa «copiar invitación» en la lista y mándasela tú. La persona queda asignada cuando entre con ese correo verificado.</p>
              </div>
              <div className="space-y-1 border-t border-zinc-200 pt-3 text-xs dark:border-[#2e2e2e]">
                <p className="font-semibold text-zinc-700 dark:text-zinc-200">Usuarios</p>
                {det?.miembros.map(m => (
                  <p key={m.uid} className="flex items-center justify-between gap-2 text-zinc-500">
                    <span className="min-w-0 truncate">{m.email ?? m.uid}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <select aria-label="Rol" value={m.rol} onChange={e => cambiarRol(m, e.target.value)}
                        className="rounded border border-zinc-200 bg-transparent px-1 py-0.5 text-xs dark:border-[#2e2e2e]">
                        {ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}</select>
                      <button onClick={() => quitarMiembro(m)} className="text-rose-600 underline dark:text-rose-400">quitar</button>
                    </span></p>))}
                {det?.invitaciones.filter(i => i.estado === 'pendiente').map(i => (
                  <p key={i.id} className="flex items-center justify-between text-amber-600 dark:text-amber-400">
                    <span className="min-w-0 truncate">{i.email} · {i.rol} (pendiente)</span>
                    <span className="flex shrink-0 gap-2">
                      <button onClick={() => copiarInvitacion(i.email, i.rol)} className="underline">copiar invitación</button>
                      <button onClick={() => revocar(i.id)} className="underline">revocar</button></span></p>))}
                {det && !det.miembros.length && !det.invitaciones.some(i => i.estado === 'pendiente') && <p className="text-zinc-400">Sin usuarios todavía</p>}
              </div>
            </>)}
          </aside>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, valor, sub }: { label: string; valor: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-[#2e2e2e] dark:bg-[#1f1f1f]">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{valor}</p>
      {sub && <p className="mt-1 text-[11px] text-zinc-400">{sub}</p>}
    </div>
  )
}

// Uso de la plataforma: solo agregados (nunca el contenido de una empresa).
function ResumenVista({ r, empresas, cobros, irA }: { r: Resumen | null; empresas: EmpresaAdmin[]; cobros: CobrosData | null; irA: (v: 'cobros') => void }) {
  if (!r) return <p className="py-10 text-center text-sm text-zinc-400">Cargando resumen…</p>
  const max = Math.max(1, ...r.altasPorMes.map(a => a.n))
  const inactivas = empresas.filter(e => e.estado === 'activa'
    && (!e.ultima_actividad || Date.now() - new Date(e.ultima_actividad).getTime() > 30 * DIA))
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Empresas" valor={r.empresas.total} sub={`${r.empresas.activas} activas · ${r.empresas.suspendidas} suspendidas`} />
        <Kpi label="Nuevas (30 días)" valor={r.empresas.nuevas_30d} sub={r.empresas.sin_rnc ? `${r.empresas.sin_rnc} aún sin RNC` : undefined} />
        <Kpi label="Usuarios" valor={r.usuarios} />
        <Kpi label="Empleados en nómina" valor={r.empleados} sub="suma de todas las empresas" />
        <Kpi label="Empresas con actividad (7 días)" valor={r.activas7d} sub={`${r.activas30d} en 30 días`} />
        {cobros && <Kpi label="Ingreso mensual recurrente" valor={`RD$${cobros.mrr.toLocaleString('es-DO', { maximumFractionDigits: 0 })}`} sub={`RD$${cobros.cobrado30.toLocaleString('es-DO', { maximumFractionDigits: 0 })} cobrado en 30 días`} />}
        {cobros && (
          <button onClick={() => irA('cobros')} className="text-left">
            <Kpi label="Pagos vencidos" valor={cobros.empresas.filter(e => e.estado_cobro === 'vencido').length}
              sub={`${cobros.empresas.filter(e => e.estado_cobro === 'por_vencer').length} vencen en 7 días · ver cobros`} />
          </button>)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-[#2e2e2e] dark:bg-[#1f1f1f]">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><LayoutDashboard className="h-4 w-4" /> Empresas nuevas por mes</p>
          {!r.altasPorMes.length ? <p className="py-6 text-center text-sm text-zinc-400">Sin altas en los últimos 12 meses</p> : (
            <div className="space-y-1.5">
              {r.altasPorMes.map(a => (
                <div key={a.mes} className="flex items-center gap-2 text-xs">
                  <span className="w-14 tabular-nums text-zinc-500">{a.mes}</span>
                  <div className="h-3 flex-1 rounded bg-zinc-100 dark:bg-[#262626]"><div className="h-3 rounded bg-[#1B2980]" style={{ width: `${(a.n / max) * 100}%` }} /></div>
                  <span className="w-6 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{a.n}</span>
                </div>))}
            </div>)}
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-[#2e2e2e] dark:bg-[#1f1f1f]">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><Activity className="h-4 w-4" /> Sin actividad en 30 días ({inactivas.length})</p>
          {!inactivas.length ? <p className="py-6 text-center text-sm text-zinc-400">Todas las empresas activas guardaron algo en el último mes</p> : (
            <ul className="space-y-1.5 text-xs">
              {inactivas.slice(0, 12).map(e => (
                <li key={e.id} className="flex justify-between gap-2"><span className="truncate text-zinc-700 dark:text-zinc-300">{e.nombre || '(sin nombre)'}</span>
                  <span className="shrink-0 text-zinc-400">{hace(e.ultima_actividad)}</span></li>))}
            </ul>)}
        </div>
      </div>
    </div>
  )
}
