// Capa de almacenamiento: reemplaza a localStorage en los módulos de datos.
//
// - Sin NEXT_PUBLIC_API_URL (o sin Firebase): se comporta EXACTAMENTE como
//   localStorage (despliegues estáticos actuales siguen funcionando).
// - Con API: los datos viven en PostgreSQL. Se cargan todos de una vez al
//   iniciar sesión a una caché en memoria (lectura síncrona, igual que antes)
//   y cada escritura se sincroniza en segundo plano, una petición por
//   colección, con control de versión para no pisar cambios de otra sesión.
//   No se guarda copia en el navegador.

import { setParametros } from './parametros-legales'

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
export const REMOTE_ENABLED = API_URL !== '' && !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY

// Mismas colecciones que acepta el servidor (sin el prefijo `cielo-`).
const SYNC = new Set([
  'empresa', 'empleados', 'periodos', 'prestamos', 'aumentos', 'licencias',
  'bandas-salariales', 'liquidaciones', 'saldo-isr', 'feriados',
  'disfrutes-vacaciones', 'retribuciones-complementarias',
  'conceptos-personalizados', 'agenda-custom', 'agenda-done',
])

export type SyncStatus = 'idle' | 'saving' | 'error' | 'conflict'
type Listener = (s: SyncStatus) => void

interface Doc { raw: string | null; version: number }

type GetToken = () => Promise<string>

let empresaId: string | null = null
let getToken: GetToken | null = null
let cache = new Map<string, Doc>()
const dirty = new Set<string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const inflight = new Map<string, Promise<void>>()
let status: SyncStatus = 'idle'
let generacion = 0
const listeners = new Set<Listener>()

function setStatus(s: SyncStatus) {
  status = s
  listeners.forEach(l => l(s))
}
export function getSyncStatus(): SyncStatus { return status }
export function onSyncStatus(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

// `cielo-prestamos::uid123` → `prestamos`. null si no es una colección sincronizable.
function coleccionDe(key: string): string | null {
  const base = key.split('::')[0]
  if (!base.startsWith('cielo-')) return null
  const col = base.slice('cielo-'.length)
  return SYNC.has(col) ? col : null
}

async function api(path: string, init: RequestInit = {}, keepalive = false): Promise<Response> {
  if (!getToken) throw new Error('sin sesión')
  const token = await getToken()
  return fetch(`${API_URL}${path}`, {
    ...init,
    keepalive,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
}

// ── Acceso: qué empresas tiene la persona y cuál está activa ────────────────
export interface EmpresaAcceso { id: string; nombre: string; rnc: string | null; estado: string; rol: string }
export interface AccesoInfo {
  esSuperadmin: boolean
  email: string | null
  empresas: EmpresaAcceso[]
  /** Empresa cuyos datos están cargados; null = hay que elegir (o no tiene ninguna). */
  activa: { id: string; nombre: string; rnc: string | null } | null
  /** Un super admin dentro de una empresa de la que no es miembro. */
  soporte: boolean
}
let acceso: AccesoInfo | null = null
export function getAcceso(): AccesoInfo | null { return acceso }

const claveActiva = (uid: string) => `cielo-empresa-activa::${uid}`
let uidActual = ''

// El navegador solo recuerda QUÉ empresa estaba activa (id y nombre), nunca datos.
const claveSalida = (uid: string) => `cielo-sin-empresa::${uid}`
export function elegirEmpresa(e: { id: string; nombre: string; rnc: string | null }) {
  sessionStorage.removeItem(claveSalida(uidActual))
  localStorage.setItem(claveActiva(uidActual), JSON.stringify(e))
  window.location.assign(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/`)
}
export function salirDeEmpresa() {
  localStorage.removeItem(claveActiva(uidActual))
  // Sin esta marca, quien tiene una sola empresa volvía a entrar a ella solo.
  sessionStorage.setItem(claveSalida(uidActual), '1')
  window.location.assign(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/`)
}

// Llamada JSON a la API con el token de la sesión (panel de administración).
export async function apiJson<T = unknown>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T }> {
  const r = await api(path, init)
  const data = await r.json().catch(() => ({})) as T
  return { ok: r.ok, status: r.status, data }
}

// Convierte una respuesta de error de la API en un Error legible (nunca se
// trata un cuerpo de error como si fueran datos).
async function errorDeApi(r: Response): Promise<Error> {
  const msg = (await r.json().catch(() => ({})) as { error?: string }).error
  return new Error(msg || `Error del servidor (${r.status})`)
}

// ── Inicialización (al iniciar sesión) ──────────────────────────────────────
export async function initRemoteStore(uid: string, token: GetToken): Promise<void> {
  generacion++
  getToken = token
  cache = new Map()
  dirty.clear()
  empresaId = null
  uidActual = uid

  const ryo = await api('/api/yo')
  if (!ryo.ok) throw await errorDeApi(ryo)
  const yo = await ryo.json() as { email: string | null; esSuperadmin: boolean }
  // Parámetros legales globales (editables por el super admin). Si no se pueden
  // leer, el motor sigue con los valores de fábrica: nunca bloquea la entrada.
  try {
    const rp = await api('/api/parametros-legales')
    if (rp.ok) { const p = await rp.json() as { version: number; datos: unknown }; setParametros(p.datos, p.version) }
  } catch { /* se usan los valores por defecto */ }
  const rlista = await api('/api/empresas')
  if (!rlista.ok) throw await errorDeApi(rlista)
  const lista = await rlista.json() as EmpresaAcceso[]
  if (!Array.isArray(lista)) throw new Error('Respuesta inesperada del servidor')
  acceso = { esSuperadmin: yo.esSuperadmin, email: yo.email, empresas: lista, activa: null, soporte: false }

  // 1) la que la persona dejó activa (un super admin puede tener una ajena)
  let elegida: { id: string; nombre: string; rnc: string | null } | null = null
  try {
    const g = JSON.parse(localStorage.getItem(claveActiva(uid)) ?? 'null')
    if (g?.id && (lista.some(e => e.id === g.id) || yo.esSuperadmin)) elegida = { id: g.id, nombre: g.nombre ?? '', rnc: g.rnc ?? null }
  } catch { /* guardado dañado: se ignora */ }
  // 2) si solo tiene una, esa
  const salioAProposito = sessionStorage.getItem(claveSalida(uid)) === '1'
  if (!elegida && lista.length === 1 && !salioAProposito) elegida = { id: lista[0].id, nombre: lista[0].nombre, rnc: lista[0].rnc }

  let recienCreada = false
  // 3) sin ninguna: si el servidor lo permite (transición), crea la suya; el
  //    super admin nunca crea una "personal": administra desde su panel.
  if (!elegida && lista.length === 0 && !yo.esSuperadmin) {
    const r = await api('/api/empresas', { method: 'POST', body: JSON.stringify({ nombre: '' }) })
    if (r.ok) { elegida = { id: (await r.json()).id, nombre: '', rnc: null }; recienCreada = true }
    else if (r.status !== 403) throw new Error('No se pudo crear la empresa')
  }
  if (!elegida) return   // el SyncGate muestra el selector / «sin empresa» / panel

  const res = await api(`/api/empresas/${elegida.id}/documentos`)
  if (!res.ok) {
    // La empresa guardada ya no existe o se perdió el acceso: se olvida y se vuelve a elegir.
    if (res.status === 403 || res.status === 404) { localStorage.removeItem(claveActiva(uid)); return }
    throw new Error('No se pudieron cargar los datos')
  }
  empresaId = elegida.id
  const docs = await res.json() as Record<string, { datos: unknown; version: number }>
  for (const [col, d] of Object.entries(docs)) {
    cache.set(col, { raw: JSON.stringify(d.datos), version: d.version })
  }
  const soporte = yo.esSuperadmin && !lista.some(e => e.id === elegida!.id)
  acceso.activa = elegida
  acceso.soporte = soporte

  // Migración única de datos locales viejos: SOLO para quien tiene una única
  // empresa propia (o la acaba de crear), nunca al entrar a otra distinta —
  // si no, los datos locales de una empresa terminarían en otra.
  if (!soporte && (recienCreada || lista.length === 1)) {
    for (const col of SYNC) {
      if (cache.has(col)) continue
      const legacy = localStorage.getItem(`cielo-${col}::${uid}`)
      if (legacy) {
        cache.set(col, { raw: legacy, version: 0 })
        markDirty(col)
      }
    }
  }
}

export interface ItemComprobanteServidor {
  empleadoId: string; asunto: string; cuerpo: string; pdfBase64: string
}
export interface ResultadoEnvio { empleadoId: string; ok: boolean; error?: string }

// Envía comprobantes por correo desde el servidor (Resend). El destinatario lo
// resuelve el servidor a partir del empleado; aquí nunca se manda un correo.
export async function enviarComprobantesServidor(items: ItemComprobanteServidor[]): Promise<ResultadoEnvio[]> {
  if (!empresaId) throw new Error('sin empresa')
  const r = await api(`/api/empresas/${empresaId}/comprobantes/enviar`, { method: 'POST', body: JSON.stringify({ items }) })
  if (r.status === 503) throw new Error('El envío de correo aún no está configurado en el servidor')
  if (r.status === 429) throw new Error('Límite de correos alcanzado, intenta en unos minutos')
  if (!r.ok) throw new Error('No se pudo enviar')
  return (await r.json()).resultados as ResultadoEnvio[]
}

// Al cerrar sesión: primero se envía lo pendiente (la escritura tiene un retraso
// de 400 ms) y SOLO después se vacía el estado. Vaciarlo antes dejaba el envío
// sin empresa ni cambios pendientes y el último cambio se perdía en silencio.
export function resetRemoteStore() {
  const gen = ++generacion
  void flushStorage().finally(() => {
    if (gen !== generacion) return   // otra sesión ya inició: initRemoteStore reinició todo
    empresaId = null
    acceso = null
    getToken = null
    cache = new Map()
    dirty.clear()
  })
}

// ── Escritura en segundo plano ──────────────────────────────────────────────
function markDirty(col: string) {
  dirty.add(col)
  clearTimeout(timers.get(col))
  timers.set(col, setTimeout(() => { void push(col) }, 400))
}

function push(col: string, keepalive = false): Promise<void> {
  const prev = inflight.get(col) ?? Promise.resolve()
  const next = prev.then(() => pushOnce(col, keepalive)).finally(() => {
    if (inflight.get(col) === next) inflight.delete(col)
  })
  inflight.set(col, next)
  return next
}

async function pushOnce(col: string, keepalive: boolean): Promise<void> {
  while (dirty.has(col) && empresaId) {
    const doc = cache.get(col)
    if (!doc || doc.raw === null) { dirty.delete(col); return }
    dirty.delete(col)
    const sent = doc.raw
    setStatus('saving')
    try {
      const r = await api(
        `/api/empresas/${empresaId}/documentos/${col}`,
        { method: 'PUT', body: JSON.stringify({ datos: JSON.parse(sent), version: doc.version }) },
        keepalive && sent.length < 60_000,
      )
      if (r.status === 409) { setStatus('conflict'); return }
      if (!r.ok) throw new Error(String(r.status))
      doc.version = (await r.json()).version
      setStatus(dirty.size ? 'saving' : 'idle')
    } catch {
      dirty.add(col)            // reintentar luego sin perder el cambio
      setStatus('error')
      timers.set(col, setTimeout(() => { void push(col) }, 5000))
      return
    }
  }
}

export async function flushStorage(): Promise<void> {
  if (!REMOTE_ENABLED) return
  for (const col of [...dirty]) { clearTimeout(timers.get(col)); void push(col) }
  await Promise.all([...inflight.values()])
}

if (typeof window !== 'undefined' && REMOTE_ENABLED) {
  window.addEventListener('pagehide', () => {
    for (const col of [...dirty]) { clearTimeout(timers.get(col)); void push(col, true) }
  })
}

// ── API síncrona compatible con localStorage ────────────────────────────────
export const storage = {
  getItem(key: string): string | null {
    const col = REMOTE_ENABLED ? coleccionDe(key) : null
    if (!col) return localStorage.getItem(key)
    return cache.get(col)?.raw ?? null
  },
  setItem(key: string, value: string): void {
    const col = REMOTE_ENABLED ? coleccionDe(key) : null
    if (!col) { localStorage.setItem(key, value); return }
    const doc = cache.get(col) ?? { raw: null, version: 0 }
    doc.raw = value
    cache.set(col, doc)
    markDirty(col)
  },
  removeItem(key: string): void {
    const col = REMOTE_ENABLED ? coleccionDe(key) : null
    if (!col) { localStorage.removeItem(key); return }
    // El servidor no borra colecciones: se guarda vacía (array/objeto nulo → []).
    const doc = cache.get(col) ?? { raw: null, version: 0 }
    doc.raw = '[]'
    cache.set(col, doc)
    markDirty(col)
  },
}
