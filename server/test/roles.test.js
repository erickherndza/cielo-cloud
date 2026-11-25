// Matriz de roles: todos leen; cada rol escribe solo sus colecciones.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp, puedeEscribir } from '../src/index.js'
import { pool } from '../src/db.js'

const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const RUN = Date.now()
const SUP = `superr${RUN}@cielo.test`
const tok = (uid, email) => ({ authorization: `Bearer ${uid}:${email}` })
const S = tok(`sar${RUN}`, SUP)
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false, superadmins: [SUP],
  limites: { general: 10_000, escritura: 10_000, empresas: 100, correos: 5 } })
const call = (method, url, headers, payload) => app.inject({ method, url, headers, payload })
test.after(async () => { await app.close(); await pool.end() })

test('puedeEscribir: la matriz de roles', () => {
  assert.equal(puedeEscribir('admin', 'empresa'), true)
  assert.equal(puedeEscribir('gerente', 'empleados'), false)
  assert.equal(puedeEscribir('gerente', 'aumentos'), true)
  assert.equal(puedeEscribir('gerente', 'periodos'), true)
  assert.equal(puedeEscribir('rrhh', 'empleados'), true)
  assert.equal(puedeEscribir('rrhh', 'empresa'), false)
  assert.equal(puedeEscribir('rrhh', 'conceptos-personalizados'), false)
  assert.equal(puedeEscribir('contador', 'empleados'), false)
  assert.equal(puedeEscribir('contador', 'horas-extras'), true)
  assert.equal(puedeEscribir('contador', 'empresa'), false)
  assert.equal(puedeEscribir('desconocido', 'periodos'), false)
})

test('el servidor aplica la matriz y todos leen', async () => {
  const e = (await call('POST', '/api/admin/empresas', S, { nombre: 'Roles', rnc: String(Math.floor(100000000 + Math.random() * 899999999)) })).json()
  const usuarios = {}
  for (const rol of ['gerente', 'rrhh', 'contador']) {
    const correo = `${rol}${RUN}@t.com`
    usuarios[rol] = tok(`u${rol}${RUN}`, correo)
    await call('POST', `/api/admin/empresas/${e.id}/invitaciones`, S, { email: correo, rol })
    await call('GET', '/api/empresas', usuarios[rol])   // acepta la invitación
  }
  const put = (rol, col) => call('PUT', `/api/empresas/${e.id}/documentos/${col}`, usuarios[rol], { datos: [], version: 0 })
  assert.equal((await put('gerente', 'empleados')).statusCode, 403)
  assert.equal((await put('gerente', 'empresa')).statusCode, 403)
  assert.equal((await put('gerente', 'aumentos')).statusCode, 200)
  assert.equal((await put('contador', 'empleados')).statusCode, 403)
  assert.equal((await put('contador', 'horas-extras')).statusCode, 200)
  assert.equal((await put('rrhh', 'empresa')).statusCode, 403)
  assert.equal((await put('rrhh', 'empleados')).statusCode, 200)
  for (const rol of Object.keys(usuarios))
    assert.equal((await call('GET', `/api/empresas/${e.id}/documentos`, usuarios[rol])).statusCode, 200)
  // el gerente no envía comprobantes
  assert.equal((await call('POST', `/api/empresas/${e.id}/comprobantes/enviar`, usuarios.gerente, { items: [] })).statusCode, 403)
})
