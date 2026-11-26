// Qué VE cada rol: el servidor entrega a cada uno solo lo suyo (no basta con ocultar menús en la web).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp, COLECCIONES } from '../src/index.js'
import { pool } from '../src/db.js'
import { puedeLeer, leeCompleta, proyectarParaRol } from '../src/lectura.js'

const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const RUN = `${Date.now()}${process.pid}`
const SUP = `superl${RUN}@cielo.test`
const tok = (uid, email) => ({ authorization: `Bearer ${uid}:${email}` })
const S = tok(`sal${RUN}`, SUP)
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false, superadmins: [SUP],
  limites: { general: 10_000, escritura: 10_000, empresas: 100, correos: 5 } })
const call = (method, url, headers, payload) => app.inject({ method, url, headers, payload })
test.after(async () => { await app.close(); await pool.end() })
const rnc = () => String(Math.floor(100000000 + Math.random() * 899999999))

const AUX_VE = ['empresa', 'empleados', 'feriados', 'horas-extras', 'licencias', 'disfrutes-vacaciones', 'prestamos', 'agenda-custom', 'agenda-done']

test('matriz de lectura: admin y analista todo; auxiliar solo captura', () => {
  for (const c of COLECCIONES) {
    assert.equal(puedeLeer('admin', c), true); assert.equal(puedeLeer('analista', c), true)
    assert.equal(puedeLeer('auxiliar', c), AUX_VE.includes(c), `auxiliar ${c}`)
    assert.equal(puedeLeer('desconocido', c), false)
  }
  for (const c of ['periodos', 'liquidaciones', 'aumentos', 'saldo-isr', 'retribuciones-complementarias', 'bandas-salariales', 'conceptos-personalizados'])
    assert.equal(puedeLeer('auxiliar', c), false, c)
  assert.equal(leeCompleta('auxiliar', 'empleados'), false)
  assert.equal(leeCompleta('analista', 'empleados'), true)
})

test('el empleado que ve el auxiliar no trae salario, cédula, banco ni nada fuera de la lista', () => {
  const e = { id: 'a', nombre: 'Ana', apellido: 'P', cargo: 'Cajera', departamento: 'Ventas', fechaIngreso: '2020-01-01',
    tipoContrato: 'fijo', activo: true, salarioBase: 95000, cedula: '00112345678', banco: 'Banco Popular', numeroCuenta: '123456789',
    email: 'a@x.com', telefono: '809', fechaNacimiento: '1990-01-01', fotoPerfil: 'data:...', contratoLaboral: 'AAA',
    saldoISRSecreto: 5, grossingUpPct: 50, dependientes: [{ nombre: 'x' }] }
  const [p] = proyectarParaRol('auxiliar', 'empleados', [e, null])
  assert.equal(p.salarioBase, 0); assert.equal(p.cedula, '')
  assert.equal(p.nombre, 'Ana'); assert.equal(p.departamento, 'Ventas')
  for (const k of ['banco', 'numeroCuenta', 'email', 'telefono', 'fechaNacimiento', 'fotoPerfil', 'contratoLaboral', 'grossingUpPct', 'dependientes', 'saldoISRSecreto'])
    assert.equal(k in p, false, `no debe traer ${k}`)
  assert.equal(JSON.stringify(p).includes('95000'), false)
  assert.equal(JSON.stringify(p).includes('00112345678'), false)
  assert.equal(proyectarParaRol('analista', 'empleados', [e])[0].salarioBase, 95000)
})

test('por la API: el auxiliar no recibe períodos, liquidaciones ni salarios; el analista sí todo', async () => {
  const e = (await call('POST', '/api/admin/empresas', S, { nombre: 'Lectura', rnc: rnc() })).json()
  const u = {}
  for (const rol of ['analista', 'auxiliar']) {
    const correo = `${rol}${RUN}@t.com`
    u[rol] = tok(`u${rol}${RUN}`, correo)
    await call('POST', `/api/admin/empresas/${e.id}/invitaciones`, S, { email: correo, rol })
    await call('GET', '/api/empresas', u[rol])
  }
  const sembrar = async (col, datos) => assert.equal((await call('PUT', `/api/empresas/${e.id}/documentos/${col}`, S, { datos, version: 0 })).statusCode, 200)
  await sembrar('empleados', [{ id: '1', nombre: 'Luis', apellido: 'R', cargo: 'Jefe', departamento: 'TI', fechaIngreso: '2020-01-01', tipoContrato: 'fijo', activo: true, salarioBase: 123456, cedula: '40212345678', banco: 'BHD León' }])
  await sembrar('periodos', [{ id: 'p', estado: 'cerrada', totales: { bruto: 999999 } }])
  await sembrar('liquidaciones', [{ id: 'l', total: 777777 }])
  await sembrar('licencias', [{ id: 'x' }])
  const aux = (await call('GET', `/api/empresas/${e.id}/documentos`, u.auxiliar)).json()
  const ana = (await call('GET', `/api/empresas/${e.id}/documentos`, u.analista)).json()
  for (const c of ['periodos', 'liquidaciones']) { assert.equal(c in aux, false, `auxiliar no debe recibir ${c}`); assert.equal(c in ana, true, `analista sí recibe ${c}`) }
  assert.ok(aux.licencias, 'el auxiliar sí ve licencias')
  const texto = JSON.stringify(aux)
  for (const secreto of ['123456', '40212345678', 'BHD', '999999', '777777']) assert.equal(texto.includes(secreto), false, `el auxiliar recibió ${secreto}`)
  assert.equal(aux.empleados.datos[0].nombre, 'Luis')
  assert.equal(JSON.stringify(ana).includes('123456'), true)
  // Historial: el auxiliar no lo lee de colecciones que no ve ni de empleados (traería el sueldo completo)
  for (const c of ['periodos', 'empleados', 'liquidaciones']) {
    assert.equal((await call('GET', `/api/empresas/${e.id}/documentos/${c}/historial`, u.auxiliar)).statusCode, 403, c)
    assert.equal((await call('GET', `/api/empresas/${e.id}/documentos/${c}/historial/1`, u.auxiliar)).statusCode, 403, c)
  }
  assert.equal((await call('GET', `/api/empresas/${e.id}/documentos/licencias/historial`, u.auxiliar)).statusCode, 200)
  assert.equal((await call('GET', `/api/empresas/${e.id}/documentos/empleados/historial`, u.analista)).statusCode, 200)
})

// Pantallas por rol (la interfaz del cliente; el servidor ya recorta los datos).
import { puedeVerRuta, rutaInicio, veDatosDeNomina } from '../../src/lib/roles.ts'
test('pantallas visibles por rol', () => {
  const todas = ['/', '/empleados', '/nomina', '/nomina/envios', '/regalia-pascual', '/vacaciones', '/prestamos', '/horas-extras', '/licencias',
    '/bonificacion', '/retribuciones-complementarias', '/liquidacion', '/aumentos', '/bandas-salariales', '/reportes', '/configuracion', '/admin']
  for (const r of todas) assert.equal(puedeVerRuta('admin', r), true, `admin ${r}`)
  for (const r of todas) assert.equal(puedeVerRuta('analista', r), !['/configuracion', '/bandas-salariales', '/admin'].includes(r), `analista ${r}`)
  for (const r of todas) assert.equal(puedeVerRuta('auxiliar', r), ['/horas-extras', '/licencias', '/vacaciones', '/prestamos'].includes(r), `auxiliar ${r}`)
  assert.equal(puedeVerRuta('auxiliar', '/nomina/envios'), false)
  assert.equal(puedeVerRuta('auxiliar', '/licencias/'), true)
  for (const viejo of ['gerente', 'rrhh', 'contador']) assert.equal(puedeVerRuta(viejo, '/configuracion'), false, viejo)
  assert.equal(puedeVerRuta(null, '/configuracion'), true, 'sin API no hay roles')
  assert.equal(puedeVerRuta('desconocido', '/'), false)
  assert.equal(rutaInicio('auxiliar'), '/horas-extras'); assert.equal(rutaInicio('analista'), '/')
  assert.equal(veDatosDeNomina('auxiliar'), false); assert.equal(veDatosDeNomina('analista'), true); assert.equal(veDatosDeNomina(null), true)
})
