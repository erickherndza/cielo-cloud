// Parámetros legales globales: lectura para cualquier sesión, escritura solo
// del super admin, validación estricta, versionado y RLS.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/index.js'
import { validarParametros } from '../src/parametros.js'
import { pool, conContexto } from '../src/db.js'

const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const RUN = `${Date.now()}${process.pid}`
const SUP = `superp${RUN}@cielo.test`
const tok = (uid, email) => ({ authorization: `Bearer ${uid}:${email ?? uid + '@t.com'}` })
const S = tok(`sp${RUN}`, SUP)
const U = tok(`up${RUN}`)
const app = buildApp({
  projectId: 'x', origins: [], verify, logger: false, superadmins: [SUP],
  limites: { general: 10_000, escritura: 10_000, empresas: 100, correos: 5 },
})
const call = (method, url, headers, payload) => app.inject({ method, url, headers, payload })
test.after(async () => { await app.close(); await pool.end() })

const buenos = () => ({
  vacaciones: { diasHasta5: 14, diasMas5: 18, umbralAnios: 5 },
  divisor: { ordinario: 23.83, intermitente: 26 },
  cesantia: { d3a6m: 6, d6a12m: 13, diasAnio1a5: 21, diasAnio5mas: 23 },
  preaviso: { d3a6m: 7, d6a12m: 14, d12mas: 28 },
  asistencia: { d3a6m: 5, d6a12m: 10, diasPorAnio: 15 },
  motivos: {
    renuncia: { cesantia: false, preaviso: false, asistencia: false },
    despido_sin_causa: { cesantia: true, preaviso: true, asistencia: false },
    despido_con_causa: { cesantia: false, preaviso: false, asistencia: false },
    mutuo_acuerdo: { cesantia: true, preaviso: true, asistencia: false },
    vencimiento_contrato: { cesantia: false, preaviso: false, asistencia: true },
  },
})

test('validación: acepta lo completo y rechaza claves o rangos fuera de la lista', () => {
  assert.equal(validarParametros(buenos()).ok, true)
  const sobra = buenos(); sobra.extra = 1
  assert.equal(validarParametros(sobra).ok, false)
  const falta = buenos(); delete falta.cesantia.d3a6m
  assert.equal(validarParametros(falta).ok, false)
  const rango = buenos(); rango.divisor.ordinario = 5
  assert.equal(validarParametros(rango).ok, false)
  const texto = buenos(); texto.preaviso.d12mas = '28'
  assert.equal(validarParametros(texto).ok, false)
  const nan = buenos(); nan.preaviso.d12mas = NaN
  assert.equal(validarParametros(nan).ok, false)
  const motivo = buenos(); motivo.motivos.renuncia.cesantia = 'si'
  assert.equal(validarParametros(motivo).ok, false)
  const proto = JSON.parse('{"__proto__":{"x":1}}')
  assert.equal(validarParametros(proto).ok, false)
  assert.equal(validarParametros(null).ok, false)
  assert.equal(validarParametros([]).ok, false)
})

test('sin sesión no se leen; un usuario normal lee pero no escribe (404)', async () => {
  assert.equal((await call('GET', '/api/parametros-legales')).statusCode, 401)
  const r = await call('GET', '/api/parametros-legales', U)
  assert.equal(r.statusCode, 200)
  assert.ok('version' in r.json())
  assert.equal((await call('PUT', '/api/admin/parametros-legales', U, { datos: buenos(), motivo: 'prueba de usuario' })).statusCode, 404)
  assert.equal((await call('GET', '/api/admin/parametros-legales/historial', U)).statusCode, 404)
})

test('el super admin guarda versiones; motivo obligatorio; datos inválidos 400', async () => {
  const sinMotivo = await call('PUT', '/api/admin/parametros-legales', S, { datos: buenos(), motivo: ' ' })
  assert.equal(sinMotivo.statusCode, 400)
  const malo = buenos(); malo.cesantia.diasAnio5mas = 999
  assert.equal((await call('PUT', '/api/admin/parametros-legales', S, { datos: malo, motivo: 'rango fuera' })).statusCode, 400)

  const antes = (await call('GET', '/api/parametros-legales', U)).json().version
  const d = buenos(); d.cesantia.diasAnio5mas = 25
  const r1 = await call('PUT', '/api/admin/parametros-legales', S, { datos: d, motivo: 'Ajuste de prueba por el abogado' })
  assert.equal(r1.statusCode, 201)
  assert.equal(r1.json().version, antes + 1)
  assert.equal(r1.json().email, SUP)

  // un usuario normal ve ya la versión nueva
  const lee = (await call('GET', '/api/parametros-legales', U)).json()
  assert.equal(lee.version, antes + 1)
  assert.equal(lee.datos.cesantia.diasAnio5mas, 25)

  // se restaura el valor de ley y queda otra versión; el historial conserva ambas
  const r2 = await call('PUT', '/api/admin/parametros-legales', S, { datos: buenos(), motivo: 'Se restaura el valor del Art. 80' })
  assert.equal(r2.json().version, antes + 2)
  const h = (await call('GET', '/api/admin/parametros-legales/historial', S)).json()
  assert.equal(h[0].version, antes + 2)
  assert.equal(h[1].datos.cesantia.diasAnio5mas, 25)
})

test('RLS: sin ser super admin no se inserta ni siquiera con la conexión de la API', async () => {
  await assert.rejects(conContexto({ uid: `x${RUN}`, email: 'x@t.com', superadmin: false }, (c) => c.query(
    `INSERT INTO parametros_legales (version, datos, motivo, uid) VALUES (999999, '{}', 'intento no autorizado', 'x')`)))
  // y la tabla no admite UPDATE ni DELETE para la aplicación
  await assert.rejects(conContexto({ uid: `x${RUN}`, email: 'x@t.com', superadmin: true }, (c) => c.query(
    `UPDATE parametros_legales SET motivo = 'reescrito por la app'`)))
  await assert.rejects(conContexto({ uid: `x${RUN}`, email: 'x@t.com', superadmin: true }, (c) => c.query(
    `DELETE FROM parametros_legales`)))
})
