// Ingeniería del caos — la red del navegador falla. Se prueba la capa de datos REAL del cliente
// (src/lib/storage.ts) contra la API real, inyectando fallas en `fetch`: cortes, 503, 429, lentitud y silencio.
// Hipótesis: nunca se pierde un cambio del usuario sin avisar, nunca se hace un bucle de peticiones,
// nunca se queda colgado cerrar sesión, y todo converge cuando vuelve la red.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../../src/index.js'
import { pool } from '../../src/db.js'
import { dormir, conLimite } from './proxy.js'

const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false, limites: { general: 1e7, escritura: 1e7, empresas: 1e7, correos: 5 }, limiteIp: 1e7 })
await app.listen({ port: 0, host: '127.0.0.1' })
process.env.NEXT_PUBLIC_API_URL = `http://127.0.0.1:${app.server.address().port}`
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'x'
const store = new Map()
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }
globalThis.sessionStorage = globalThis.localStorage
const { storage, initRemoteStore, flushStorage, getSyncStatus, getRechazo } = await import('../../../src/lib/storage.ts')

// ── Inyector de fallas sobre fetch ────────────────────────────────────────────
const fetchReal = globalThis.fetch
let falla = null                       // null | (url, init) => 'red' | 'silencio' | {status, headers?} | undefined
const llamadas = []
globalThis.fetch = async (url, init = {}) => {
  const esPut = (init.method ?? 'GET') === 'PUT'
  llamadas.push({ t: Date.now(), put: esPut, url: String(url) })
  const f = falla?.(String(url), init)
  if (f === 'red') throw new TypeError('fetch failed')
  if (f === 'silencio') return new Promise((_, rej) => { init.signal?.addEventListener('abort', () => rej(init.signal.reason)); setTimeout(() => rej(new TypeError('fetch failed (silencio, luego corte)')), 3000) })   // silencio total; la red cae 3 s después
  if (f && typeof f === 'object') return new Response(JSON.stringify(f.cuerpo ?? { error: 'caos' }), { status: f.status, headers: { 'content-type': 'application/json', ...(f.headers ?? {}) } })
  return fetchReal(url, init)
}
const puts = () => llamadas.filter(l => l.put).length
test.after(async () => { globalThis.fetch = fetchReal; await app.close(); await pool.end() })

let n = 0
const nuevoUsuario = async () => {
  const uid = `cli${Date.now()}${n++}`
  const token = async () => `${uid}:${uid}@t.com`
  falla = null
  await initRemoteStore(uid, token)
  return { uid, key: `cielo-empleados::${uid}`, leerServidor: async () => {
    const r = await app.inject({ url: '/api/empresas', headers: { authorization: `Bearer ${await token()}` } })
    const eid = r.json()[0].id
    const d = (await app.inject({ url: `/api/empresas/${eid}/documentos`, headers: { authorization: `Bearer ${await token()}` } })).json()
    return d.empleados?.datos
  } }
}

test('CAOS — red intermitente (40% de fallas) mientras el usuario edita 25 veces: al volver la red, el servidor tiene el último cambio', async () => {
  const u = await nuevoUsuario()
  let i = 0
  falla = () => (Math.random() < 0.4 ? (Math.random() < 0.5 ? 'red' : { status: 503, headers: { 'retry-after': '5' } }) : undefined)
  for (; i < 25; i++) { storage.setItem(u.key, JSON.stringify([{ id: 'e', version: i }])); await dormir(30) }
  falla = null
  for (let k = 0; k < 6; k++) { await flushStorage(); await dormir(100); if (getSyncStatus() === 'idle') break }
  assert.equal(getSyncStatus(), 'idle', 'no convergió tras volver la red')
  assert.deepEqual(await u.leerServidor(), [{ id: 'e', version: 24 }], 'el servidor no tiene el último cambio del usuario')
})

test('CAOS — servidor caído durante 1,5 s con ediciones continuas: no hay bucle de peticiones (los reintentos se espacian)', async () => {
  const u = await nuevoUsuario()
  falla = () => 'red'
  const antes = puts()
  const t0 = Date.now()
  while (Date.now() - t0 < 1000) { storage.setItem(u.key, JSON.stringify([{ t: Date.now() }])); await dormir(25) }
  await dormir(1500)                                         // el usuario paró: el guardado falla y se reintenta con espera
  const intentos = puts() - antes
  assert.ok(intentos >= 1 && intentos <= 4, `${intentos} peticiones PUT en 2,5 s: el cliente está martillando al servidor caído (o no intentó guardar)`)
  assert.equal(getSyncStatus(), 'error')
  falla = null
  await flushStorage()
  assert.equal(getSyncStatus(), 'idle')
})

test('CAOS — el servidor responde 429 (límite): el cliente no entra en bucle y el dato no se pierde', async () => {
  const u = await nuevoUsuario()
  falla = (url, init) => ((init.method ?? 'GET') === 'PUT' ? { status: 429, headers: { 'retry-after': '60' } } : undefined)
  const antes = puts()
  storage.setItem(u.key, JSON.stringify([{ id: 'x' }]))
  await dormir(1500)
  assert.ok(puts() - antes <= 2, `${puts() - antes} PUT en 1,5 s con 429`)
  falla = null
  await flushStorage()
  assert.deepEqual(await u.leerServidor(), [{ id: 'x' }], 'el cambio se perdió tras el 429')
})

test('CAOS — el servidor rechaza con 422 (período cerrado): se informa el motivo y NO se reintenta', async () => {
  const u = await nuevoUsuario()
  falla = (url, init) => ((init.method ?? 'GET') === 'PUT' ? { status: 422, cuerpo: { error: 'El período julio está cerrado', codigo: 'periodo_inmutable' } } : undefined)
  const antes = puts()
  storage.setItem(u.key, JSON.stringify([{ id: 'x' }]))
  await dormir(1300)
  assert.equal(getSyncStatus(), 'rejected')
  assert.match(getRechazo() ?? '', /cerrado/)
  assert.equal(puts() - antes, 1, 'un rechazo del servidor no debe reintentarse')
  falla = null
})

test('CAOS — red lenta (1 s por petición) y 30 ediciones seguidas: los cambios se agrupan (no se hace una petición por edición)', async () => {
  const u = await nuevoUsuario()
  falla = null
  const lento = globalThis.fetch
  globalThis.fetch = async (url, init) => { await dormir(1000); return lento(url, init) }
  const antes = puts()
  for (let i = 0; i < 30; i++) { storage.setItem(u.key, JSON.stringify([{ i }])); await dormir(20) }
  await flushStorage()
  globalThis.fetch = lento
  assert.ok(puts() - antes <= 4, `${puts() - antes} PUT para 30 ediciones`)
  assert.deepEqual(await u.leerServidor(), [{ i: 29 }])
})

test('CAOS — el servidor no responde nunca: cerrar sesión (flush) NO se queda colgado', async () => {
  const u = await nuevoUsuario()
  falla = (url, init) => ((init.method ?? 'GET') === 'PUT' ? 'silencio' : undefined)
  storage.setItem(u.key, JSON.stringify([{ id: 'pendiente' }]))
  await dormir(500)                                          // el PUT ya salió y no recibe respuesta
  const t0 = Date.now()
  const pendiente = await conLimite(flushStorage({ limiteMs: 1500 }), 6_000, 'flushStorage con el servidor mudo')
  assert.ok(Date.now() - t0 < 4_000, `flushStorage tardó ${Date.now() - t0} ms`)
  assert.equal(pendiente, true, 'debe avisar que quedaron cambios sin guardar')
  falla = null
})

test('CAOS — el servidor está caído al iniciar sesión: falla con un error claro y NO borra los datos locales', async () => {
  const uid = `cli${Date.now()}x`
  store.set(`cielo-empleados::${uid}`, JSON.stringify([{ id: 'local' }]))
  falla = () => 'red'
  await assert.rejects(() => initRemoteStore(uid, async () => `${uid}:${uid}@t.com`))
  assert.equal(store.get(`cielo-empleados::${uid}`), JSON.stringify([{ id: 'local' }]), 'se perdieron los datos locales')
  falla = null
})

test('CAOS — el servidor APLICA la escritura pero la respuesta se pierde: el cliente se da cuenta, no declara un falso conflicto y no pierde los cambios siguientes', async () => {
  const u = await nuevoUsuario()
  let perdidas = 0
  // Primera escritura: el servidor la guarda de verdad y luego la red falla antes de que el cliente reciba el 200
  falla = null
  const real = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const r = await real(url, init)
    if ((init.method ?? 'GET') === 'PUT' && perdidas < 1) { perdidas++; throw new TypeError('fetch failed (se perdió la respuesta)') }
    return r
  }
  storage.setItem(u.key, JSON.stringify([{ id: 'A' }]))
  await dormir(700)                                          // se envía A: el servidor lo aplica, el cliente no lo sabe
  storage.setItem(u.key, JSON.stringify([{ id: 'A' }, { id: 'B' }]))      // el usuario sigue trabajando
  for (let k = 0; k < 6; k++) { await flushStorage(); await dormir(150); if (getSyncStatus() === 'idle') break }
  globalThis.fetch = real
  assert.equal(perdidas, 1)
  assert.notEqual(getSyncStatus(), 'conflict', 'falso conflicto: el cliente chocó con SU PROPIA escritura anterior')
  assert.equal(getSyncStatus(), 'idle')
  assert.deepEqual(await u.leerServidor(), [{ id: 'A' }, { id: 'B' }], 'se perdió el cambio posterior a la respuesta perdida')
})

test('CAOS — edición continua durante 7 s sin pausas: se guarda mientras se escribe (no solo al parar)', { timeout: 20_000 }, async () => {
  const u = await nuevoUsuario()
  falla = null
  const antes = puts()
  const t0 = Date.now()
  let i = 0
  while (Date.now() - t0 < 7000) { storage.setItem(u.key, JSON.stringify([{ i: i++ }])); await dormir(100) }
  const durante = puts() - antes                              // peticiones hechas MIENTRAS el usuario seguía escribiendo
  assert.ok(durante >= 1, 'con edición continua nunca se guardó: un cierre brusco de la pestaña perdería todo el trabajo')
  await flushStorage()
})
