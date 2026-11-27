// El administrador de cada empresa gestiona su equipo: invita (con correo), cambia el rol y quita.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/index.js'
import { pool } from '../src/db.js'

const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const RUN = `${Date.now()}${process.pid}`
const SUP = `super${RUN}@cielo.test`
const tok = (uid, email) => ({ authorization: `Bearer ${uid}:${email ?? uid + '@t.com'}` })
const S = tok(`sa${RUN}`, SUP)
const enviados = []
const app = buildApp({
  projectId: 'x', origins: [], verify, logger: false, superadmins: [SUP], webUrl: 'https://web.test',
  enviarCorreo: async (m) => { enviados.push(m) },
  limites: { general: 10_000, escritura: 10_000, empresas: 100, correos: 100, invitaciones: 5 },
})
const call = (method, url, headers, payload) => app.inject({ method, url, headers, payload })
const rnc = () => String(Math.floor(100000000 + Math.random() * 899999999))
test.after(async () => { await app.close(); await pool.end() })

async function empresaConAdmin(sufijo) {
  const adminMail = `adm${sufijo}${RUN}@t.com`
  const e = (await call('POST', '/api/admin/empresas', S, { nombre: `Empresa ${sufijo}`, rnc: rnc() })).json()
  await call('POST', `/api/admin/empresas/${e.id}/invitaciones`, S, { email: adminMail, rol: 'admin' })
  const A = tok(`ua${sufijo}${RUN}`, adminMail)
  await call('GET', '/api/empresas', A)   // acepta la invitación
  return { id: e.id, A }
}

test('el administrador invita, la persona entra con su rol y recibe el correo con enlace', async () => {
  const { id, A } = await empresaConAdmin('1')
  const r = await call('POST', `/api/empresas/${id}/equipo/invitaciones`, A, { email: 'Nuevo@T.com ', rol: 'auxiliar' })
  assert.equal(r.statusCode, 201)
  assert.equal(r.json().enviado, true)
  const m = enviados.at(-1)
  assert.equal(m.to, 'nuevo@t.com')
  assert.match(m.text, /https:\/\/web\.test\/registro\?correo=nuevo%40t\.com/)
  assert.match(m.text, /Auxiliar de nómina/)

  const B = tok(`ub${RUN}`, 'nuevo@t.com')
  const mis = (await call('GET', '/api/empresas', B)).json()
  assert.equal(mis.length, 1)
  assert.equal(mis[0].id, id)
  assert.equal(mis[0].rol, 'auxiliar')

  // un auxiliar no gestiona el equipo
  assert.equal((await call('GET', `/api/empresas/${id}/equipo`, B)).statusCode, 403)
  assert.equal((await call('POST', `/api/empresas/${id}/equipo/invitaciones`, B, { email: 'x@t.com', rol: 'admin' })).statusCode, 403)

  const eq = (await call('GET', `/api/empresas/${id}/equipo`, A)).json()
  assert.equal(eq.miembros.length, 2)
  assert.equal(eq.invitaciones.length, 0)
})

test('rechaza correo o rol inválidos, duplicados y miembros que ya están', async () => {
  const { id, A } = await empresaConAdmin('2')
  assert.equal((await call('POST', `/api/empresas/${id}/equipo/invitaciones`, A, { email: 'malo', rol: 'auxiliar' })).statusCode, 400)
  assert.equal((await call('POST', `/api/empresas/${id}/equipo/invitaciones`, A, { email: 'a@t.com', rol: 'dios' })).statusCode, 400)
  assert.equal((await call('POST', `/api/empresas/${id}/equipo/invitaciones`, A, { email: 'a@t.com', rol: 'analista' })).statusCode, 201)
  assert.equal((await call('POST', `/api/empresas/${id}/equipo/invitaciones`, A, { email: 'a@t.com', rol: 'analista' })).statusCode, 409)
  const yo = (await call('GET', `/api/empresas/${id}/equipo`, A)).json().miembros[0].email
  assert.equal((await call('POST', `/api/empresas/${id}/equipo/invitaciones`, A, { email: yo, rol: 'analista' })).statusCode, 409)
})

test('revocar una invitación impide entrar; reenviar manda otro correo', async () => {
  const { id, A } = await empresaConAdmin('3')
  const inv = (await call('POST', `/api/empresas/${id}/equipo/invitaciones`, A, { email: 'rev@t.com', rol: 'auxiliar' })).json()
  const antes = enviados.length
  assert.equal((await call('POST', `/api/empresas/${id}/equipo/invitaciones/${inv.id}/reenviar`, A)).statusCode, 200)
  assert.equal(enviados.length, antes + 1)
  assert.equal((await call('POST', `/api/empresas/${id}/equipo/invitaciones/${inv.id}/revocar`, A)).statusCode, 200)
  const mis = (await call('GET', '/api/empresas', tok(`rev${RUN}`, 'rev@t.com'))).json()
  assert.equal(mis.length, 0)
})

test('cambiar rol, quitar, y no dejar la empresa sin administrador', async () => {
  const { id, A } = await empresaConAdmin('4')
  await call('POST', `/api/empresas/${id}/equipo/invitaciones`, A, { email: 'cam@t.com', rol: 'auxiliar' })
  const B = tok(`cam${RUN}`, 'cam@t.com')
  await call('GET', '/api/empresas', B)

  const ch = await call('PUT', `/api/empresas/${id}/equipo/miembros/cam${RUN}`, A, { rol: 'analista' })
  assert.equal(ch.statusCode, 200)
  assert.equal((await call('GET', '/api/empresas', B)).json()[0].rol, 'analista')

  // el administrador no se cambia ni se quita a sí mismo, y es el único
  const yo = `ua4${RUN}`
  assert.equal((await call('PUT', `/api/empresas/${id}/equipo/miembros/${yo}`, A, { rol: 'auxiliar' })).statusCode, 409)
  assert.equal((await call('GET', `/api/empresas/${id}/equipo`, A)).statusCode, 200)   // sigue siendo administrador
  assert.equal((await call('DELETE', `/api/empresas/${id}/equipo/miembros/${yo}`, A)).statusCode, 409)

  { const d = await call('DELETE', `/api/empresas/${id}/equipo/miembros/cam${RUN}`, A); assert.equal(d.statusCode, 200, d.body) }
  assert.equal((await call('GET', '/api/empresas', B)).json().length, 0)
  assert.equal((await call('DELETE', `/api/empresas/${id}/equipo/miembros/cam${RUN}`, A)).statusCode, 404)
})

test('un administrador no toca el equipo de otra empresa', async () => {
  const e1 = await empresaConAdmin('5')
  const e2 = await empresaConAdmin('6')
  assert.equal((await call('GET', `/api/empresas/${e1.id}/equipo`, e2.A)).statusCode, 403)
  assert.equal((await call('POST', `/api/empresas/${e1.id}/equipo/invitaciones`, e2.A, { email: 'z@t.com', rol: 'admin' })).statusCode, 403)
  assert.equal((await call('DELETE', `/api/empresas/${e1.id}/equipo/miembros/ua5${RUN}`, e2.A)).statusCode, 403)
  assert.equal((await call('GET', `/api/empresas/${e1.id}/equipo`, tok(`nadie${RUN}`))).statusCode, 403)
  assert.equal((await call('GET', `/api/empresas/${e1.id}/equipo`, {})).statusCode, 401)
})

test('límite de invitaciones por hora y registro en el historial del super admin', async () => {
  const { id, A } = await empresaConAdmin('7')
  const cods = []
  for (let i = 0; i < 7; i++) cods.push((await call('POST', `/api/empresas/${id}/equipo/invitaciones`, A, { email: `l${i}@t.com`, rol: 'auxiliar' })).statusCode)
  assert.deepEqual(cods, [201, 201, 201, 201, 201, 429, 429])
  const log = (await call('GET', '/api/admin/accesos', S)).json()
  const acciones = JSON.stringify(log)
  assert.match(acciones, /INVITAR l0@t\.com/)
})
