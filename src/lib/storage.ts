// Capa de almacenamiento: reemplaza a localStorage en los módulos de datos.
//
// - Sin NEXT_PUBLIC_API_URL (o sin Firebase): se comporta EXACTAMENTE como
//   localStorage (despliegues estáticos actuales siguen funcionando).
// - Con API: los datos viven en PostgreSQL. Se cargan todos de una vez al
//   iniciar sesión a una caché en memoria (lectura síncrona, igual que antes)
//   y cada escritura se sincroniza en segundo plano, una petición por
//   colección, con control de versión para no pisar cambios de otra sesión.
//   No se guarda copia en el navegador.

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

// ── Inicialización (al iniciar sesión) ──────────────────────────────────────
export async function initRemoteStore(uid: string, token: GetToken): Promise<void> {
  getToken = token
  cache = new Map()
  dirty.clear()

  const lista = await (await api('/api/empresas')).json() as { id: string }[]
  if (lista.length) {
    empresaId = lista[0].id
  } else {
    const r = await api('/api/empresas', { method: 'POST', body: JSON.stringify({ nombre: '' }) })
    if (!r.ok) throw new Error('No se pudo crear la empresa')
    empresaId = (await r.json()).id
  }

  const res = await api(`/api/empresas/${empresaId}/documentos`)
  if (!res.ok) throw new Error('No se pudieron cargar los datos')
  const docs = await res.json() as Record<string, { datos: unknown; version: number }>
  for (const [col, d] of Object.entries(docs)) {
    cache.set(col, { raw: JSON.stringify(d.datos), version: d.version })
  }

  // Migración única: lo que esta cuenta ya tenía en este navegador se sube
  // SOLO para colecciones que el servidor todavía no tiene (nunca pisa datos
  // remotos). La copia local no se borra aquí.
  for (const col of SYNC) {
    if (cache.has(col)) continue
    const legacy = localStorage.getItem(`cielo-${col}::${uid}`)
    if (legacy) {
      cache.set(col, { raw: legacy, version: 0 })
      markDirty(col)
    }
  }
}

export function resetRemoteStore() {
  void flushStorage()
  empresaId = null
  getToken = null
  cache = new Map()
  dirty.clear()
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
