import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/index.js'
import { pool } from '../src/db.js'

// Servidor real en un puerto; el cliente (src/lib/storage.ts) habla con él por fetch.
const verify = async (t) => { const [uid, email, flag] = t.split(':'); return { uid, email, emailVerified: flag !== 'sinverificar' } }
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false })
await app.listen({ port: 0, host: '127.0.0.1' })
const port = app.server.address().port

process.env.NEXT_PUBLIC_API_URL = `http://127.0.0.1:${port}`
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'x'
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k),
}
// Node 26 trae sessionStorage global y Node 22 no: simular ambos para que corra igual en cualquier versión
globalThis.sessionStorage = globalThis.localStorage
const { storage, initRemoteStore, flushStorage, getSyncStatus } = await import('../../src/lib/storage.ts')

test.after(async () => { await app.close(); await pool.end() })

const uid = `u${Date.now()}`
const token = async () => `${uid}:${uid}@t.com`

test('migra lo local, persiste en Postgres y recarga igual', async () => {
  store.set(`cielo-empleados::${uid}`, JSON.stringify([{ id: 'e1', nombre: 'Ana' }]))
  await initRemoteStore(uid, token)
  // lo local quedó disponible vía storage (desde caché)
  assert.deepEqual(JSON.parse(storage.getItem(`cielo-empleados::${uid}`)), [{ id: 'e1', nombre: 'Ana' }])
  storage.setItem(`cielo-prestamos::${uid}`, JSON.stringify([{ id: 'p1' }]))
  await flushStorage()
  assert.equal(getSyncStatus(), 'idle')

  // "otro navegador": localStorage vacío, mismos datos desde el servidor
  store.clear()
  await initRemoteStore(uid, token)
  assert.equal(JSON.parse(storage.getItem(`cielo-empleados::${uid}`))[0].nombre, 'Ana')
  assert.equal(JSON.parse(storage.getItem(`cielo-prestamos::${uid}`))[0].id, 'p1')
})

test('lo local NO pisa datos que ya están en el servidor', async () => {
  store.set(`cielo-empleados::${uid}`, JSON.stringify([{ id: 'viejo' }]))
  await initRemoteStore(uid, token)
  assert.equal(JSON.parse(storage.getItem(`cielo-empleados::${uid}`))[0].id, 'e1')
})

test('claves no sincronizables siguen en localStorage', async () => {
  storage.setItem('cielo-theme', 'dark')
  assert.equal(store.get('cielo-theme'), 'dark')
})

test('conflicto de versión se reporta y no pisa', async () => {
  await initRemoteStore(uid, token)
  // otra sesión modifica empleados
  await initRemoteStore(uid, token) // reinicia caché; simulamos 2ª sesión escribiendo directo
  const r = await app.inject({ method: 'GET', url: '/api/empresas', headers: { authorization: `Bearer ${await token()}` } })
  const eid = r.json()[0].id
  const cur = (await app.inject({ method: 'GET', url: `/api/empresas/${eid}/documentos`, headers: { authorization: `Bearer ${await token()}` } })).json()
  await app.inject({ method: 'PUT', url: `/api/empresas/${eid}/documentos/empleados`,
    headers: { authorization: `Bearer ${await token()}` }, payload: { datos: [{ id: 'otra-sesion' }], version: cur.empleados.version } })
  // esta sesión (versión vieja en caché) intenta guardar
  storage.setItem(`cielo-empleados::${uid}`, JSON.stringify([{ id: 'mio' }]))
  await flushStorage()
  assert.equal(getSyncStatus(), 'conflict')
  const after = (await app.inject({ method: 'GET', url: `/api/empresas/${eid}/documentos`, headers: { authorization: `Bearer ${await token()}` } })).json()
  assert.equal(after.empleados.datos[0].id, 'otra-sesion')
})
