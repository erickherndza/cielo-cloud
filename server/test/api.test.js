import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/index.js'
import { pool } from '../src/db.js'

// Token falso: "uid:email". La verificación real de Firebase se prueba en integración.
const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email } }
const app = buildApp({ projectId: 'x', origins: [], verify })
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
