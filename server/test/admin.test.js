import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/index.js'
import { pool } from '../src/db.js'

const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const SUP = `super${Date.now()}@cielo.test`
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false, superadmins: [SUP], autoregistro: false,
  limites: { general: 10_000, escritura: 10_000, empresas: 5, correos: 600 } })
const tok = (uid, email) => ({ authorization: `Bearer ${uid}:${email ?? uid + '@t.com'}` })
const RUN = `${Date.now()}${process.pid}`
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
  assert.equal((await call('POST', `/api/admin/empresas/${id}/invitaciones`, S, { email: mail.toUpperCase(), rol: 'analista' })).statusCode, 201)
  assert.equal((await call('POST', `/api/admin/empresas/${id}/invitaciones`, S, { email: mail, rol: 'analista' })).statusCode, 409)
  assert.equal((await call('POST', `/api/admin/empresas/${id}/invitaciones`, S, { email: mail, rol: 'dios' })).statusCode, 400)

  // Antes de entrar no tiene acceso; al listar sus empresas se acepta la invitación.
  const U = tok('c1'+RUN, mail)
  assert.equal((await call('GET', `/api/empresas/${id}/documentos`, U)).statusCode, 403)
  const lista = (await call('GET', '/api/empresas', U)).json()
  assert.deepEqual(lista.map(e => [e.id, e.rol]), [[id, 'analista']])
  assert.equal((await call('GET', `/api/empresas/${id}/documentos`, U)).statusCode, 200)
  const inv = (await call('GET', `/api/admin/empresas/${id}/invitaciones`, S)).json()
  assert.equal(inv.invitaciones[0].estado, 'aceptada'); assert.equal(inv.miembros.length, 1)
})

test('un contador con varias empresas las ve todas; otro usuario no ve ninguna', async () => {
  const mail = `multi${Date.now()}@t.com`
  const ids = []
  for (const nombre of ['M1', 'M2']) {
    const id = (await call('POST', '/api/admin/empresas', S, { nombre, rnc: rnc() })).json().id
    await call('POST', `/api/admin/empresas/${id}/invitaciones`, S, { email: mail, rol: 'analista' })
    ids.push(id)
  }
  assert.deepEqual((await call('GET', '/api/empresas', tok('c2'+RUN, mail))).json().map(e => e.id).sort(), ids.sort())
  assert.deepEqual((await call('GET', '/api/empresas', tok('x9'+RUN))).json(), [])
})

test('revocar invitación impide la entrada', async () => {
  const id = (await call('POST', '/api/admin/empresas', S, { nombre: 'Rev', rnc: rnc() })).json().id
  const mail = `rev${Date.now()}@t.com`
  const inv = (await call('POST', `/api/admin/empresas/${id}/invitaciones`, S, { email: mail, rol: 'auxiliar' })).json()
  assert.equal((await call('POST', `/api/admin/empresas/${id}/invitaciones/${inv.id}/revocar`, S)).statusCode, 200)
  assert.deepEqual((await call('GET', '/api/empresas', tok('r1'+RUN, mail))).json(), [])
})

test('suspender bloquea a los usuarios de la empresa, no al super admin; reactivar restaura', async () => {
  const id = (await call('POST', '/api/admin/empresas', S, { nombre: 'Sus', rnc: rnc() })).json().id
  const mail = `sus${Date.now()}@t.com`
  await call('POST', `/api/admin/empresas/${id}/invitaciones`, S, { email: mail, rol: 'admin' })
  const U = tok('s1'+RUN, mail)
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

test('consola: resumen y usuarios solo para el super admin, sin datos de empleados', async () => {
  assert.equal((await call('GET', '/api/admin/resumen', tok('u1'))).statusCode, 404)
  assert.equal((await call('GET', '/api/admin/usuarios', tok('u1'))).statusCode, 404)
  const r = await call('GET', '/api/admin/resumen', S)
  assert.equal(r.statusCode, 200)
  const j = r.json()
  assert.ok(j.empresas.total >= 1)
  assert.ok(Array.isArray(j.altasPorMes))
  assert.equal(typeof j.usuarios, 'number')
  const u = await call('GET', '/api/admin/usuarios', S)
  assert.equal(u.statusCode, 200); assert.ok(Array.isArray(u.json()))
  const l = (await call('GET', '/api/admin/empresas', S)).json()
  assert.ok('contacto' in l[0] && 'empleados' in l[0] && 'ultima_actividad' in l[0])
})

test('cobros: solo super admin; plan, pago que corre la renovación y anulación', async () => {
  const id = (await call('POST', '/api/admin/empresas', S, { nombre: 'Cobra', rnc: rnc() })).json().id
  const U = tok('cob1' + RUN)
  assert.equal((await call('GET', '/api/admin/cobros', U)).statusCode, 404)
  assert.equal((await call('PUT', `/api/admin/empresas/${id}/suscripcion`, U, { monto: 1, ciclo: 'mensual' })).statusCode, 404)

  const mala = await call('PUT', `/api/admin/empresas/${id}/suscripcion`, S, { monto: -5, ciclo: 'mensual' })
  assert.equal(mala.statusCode, 400)
  assert.equal((await call('PUT', `/api/admin/empresas/${id}/suscripcion`, S, { monto: 5, ciclo: 'semanal' })).statusCode, 400)
  const ok = await call('PUT', `/api/admin/empresas/${id}/suscripcion`, S, { plan: 'B', monto: 1700, ciclo: 'mensual', fecha_renovacion: '2020-01-31' })
  assert.equal(ok.statusCode, 200)

  let fila = (await call('GET', '/api/admin/cobros', S)).json().empresas.find(e => e.id === id)
  assert.equal(fila.estado_cobro, 'vencido'); assert.equal(fila.monto, 1700)

  assert.equal((await call('POST', `/api/admin/empresas/${id}/pagos`, S, { monto: 0, fecha_pago: '2020-02-01' })).statusCode, 400)
  assert.equal((await call('POST', `/api/admin/empresas/${id}/pagos`, S, { monto: 10, fecha_pago: 'ayer' })).statusCode, 400)
  const p = await call('POST', `/api/admin/empresas/${id}/pagos`, S, { monto: 1700, fecha_pago: '2020-02-01', metodo: 'transferencia', referencia: 'T-1' })
  assert.equal(p.statusCode, 201); assert.equal(p.json().renovacion, '2020-02-29')   // enero 31 + 1 mes

  const pagos = (await call('GET', `/api/admin/empresas/${id}/pagos`, S)).json()
  assert.equal(pagos.length, 1); assert.equal(pagos[0].monto, 1700); assert.equal(pagos[0].fecha_pago, '2020-02-01')
  assert.equal((await call('POST', `/api/admin/pagos/${pagos[0].id}/anular`, S)).statusCode, 200)
  assert.equal((await call('POST', `/api/admin/pagos/${pagos[0].id}/anular`, S)).statusCode, 404)
  const c = (await call('GET', '/api/admin/cobros', S)).json()
  assert.equal(typeof c.mrr, 'number'); assert.ok(Array.isArray(c.cobradoPorMes))
})

test('errores: cualquiera reporta, solo el super admin los ve y los marca', async () => {
  const U = tok('err1' + RUN)
  const msg = `Fallo de prueba ${RUN}`
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/api/errores', U, { mensaje: msg, ruta: '/nomina', detalle: 'stack' })).statusCode, 204)
  assert.equal((await call('GET', '/api/admin/errores', U)).statusCode, 404)
  const lista = (await call('GET', '/api/admin/errores', S)).json()
  const e = lista.find(x => x.mensaje === msg)
  assert.ok(e); assert.equal(e.veces, 3); assert.equal(e.origen, 'web')
  assert.equal((await call('POST', `/api/admin/errores/${e.huella}/resolver`, U, {})).statusCode, 404)
  assert.equal((await call('POST', `/api/admin/errores/${e.huella}/resolver`, S, {})).statusCode, 200)
  assert.ok(!(await call('GET', '/api/admin/errores', S)).json().some(x => x.mensaje === msg))
  assert.ok((await call('GET', '/api/admin/errores?resueltos=1', S)).json().some(x => x.mensaje === msg))
})

test('consola: los conteos de empleados, períodos y actividad reflejan los datos reales', async () => {
  const id = (await call('POST', '/api/admin/empresas', S, { nombre: 'Conteos', rnc: String(Math.floor(100000000 + Math.random() * 899999999)) })).json().id
  await call('PUT', `/api/empresas/${id}/documentos/empleados`, S, { datos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], version: 0 })
  await call('PUT', `/api/empresas/${id}/documentos/periodos`, S, { datos: [{ id: 'p' }], version: 0 })
  const fila = (await call('GET', '/api/admin/empresas', S)).json().find(e => e.id === id)
  assert.equal(fila.empleados, 3)
  assert.equal(fila.periodos, 1)
  assert.ok(fila.ultima_actividad)
  assert.ok((await call('GET', '/api/admin/resumen', S)).json().empleados >= 3)
  // lo que devuelve la consola nunca incluye el contenido de los documentos
  assert.ok(!JSON.stringify(fila).includes('"id":"a"'))
})
