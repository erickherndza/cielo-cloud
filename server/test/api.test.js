import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/index.js'
import { pool } from '../src/db.js'

// Token falso: "uid:email". La verificación real de Firebase se prueba en integración.
const verify = async (t) => { const [uid, email, flag] = t.split(':'); return { uid, email, emailVerified: flag !== 'sinverificar' } }
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false })
const H = (u) => ({ authorization: `Bearer ${u}:${u}@t.com` })
const call = (method, url, user, payload) =>
  app.inject({ method, url, headers: user ? H(user) : {}, payload })

test.after(async () => { await app.close(); await pool.end() })

test('sin token → 401', async () => {
  assert.equal((await call('GET', '/api/empresas')).statusCode, 401)
})

test('aislamiento entre empresas y control de versión', async () => {
  const sfx = Date.now()
  const a = `ua${sfx}`, b = `ub${sfx}`
  const ea = (await call('POST', '/api/empresas', a, { nombre: 'A' })).json().id
  const eb = (await call('POST', '/api/empresas', b, { nombre: 'B' })).json().id

  // A escribe empleados en su empresa
  let r = await call('PUT', `/api/empresas/${ea}/documentos/empleados`, a, { datos: [{ id: 1 }], version: 0 })
  assert.equal(r.statusCode, 200); assert.equal(r.json().version, 1)

  // versión vieja → 409
  r = await call('PUT', `/api/empresas/${ea}/documentos/empleados`, a, { datos: [], version: 0 })
  assert.equal(r.statusCode, 409)

  // actualización correcta sube versión
  r = await call('PUT', `/api/empresas/${ea}/documentos/empleados`, a, { datos: [{ id: 1 }, { id: 2 }], version: 1 })
  assert.equal(r.json().version, 2)

  // B no puede leer ni escribir en la empresa de A
  assert.equal((await call('GET', `/api/empresas/${ea}/documentos`, b)).statusCode, 403)
  assert.equal((await call('PUT', `/api/empresas/${ea}/documentos/empleados`, b, { datos: [], version: 2 })).statusCode, 403)

  // B no ve la empresa de A en su lista
  const lista = (await call('GET', '/api/empresas', b)).json()
  assert.deepEqual(lista.map(e => e.id), [eb])

  // carga masiva de A
  const docs = (await call('GET', `/api/empresas/${ea}/documentos`, a)).json()
  assert.equal(docs.empleados.datos.length, 2)

  // colección no permitida
  assert.equal((await call('PUT', `/api/empresas/${ea}/documentos/hack`, a, { datos: [], version: 0 })).statusCode, 400)
})

// ── Seguridad ───────────────────────────────────────────────────────────────
const Hh = (t) => ({ authorization: `Bearer ${t}` })

test('correo sin verificar → 403', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/empresas', headers: Hh('uz:uz@t.com:sinverificar') })
  assert.equal(r.statusCode, 403)
})

test('datos primitivos o nulos → 400; array/objeto → 200', async () => {
  const u = `uv${Date.now()}`
  const e = (await call('POST', '/api/empresas', u, { nombre: 'V' })).json().id
  for (const bad of [123, 'texto', null, true]) {
    const r = await call('PUT', `/api/empresas/${e}/documentos/empleados`, u, { datos: bad, version: 0 })
    assert.equal(r.statusCode, 400, `debía rechazar ${JSON.stringify(bad)}`)
  }
  assert.equal((await call('PUT', `/api/empresas/${e}/documentos/empresa`, u, { datos: { nombre: 'x' }, version: 0 })).statusCode, 200)
})

test('historial: cada guardado archiva la versión anterior', async () => {
  const u = `uh${Date.now()}`
  const e = (await call('POST', '/api/empresas', u, { nombre: 'H' })).json().id
  await call('PUT', `/api/empresas/${e}/documentos/prestamos`, u, { datos: [{ id: 'a' }], version: 0 })
  await call('PUT', `/api/empresas/${e}/documentos/prestamos`, u, { datos: [{ id: 'b' }], version: 1 })
  await call('PUT', `/api/empresas/${e}/documentos/prestamos`, u, { datos: [{ id: 'c' }], version: 2 })
  const lista = (await call('GET', `/api/empresas/${e}/documentos/prestamos/historial`, u)).json()
  assert.deepEqual(lista.map(x => x.version), [2, 1])
  const v1 = (await call('GET', `/api/empresas/${e}/documentos/prestamos/historial/1`, u)).json()
  assert.deepEqual(v1.datos, [{ id: 'a' }])
  // otra empresa no puede leer este historial
  const otro = `uo${Date.now()}`
  await call('POST', '/api/empresas', otro, { nombre: 'O' })
  assert.equal((await call('GET', `/api/empresas/${e}/documentos/prestamos/historial`, otro)).statusCode, 403)
})

test('límite de escrituras por usuario → 429 con Retry-After', async () => {
  const lim = buildApp({ projectId: 'x', origins: [], verify, logger: false, limites: { general: 1000, escritura: 3, empresas: 100 } })
  const u = `ul${Date.now()}`
  const e = (await lim.inject({ method: 'POST', url: '/api/empresas', headers: H(u), payload: { nombre: 'L' } })).json().id
  const codigos = []
  for (let i = 0; i < 4; i++) {
    const r = await lim.inject({ method: 'PUT', url: `/api/empresas/${e}/documentos/feriados`, headers: H(u), payload: { datos: [], version: i } })
    codigos.push(r.statusCode)
  }
  assert.equal(codigos[3], 429)
  const r = await lim.inject({ method: 'PUT', url: `/api/empresas/${e}/documentos/feriados`, headers: H(u), payload: { datos: [], version: 9 } })
  assert.equal(r.headers['retry-after'], '60')
  await lim.close()
})

test('tope de empresas por usuario → 409', async () => {
  const lim = buildApp({ projectId: 'x', origins: [], verify, logger: false, limites: { general: 1000, escritura: 1000, empresas: 1000 } })
  const u = `ue${Date.now()}`
  let ultimo
  for (let i = 0; i < 11; i++) ultimo = await lim.inject({ method: 'POST', url: '/api/empresas', headers: H(u), payload: { nombre: `E${i}` } })
  assert.equal(ultimo.statusCode, 409)
  await lim.close()
})

test('ruta inexistente → 404 JSON genérico y cabeceras de seguridad presentes', async () => {
  const r = await app.inject({ method: 'GET', url: '/nada' })
  assert.equal(r.statusCode, 404)
  assert.deepEqual(r.json(), { error: 'No encontrado' })
  assert.equal(r.headers['x-content-type-options'], 'nosniff')
  assert.ok(r.headers['strict-transport-security'])
})
