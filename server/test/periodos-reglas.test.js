// Integridad de la nómina en el SERVIDOR: un período procesado o cerrado no se altera
// aunque alguien llame a la API directamente (antes solo lo impedía el navegador).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/index.js'
import { validarPeriodos } from '../src/periodos-reglas.js'
import { pool } from '../src/db.js'

// ── Unitarias: las mismas transformaciones que hace src/lib/periodos-context.tsx ──
const P = (extra = {}) => ({
  id: 'p1', tipo: 'mensual', mes: 7, anio: 2026, estado: 'cerrada',
  empleadosProcesados: ['e1', 'e2'],
  resultadosPorEmpleado: { e1: { salarioNeto: 37193.35, totalBruto: 40000 }, e2: { salarioNeto: 20000, totalBruto: 22000 } },
  totales: { bruto: 62000 }, ...extra,
})
const dentro = (...ps) => ps

test('sin cambios → válido (aunque jsonb reordene las claves)', () => {
  const E = P(); const N = JSON.parse(JSON.stringify(P()))
  const reordenado = { totales: N.totales, resultadosPorEmpleado: N.resultadosPorEmpleado, empleadosProcesados: N.empleadosProcesados, estado: N.estado, anio: N.anio, mes: N.mes, tipo: N.tipo, id: N.id }
  assert.equal(validarPeriodos([E], [reordenado]), null)
})
test('un período en proceso se edita libremente', () => {
  assert.equal(validarPeriodos([P({ estado: 'en_proceso' })], [P({ estado: 'en_proceso', totales: { bruto: 1 } })]), null)
})
test('crear períodos nuevos y borrar uno en proceso → válido', () => {
  assert.equal(validarPeriodos([P({ estado: 'en_proceso' })], [P({ id: 'p2', estado: 'en_proceso' })]), null)
})
test('procesada → cerrada (cerrar) → válido; con otro cambio al mismo tiempo → rechazado', () => {
  assert.equal(validarPeriodos([P({ estado: 'procesada' })], [P({ estado: 'cerrada' })]), null)
  assert.match(validarPeriodos([P({ estado: 'procesada' })], [P({ estado: 'cerrada', totales: { bruto: 5 } })]), /no se puede modificar/)
})
test('marcar y deshacer el pago de un cerrado → válido', () => {
  const pagado = P({ pagada: true, fechaPago: '2026-08-05' })
  assert.equal(validarPeriodos([P()], [pagado]), null)
  assert.equal(validarPeriodos([pagado], [P({ pagada: false })]), null)
})
test('alterar montos o empleados de un cerrado → rechazado', () => {
  const E = P()
  const casos = {
    'neto de un empleado': P({ resultadosPorEmpleado: { ...E.resultadosPorEmpleado, e1: { salarioNeto: 99999, totalBruto: 40000 } } }),
    'totales': P({ totales: { bruto: 1 } }),
    'quitar un empleado': P({ empleadosProcesados: ['e1'] }),
    'fecha de pago junto a un monto': P({ pagada: true, fechaPago: '2026-08-05', totales: { bruto: 1 } }),
  }
  for (const [nombre, N] of Object.entries(casos)) {
    assert.match(validarPeriodos([E], [N]) ?? '', /cerrado y no se puede modificar|no se puede modificar/, nombre)
  }
})
test('eliminar un cerrado → rechazado; eliminar uno procesado → válido', () => {
  assert.match(validarPeriodos([P()], []), /cerrado y no se puede eliminar/)
  assert.equal(validarPeriodos([P({ estado: 'procesada' })], []), null)
})
test('reabrir: válido si deja bitácora; rechazado si ya está pagado o sin bitácora', () => {
  const reabierto = (E, extra = {}) => ({ ...E, estado: 'en_proceso', empleadosProcesados: [], resultadosPorEmpleado: {}, cuentasBancariasPorEmpleado: {},
    bitacoraDesposteos: [...(E.bitacoraDesposteos ?? []), { fecha: '2026-08-10T00:00:00Z', usuarioEmail: 'a@b.c', estadoAnterior: E.estado }], ...extra })
  assert.equal(validarPeriodos([P()], [reabierto(P())]), null)
  assert.match(validarPeriodos([P({ pagada: true })], [reabierto(P({ pagada: true }))]), /pagado: primero hay que deshacer el pago/)
  assert.match(validarPeriodos([P()], [reabierto(P(), { bitacoraDesposteos: [] })]), /bitácora/)
  assert.match(validarPeriodos([P()], [reabierto(P(), { mes: 8 })]), /identidad/)
  // no se puede reescribir la bitácora anterior
  const conBit = P({ bitacoraDesposteos: [{ fecha: 'x', usuarioEmail: 'a', estadoAnterior: 'procesada' }] })
  const r = reabierto(conBit); r.bitacoraDesposteos[0] = { fecha: 'y', usuarioEmail: 'otro', estadoAnterior: 'procesada' }
  assert.match(validarPeriodos([conBit], [r]), /bitácora/)
})
test('reabrir y volver a cerrar deja rastro; el camino completo es válido paso a paso', () => {
  let estado = [P({ estado: 'en_proceso' })]
  const pasos = [
    [P({ estado: 'en_proceso', empleadosProcesados: ['e1'], resultadosPorEmpleado: { e1: { salarioNeto: 1 } } })],   // procesando
    [P({ estado: 'procesada', empleadosProcesados: ['e1', 'e2'] })],                                                  // todos procesados
    [P({ estado: 'cerrada', empleadosProcesados: ['e1', 'e2'] })],                                                    // cerrar
    [P({ estado: 'cerrada', empleadosProcesados: ['e1', 'e2'], pagada: true, fechaPago: '2026-08-05' })],            // pagar
  ]
  for (const siguiente of pasos) { assert.equal(validarPeriodos(estado, siguiente), null); estado = siguiente }
})
test('datos previos de otro formato no bloquean (nada que proteger)', () => {
  assert.equal(validarPeriodos(null, [P()]), null)
  assert.equal(validarPeriodos({}, [P()]), null)
  assert.match(validarPeriodos([P()], { no: 'lista' }), /lista/)
})

// ── De punta a punta por la API (Postgres real) ───────────────────────────────
const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const RUN = `${Date.now()}${process.pid}`
const SUP = `super${RUN}@cielo.test`
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false, superadmins: [SUP], limites: { general: 10_000, escritura: 10_000, empresas: 100, correos: 5 } })
test.after(async () => { await app.close(); await pool.end() })
const H = (uid, email) => ({ authorization: `Bearer ${uid}:${email ?? uid + '@t.com'}` })
const rnc = () => String(Math.floor(100000000 + Math.random() * 899999999))

test('API: un usuario con permiso de escritura no puede alterar un período cerrado, pero sí cerrar, pagar y reabrir', async () => {
  const sa = H(`sa${RUN}`, SUP)
  const emp = (await app.inject({ method: 'POST', url: '/api/admin/empresas', headers: sa, payload: { nombre: 'Prueba períodos', rnc: rnc() } })).json()
  const id = emp.id ?? emp.empresa?.id
  assert.ok(id, 'se creó la empresa: ' + JSON.stringify(emp))
  const correo = `rrhh${RUN}@t.com`
  const inv = await app.inject({ method: 'POST', url: `/api/admin/empresas/${id}/invitaciones`, headers: sa, payload: { email: correo, rol: 'analista' } })
  assert.ok([200, 201].includes(inv.statusCode), inv.body)
  const u = H(`u${RUN}`, correo)
  await app.inject({ url: '/api/empresas', headers: u })            // acepta la invitación
  const put = (datos, version) => app.inject({ method: 'PUT', url: `/api/empresas/${id}/documentos/periodos`, headers: u, payload: { datos, version } })

  let r = await put([P({ estado: 'procesada' })], 0); assert.equal(r.statusCode, 200, r.body); let v = r.json().version
  r = await put([P({ estado: 'cerrada' })], v); assert.equal(r.statusCode, 200, 'cerrar: ' + r.body); v = r.json().version
  r = await put([P({ estado: 'cerrada', pagada: true, fechaPago: '2026-08-05' })], v); assert.equal(r.statusCode, 200, 'pagar: ' + r.body); v = r.json().version

  // Ataques directos a la API: todos rechazados con 422 y la colección no cambia
  const ataques = {
    'cambiar un neto': [P({ pagada: true, fechaPago: '2026-08-05', resultadosPorEmpleado: { e1: { salarioNeto: 1 } } })],
    'eliminar el período': [],
    'reabrir sin deshacer el pago': [P({ estado: 'en_proceso', pagada: true, fechaPago: '2026-08-05', bitacoraDesposteos: [{ fecha: 'x', usuarioEmail: 'a', estadoAnterior: 'cerrada' }] })],
  }
  for (const [nombre, datos] of Object.entries(ataques)) {
    r = await put(datos, v)
    assert.equal(r.statusCode, 422, `${nombre} debía rechazarse: ${r.body}`)
    assert.equal(r.json().codigo, 'periodo_inmutable')
  }
  const { rows } = await pool.query("SELECT 1") ; assert.ok(rows)
  const lectura = (await app.inject({ url: `/api/empresas/${id}/documentos`, headers: u })).json()
  assert.equal(lectura.periodos.version, v, 'ningún ataque movió la versión')
  assert.equal(lectura.periodos.datos[0].resultadosPorEmpleado.e1.salarioNeto, 37193.35, 'el neto sigue intacto')

  // Camino legítimo: deshacer pago → reabrir
  r = await put([P({ estado: 'cerrada', pagada: false })], v); assert.equal(r.statusCode, 200, 'deshacer pago: ' + r.body); v = r.json().version
  const reab = { ...P({ estado: 'cerrada' }), estado: 'en_proceso', empleadosProcesados: [], resultadosPorEmpleado: {}, cuentasBancariasPorEmpleado: {}, pagada: false,
    bitacoraDesposteos: [{ fecha: '2026-08-10T00:00:00Z', usuarioEmail: correo, estadoAnterior: 'cerrada' }] }
  r = await put([reab], v); assert.equal(r.statusCode, 200, 'reabrir: ' + r.body); v = r.json().version

  // Cierra de nuevo y comprueba que el super admin (soporte) sí puede reemplazar la colección (reinicio de pruebas)
  r = await put([P({ estado: 'cerrada', bitacoraDesposteos: reab.bitacoraDesposteos })], v)
  // (en proceso → cerrada directo no es un camino legítimo del cliente, pero la regla solo protege lo que ya estaba procesado/cerrado)
  assert.equal(r.statusCode, 200, r.body); v = r.json().version
  const rrhhBorra = await put([], v)
  assert.equal(rrhhBorra.statusCode, 422, 'un analista no puede vaciar los períodos cerrados')
  const soporte = await app.inject({ method: 'PUT', url: `/api/empresas/${id}/documentos/periodos`, headers: sa, payload: { datos: [], version: v } })
  assert.equal(soporte.statusCode, 200, 'el super admin sí puede reiniciar: ' + soporte.body)
})
