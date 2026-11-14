import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/index.js'
import { pool } from '../src/db.js'

const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const SUP = `super${Date.now()}@cielo.test`
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false, superadmins: [SUP], autoregistro: false,
  limites: { general: 10_000, escritura: 10_000, empresas: 5, correos: 600 } })
const tok = (uid, email) => ({ authorization: `Bearer ${uid}:${email ?? uid + '@t.com'}` })
const S = tok('sa1', SUP)
const call = (method, url, headers, payload) => app.inject({ method, url, headers, payload })
test.after(async () => { await app.close(); await pool.end() })
const rnc = () => String(Math.floor(100000000 + Math.random() * 899999999))

test('solo el super admin administra; los demás ven 404 (la ruta no se revela)', async () => {
  assert.equal((await call('GET', '/api/admin/empresas', tok('u1'))).statusCode, 404)
  assert.equal((await call('POST', '/api/admin/empresas', tok('u1'), { nombre: 'X', rnc: rnc() })).statusCode, 404)
  assert.equal((await call('GET', '/api/admin/empresas', S)).statusCode, 200)
  assert.equal((await call('GET', '/api/yo', S)).json().esSuperadmin, true)
  assert.equal((await call('GET', '/api/yo', tok('u1'))).json().esSuperadmin, false)
})

test('autoregistro apagado: un usuario normal no crea empresas', async () => {
  assert.equal((await call('POST', '/api/empresas', tok('u2'), { nombre: 'X' })).statusCode, 403)
})

test('crear empresa: valida RNC (con guiones), y el RNC es único', async () => {
  const n = rnc()
  assert.equal((await call('POST', '/api/admin/empresas', S, { nombre: 'A', rnc: '12' })).statusCode, 400)
  const r = await call('POST', '/api/admin/empresas', S, { nombre: 'A', rnc: `${n.slice(0, 1)}-${n.slice(1, 3)}-${n.slice(3)}` })
  assert.equal(r.statusCode, 201); assert.equal(r.json().rnc, n)
  assert.equal((await call('POST', '/api/admin/empresas', S, { nombre: 'B', rnc: n })).statusCode, 409)
})

test('invitación: el invitado entra con su correo y queda con el rol; no se reutiliza', async () => {
  const id = (await call('POST', '/api/admin/empresas', S, { nombre: 'Inv', rnc: rnc() })).json().id
  const mail = `conta${Date.now()}@t.com`
  assert.equal((await call('POST', `/api/admin/empresas/${id}/invitaciones`, S, { email: mail.toUpperCase(), rol: 'contador' })).statusCode, 201)
  assert.equal((await call('POST', `/api/admin/empresas/${id}/invitaciones`, S, { email: mail, rol: 'contador' })).statusCode, 409)
  assert.equal((await call('POST', `/api/admin/empresas/${id}/invitaciones`, S, { email: mail, rol: 'dios' })).statusCode, 400)

  // Antes de entrar no tiene acceso; al listar sus empresas se acepta la invitación.
  const U = tok('c1', mail)
  assert.equal((await call('GET', `/api/empresas/${id}/documentos`, U)).statusCode, 403)
  const lista = (await call('GET', '/api/empresas', U)).json()
  assert.deepEqual(lista.map(e => [e.id, e.rol]), [[id, 'contador']])
  assert.equal((await call('GET', `/api/empresas/${id}/documentos`, U)).statusCode, 200)
  const inv = (await call('GET', `/api/admin/empresas/${id}/invitaciones`, S)).json()
  assert.equal(inv.invitaciones[0].estado, 'aceptada'); assert.equal(inv.miembros.length, 1)
})

test('un contador con varias empresas las ve todas; otro usuario no ve ninguna', async () => {
  const mail = `multi${Date.now()}@t.com`
  const ids = []
  for (const nombre of ['M1', 'M2']) {
    const id = (await call('POST', '/api/admin/empresas', S, { nombre, rnc: rnc() })).json().id
    await call('POST', `/api/admin/empresas/${id}/invitaciones`, S, { email: mail, rol: 'contador' })
    ids.push(id)
  }
  assert.deepEqual((await call('GET', '/api/empresas', tok('c2', mail))).json().map(e => e.id).sort(), ids.sort())
  assert.deepEqual((await call('GET', '/api/empresas', tok('x9'))).json(), [])
})

test('revocar invitación impide la entrada', async () => {
  const id = (await call('POST', '/api/admin/empresas', S, { nombre: 'Rev', rnc: rnc() })).json().id
  const mail = `rev${Date.now()}@t.com`
  const inv = (await call('POST', `/api/admin/empresas/${id}/invitaciones`, S, { email: mail, rol: 'rrhh' })).json()
  assert.equal((await call('POST', `/api/admin/empresas/${id}/invitaciones/${inv.id}/revocar`, S)).statusCode, 200)
  assert.deepEqual((await call('GET', '/api/empresas', tok('r1', mail))).json(), [])
})

test('suspender bloquea a los usuarios de la empresa, no al super admin; reactivar restaura', async () => {
  const id = (await call('POST', '/api/admin/empresas', S, { nombre: 'Sus', rnc: rnc() })).json().id
  const mail = `sus${Date.now()}@t.com`
  await call('POST', `/api/admin/empresas/${id}/invitaciones`, S, { email: mail, rol: 'admin' })
  const U = tok('s1', mail)
  await call('GET', '/api/empresas', U)
  assert.equal((await call('GET', `/api/empresas/${id}/documentos`, U)).statusCode, 200)
  await call('PUT', `/api/admin/empresas/${id}`, S, { estado: 'suspendida' })
  assert.equal((await call('GET', `/api/empresas/${id}/documentos`, U)).statusCode, 403)
  assert.equal((await call('GET', `/api/empresas/${id}/documentos`, S)).statusCode, 200)
  await call('PUT', `/api/admin/empresas/${id}`, S, { estado: 'activa' })
  assert.equal((await call('GET', `/api/empresas/${id}/documentos`, U)).statusCode, 200)
})

test('el acceso del super admin a datos ajenos queda registrado; los normales no ven el registro', async () => {
  const id = (await call('POST', '/api/admin/empresas', S, { nombre: 'Log', rnc: rnc() })).json().id
  const w = await call('PUT', `/api/empresas/${id}/documentos/empleados`, S, { datos: [], version: 0 })
  assert.equal(w.statusCode, 200)
  await call('GET', `/api/empresas/${id}/documentos`, S)
  await call('GET', `/api/empresas/${id}/documentos`, S)   // lectura repetida: una sola entrada
  const log = (await call('GET', `/api/admin/accesos?empresaId=${id}`, S)).json()
  assert.equal(log.filter(l => l.accion.startsWith('GET')).length, 1)
  assert.equal(log.filter(l => l.accion.startsWith('PUT')).length, 1)
  assert.equal((await call('GET', '/api/admin/accesos', tok('u1'))).statusCode, 404)
})

test('un usuario normal no entra a una empresa ajena (el super admin sí, sin ser miembro)', async () => {
  const id = (await call('POST', '/api/admin/empresas', S, { nombre: 'Aj', rnc: rnc() })).json().id
  assert.equal((await call('GET', `/api/empresas/${id}/documentos`, tok('intruso'))).statusCode, 403)
  assert.equal((await call('GET', `/api/empresas/${id}/documentos`, S)).statusCode, 200)
})

test('un correo parecido al del super admin pero distinto no es super admin', async () => {
  assert.equal((await call('GET', '/api/yo', tok('f1', `x${SUP}`))).json().esSuperadmin, false)
})
