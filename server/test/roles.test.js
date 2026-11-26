// Matriz de roles: todos leen; cada rol escribe solo sus colecciones.
//  - admin    «Gerente de nómina / administrador»: todo.
//  - analista «Analista de nómina y recursos humanos»: todo menos configuración, catálogos y usuarios.
//  - auxiliar «Auxiliar de nómina / recursos humanos»: solo captura (horas extras, licencias, vacaciones, préstamos).
// Los roles anteriores (gerente, rrhh, contador) se tratan como «analista».
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp, puedeEscribir, normalizarRol, PERMISOS_ESCRITURA, COLECCIONES } from '../src/index.js'
import { pool, conContexto } from '../src/db.js'
import { puedeEscribirColeccion, normalizarRol as normalizarRolCliente, ETIQUETA_ROL } from '../../src/lib/roles.ts'

const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const RUN = `${Date.now()}${process.pid}`
const SUP = `superr${RUN}@cielo.test`
const tok = (uid, email) => ({ authorization: `Bearer ${uid}:${email}` })
const S = tok(`sar${RUN}`, SUP)
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false, superadmins: [SUP],
  limites: { general: 10_000, escritura: 10_000, empresas: 100, correos: 5 } })
const call = (method, url, headers, payload) => app.inject({ method, url, headers, payload })
test.after(async () => { await app.close(); await pool.end() })
const rnc = () => String(Math.floor(100000000 + Math.random() * 899999999))

const CONFIGURACION = ['empresa', 'conceptos-personalizados', 'bandas-salariales', 'feriados']
const CAPTURA = ['horas-extras', 'licencias', 'disfrutes-vacaciones', 'prestamos']

test('puedeEscribir: la matriz de roles (cada colección, cada rol)', () => {
  for (const c of COLECCIONES) assert.equal(puedeEscribir('admin', c), true, `admin escribe ${c}`)
  for (const c of COLECCIONES) {
    const esperado = !CONFIGURACION.includes(c)
    assert.equal(puedeEscribir('analista', c), esperado, `analista ${esperado ? 'escribe' : 'NO escribe'} ${c}`)
  }
  // Analista: lo operativo de nómina y RR. HH.
  for (const c of ['empleados', 'periodos', 'aumentos', 'liquidaciones', 'saldo-isr', 'retribuciones-complementarias', ...CAPTURA]) assert.equal(puedeEscribir('analista', c), true, c)
  // Auxiliar: solo captura (+ su agenda)
  for (const c of [...CAPTURA, 'agenda-custom', 'agenda-done']) assert.equal(puedeEscribir('auxiliar', c), true, c)
  for (const c of ['empleados', 'periodos', 'aumentos', 'liquidaciones', 'saldo-isr', 'retribuciones-complementarias', ...CONFIGURACION]) assert.equal(puedeEscribir('auxiliar', c), false, `auxiliar NO escribe ${c}`)
  assert.equal(puedeEscribir('desconocido', 'periodos'), false)
  assert.equal(puedeEscribir(undefined, 'periodos'), false)
})

test('los roles anteriores son alias del analista', () => {
  for (const viejo of ['gerente', 'rrhh', 'contador']) {
    assert.equal(normalizarRol(viejo), 'analista')
    for (const c of COLECCIONES) assert.equal(puedeEscribir(viejo, c), puedeEscribir('analista', c), `${viejo} → ${c}`)
  }
  assert.equal(normalizarRol('admin'), 'admin'); assert.equal(normalizarRol('auxiliar'), 'auxiliar')
  assert.deepEqual(Object.keys(PERMISOS_ESCRITURA).sort(), ['admin', 'analista', 'auxiliar'])
})

test('el servidor aplica la matriz, todos leen y solo admin/analista envían comprobantes', async () => {
  const e = (await call('POST', '/api/admin/empresas', S, { nombre: 'Roles', rnc: rnc() })).json()
  const usuarios = {}
  for (const rol of ['analista', 'auxiliar']) {
    const correo = `${rol}${RUN}@t.com`
    usuarios[rol] = tok(`u${rol}${RUN}`, correo)
    const inv = await call('POST', `/api/admin/empresas/${e.id}/invitaciones`, S, { email: correo, rol })
    assert.ok([200, 201].includes(inv.statusCode), inv.body)
    assert.equal(inv.json().rol, rol)
    const mis = await call('GET', '/api/empresas', usuarios[rol])   // acepta la invitación
    assert.equal(mis.json()[0].rol, rol)
  }
  const put = async (rol, col) => {
    const doc = (await call('GET', `/api/empresas/${e.id}/documentos`, usuarios[rol])).json()[col]   // versión vigente: otro rol pudo escribirla antes
    return call('PUT', `/api/empresas/${e.id}/documentos/${col}`, usuarios[rol], { datos: [], version: doc?.version ?? 0 })
  }
  // Analista
  for (const c of ['empleados', 'periodos', 'aumentos', 'liquidaciones', 'horas-extras']) assert.equal((await put('analista', c)).statusCode, 200, `analista ${c}`)
  for (const c of CONFIGURACION) assert.equal((await put('analista', c)).statusCode, 403, `analista ${c}`)
  // Auxiliar
  for (const c of CAPTURA) assert.equal((await put('auxiliar', c)).statusCode, 200, `auxiliar ${c}`)
  for (const c of ['empleados', 'periodos', 'aumentos', 'liquidaciones', 'saldo-isr', ...CONFIGURACION]) assert.equal((await put('auxiliar', c)).statusCode, 403, `auxiliar ${c}`)
  // Todos leen todo
  for (const rol of Object.keys(usuarios)) assert.equal((await call('GET', `/api/empresas/${e.id}/documentos`, usuarios[rol])).statusCode, 200)
  // Comprobantes por correo: el auxiliar no; el analista pasa el control de rol (después puede fallar por otra razón)
  assert.equal((await call('POST', `/api/empresas/${e.id}/comprobantes/enviar`, usuarios.auxiliar, { items: [] })).statusCode, 403)
  assert.notEqual((await call('POST', `/api/empresas/${e.id}/comprobantes/enviar`, usuarios.analista, { items: [] })).statusCode, 403)
})

test('el auxiliar no puede cerrar, pagar ni reabrir un período aunque llame a la API directamente', async () => {
  const e = (await call('POST', '/api/admin/empresas', S, { nombre: 'Auxiliar períodos', rnc: rnc() })).json()
  const correo = `aux2${RUN}@t.com`, aux = tok(`uaux2${RUN}`, correo)
  await call('POST', `/api/admin/empresas/${e.id}/invitaciones`, S, { email: correo, rol: 'auxiliar' })
  await call('GET', '/api/empresas', aux)
  const periodo = { id: 'p1', tipo: 'mensual', mes: 7, anio: 2026, estado: 'procesada', empleadosProcesados: ['e1'] }
  await call('PUT', `/api/empresas/${e.id}/documentos/periodos`, S, { datos: [periodo], version: 0 })   // lo deja el super admin
  const lee = (await call('GET', `/api/empresas/${e.id}/documentos`, aux)).json().periodos
  for (const nuevo of [{ ...periodo, estado: 'cerrada' }, { ...periodo, estado: 'cerrada', pagada: true, fechaPago: '2026-08-05' }, { ...periodo, estado: 'en_proceso' }, { ...periodo, totales: { bruto: 1 } }]) {
    const r = await call('PUT', `/api/empresas/${e.id}/documentos/periodos`, aux, { datos: [nuevo], version: lee.version })
    assert.equal(r.statusCode, 403, 'el auxiliar no debe poder escribir períodos')
  }
  const despues = (await call('GET', `/api/empresas/${e.id}/documentos`, aux)).json().periodos
  assert.equal(despues.version, lee.version); assert.equal(despues.datos[0].estado, 'procesada')
})

test('quien ya estaba invitado con un rol anterior sigue funcionando como analista (sin migrar datos)', async () => {
  const e = (await call('POST', '/api/admin/empresas', S, { nombre: 'Rol anterior', rnc: rnc() })).json()
  for (const viejo of ['gerente', 'rrhh', 'contador']) {
    const correo = `${viejo}${RUN}@t.com`, u = tok(`u${viejo}${RUN}`, correo)
    // Invitación guardada con el rol ANTERIOR, como las que ya existen en producción
    await conContexto({ uid: 'sa', superadmin: true }, c => c.query(
      "INSERT INTO invitaciones (empresa_id, email, rol, creado_por) VALUES ($1, $2, $3, 'sa')", [e.id, correo, viejo]))
    const mis = await call('GET', '/api/empresas', u)
    assert.equal(mis.json()[0].rol, 'analista', `${viejo} debe verse como analista`)
    const guardado = await conContexto({ uid: 'sa', superadmin: true }, c => c.query('SELECT rol FROM miembros WHERE empresa_id = $1 AND email = $2', [e.id, correo]))
    assert.equal(guardado.rows[0].rol, viejo, 'la base no se toca: el alias se resuelve al leer')
    const v = (await call('GET', `/api/empresas/${e.id}/documentos`, u)).json().empleados?.version ?? 0
    assert.equal((await call('PUT', `/api/empresas/${e.id}/documentos/empleados`, u, { datos: [], version: v })).statusCode, 200, `${viejo} edita empleados como analista`)
    assert.equal((await call('PUT', `/api/empresas/${e.id}/documentos/empresa`, u, { datos: {}, version: 0 })).statusCode, 403, `${viejo} no edita la configuración`)
  }
  const lista = (await call('GET', `/api/admin/empresas/${e.id}/invitaciones`, S)).json()
  assert.ok(lista.miembros.every(m => m.rol === 'analista'), 'el panel de administración muestra el rol nuevo')
})

test('invitar o cambiar de rol: solo roles válidos; los anteriores se guardan como el nuevo', async () => {
  const e = (await call('POST', '/api/admin/empresas', S, { nombre: 'Validación roles', rnc: rnc() })).json()
  const inv = (rol) => call('POST', `/api/admin/empresas/${e.id}/invitaciones`, S, { email: `x${Math.random().toString(36).slice(2)}@t.com`, rol })
  for (const malo of ['superadmin', 'ADMIN', '', null, 5, { a: 1 }, ['admin']]) assert.equal((await inv(malo)).statusCode, 400, `rol ${JSON.stringify(malo)}`)
  assert.equal((await inv('contador')).json().rol, 'analista', 'un cliente desactualizado que invite «contador» crea un analista')
  assert.equal((await inv('rrhh')).json().rol, 'analista')
  // cambio de rol de un miembro existente
  const correo = `cambio${RUN}@t.com`, u = tok(`ucambio${RUN}`, correo)
  await call('POST', `/api/admin/empresas/${e.id}/invitaciones`, S, { email: correo, rol: 'auxiliar' })
  await call('GET', '/api/empresas', u)
  const c1 = await call('PUT', `/api/admin/empresas/${e.id}/miembros/ucambio${RUN}`, S, { rol: 'analista' })
  assert.equal(c1.statusCode, 200); assert.equal(c1.json().rol, 'analista')
  assert.equal((await call('PUT', `/api/admin/empresas/${e.id}/miembros/ucambio${RUN}`, S, { rol: 'dios' })).statusCode, 400)
  assert.equal((await call('PUT', `/api/empresas/${e.id}/documentos/empleados`, u, { datos: [], version: 0 })).statusCode, 200, 'tras ascender a analista ya puede editar empleados')
})

test('la matriz del navegador (src/lib/roles.ts) es IDÉNTICA a la del servidor para todo rol y colección', () => {
  for (const rol of ['admin', 'analista', 'auxiliar', 'gerente', 'rrhh', 'contador'])
    for (const c of COLECCIONES)
      assert.equal(puedeEscribirColeccion(rol, c), puedeEscribir(rol, c), `${rol} → ${c}: el navegador y el servidor no coinciden`)
  for (const r of ['gerente', 'rrhh', 'contador', 'analista', 'auxiliar', 'admin']) assert.equal(normalizarRolCliente(r), normalizarRol(r))
  assert.equal(puedeEscribirColeccion('inexistente', 'periodos'), false)
  for (const r of ['admin', 'analista', 'auxiliar']) assert.ok(ETIQUETA_ROL[r], `falta la etiqueta de ${r}`)
})
