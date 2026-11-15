// Pruebas de las correcciones de la auditoría del 2026-11-14 (A3, A4, A5, M1–M4).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/index.js'
import { pool, conContexto } from '../src/db.js'

const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const RUN = Date.now()
const SUP = `super${RUN}@cielo.test`
const tok = (uid, email) => ({ authorization: `Bearer ${uid}:${email ?? uid + '@t.com'}` })
const S = tok(`sa${RUN}`, SUP)
const rnc = () => String(Math.floor(100000000 + Math.random() * 899999999))
const enviados = []
const base = {
  projectId: 'x', origins: [], verify, logger: false, superadmins: [SUP],
  enviarCorreo: async (m) => { enviados.push(m) },
}
const apps = []
const crear = (extra = {}) => { const a = buildApp({ ...base, ...extra }); apps.push(a); return a }
const app = crear({ limites: { general: 10_000, escritura: 10_000, empresas: 100, correos: 5 } })
const call = (a, method, url, headers, payload) => a.inject({ method, url, headers, payload })

test.after(async () => { for (const a of apps) await a.close(); await pool.end() })

test('M1: el límite por IP se aplica y la IP sale de CF-Connecting-IP', async () => {
  const a = crear({ limiteIp: 5 })
  const cods = []
  for (let i = 0; i < 7; i++) cods.push((await a.inject({ url: '/api/yo', headers: { 'cf-connecting-ip': '203.0.113.9' } })).statusCode)
  assert.deepEqual(cods, [401, 401, 401, 401, 401, 429, 429])
  // falsear X-Forwarded-For no da un contador nuevo
  const r = await a.inject({ url: '/api/yo', headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' } })
  assert.equal(r.statusCode, 429)
  // otra IP real tiene su propio contador
  const otra = await a.inject({ url: '/api/yo', headers: { 'cf-connecting-ip': '203.0.113.10' } })
  assert.equal(otra.statusCode, 401)
  assert.equal(otra.headers['x-ratelimit-limit'], '5')
})

test('M2: /health reutiliza la comprobación de la base', async () => {
  const a = crear()
  const original = pool.query.bind(pool)
  let n = 0
  pool.query = (...args) => { n++; return original(...args) }
  try {
    for (let i = 0; i < 20; i++) assert.equal((await a.inject('/health')).statusCode, 200)
  } finally { pool.query = original }
  assert.equal(n, 1)
})

test('M3: el tope de empresas nuevas por hora no se salta con ?x=1', async () => {
  const a = crear({ limites: { general: 10_000, escritura: 10_000, empresas: 2, correos: 5 } })
  const u = tok(`m3${RUN}`)
  const cods = []
  for (let i = 0; i < 4; i++) cods.push((await call(a, 'POST', `/api/empresas?x=${i}`, u, { nombre: 'E' })).statusCode)
  assert.deepEqual(cods, [201, 201, 429, 429])
})

test('A5: una cuenta no crea más de 3 empresas propias', async () => {
  const u = tok(`a5e${RUN}`)
  const cods = []
  for (let i = 0; i < 4; i++) cods.push((await call(app, 'POST', '/api/empresas', u, { nombre: 'E' })).statusCode)
  assert.deepEqual(cods, [201, 201, 201, 409])
})

test('A3: el tope de correos cuenta comprobantes, no peticiones, en una hora fija', async () => {
  const u = tok(`a3${RUN}`)
  const emp = (await call(app, 'POST', '/api/empresas', u, { nombre: 'Correo' })).json().id
  const empleados = [null, 'x', ...[1, 2, 3, 4, 5, 6].map(i => ({ id: i, email: `e${i}@t.com` }))]   // con basura dentro
  assert.equal((await call(app, 'PUT', `/api/empresas/${emp}/documentos/empleados`, u, { datos: empleados, version: 0 })).statusCode, 200)
  const item = (id) => ({ empleadoId: id, asunto: 'a', cuerpo: 'c', pdfBase64: 'JVBERi0x' })
  const enviar = (ids) => call(app, 'POST', `/api/empresas/${emp}/comprobantes/enviar`, u, { items: ids.map(item) })
  enviados.length = 0
  let r = await enviar([1, 2, 3])
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().resultados.filter(x => x.ok).length, 3)
  // 3 + 3 > 5: se rechaza el lote entero y no se envía nada
  r = await enviar([4, 5, 6])
  assert.equal(r.statusCode, 429)
  assert.equal(enviados.length, 3)
  // todavía caben 2
  assert.equal((await enviar([4, 5])).statusCode, 200)
  assert.equal((await enviar([6])).statusCode, 429)
  assert.equal(enviados.length, 5)
})

test('A4: el super admin quita a un miembro y le cambia el rol; queda registrado', async () => {
  const e = (await call(app, 'POST', '/api/admin/empresas', S, { nombre: 'Miembros', rnc: rnc() })).json()
  const correo = `rrhh${RUN}@t.com`, uid = `a4${RUN}`
  const U = tok(uid, correo)
  await call(app, 'POST', `/api/admin/empresas/${e.id}/invitaciones`, S, { email: correo, rol: 'rrhh' })
  assert.deepEqual((await call(app, 'GET', '/api/empresas', U)).json().map(x => x.id), [e.id])
  assert.equal((await call(app, 'GET', `/api/empresas/${e.id}/documentos`, U)).statusCode, 200)

  // un usuario normal no ve estas rutas
  assert.equal((await call(app, 'DELETE', `/api/admin/empresas/${e.id}/miembros/${uid}`, U)).statusCode, 404)
  assert.equal((await call(app, 'PUT', `/api/admin/empresas/${e.id}/miembros/${uid}`, U, { rol: 'admin' })).statusCode, 404)

  // cambio de rol
  assert.equal((await call(app, 'PUT', `/api/admin/empresas/${e.id}/miembros/${uid}`, S, { rol: 'dueño' })).statusCode, 400)
  const c = await call(app, 'PUT', `/api/admin/empresas/${e.id}/miembros/${uid}`, S, { rol: 'contador' })
  assert.equal(c.statusCode, 200); assert.equal(c.json().rol, 'contador')
  assert.equal((await call(app, 'GET', '/api/empresas', U)).json()[0].rol, 'contador')

  // una invitación pendiente del mismo correo no debe devolverle el acceso
  await call(app, 'POST', `/api/admin/empresas/${e.id}/invitaciones`, S, { email: correo, rol: 'admin' })
  assert.equal((await call(app, 'DELETE', `/api/admin/empresas/${e.id}/miembros/${uid}`, S)).statusCode, 200)
  assert.deepEqual((await call(app, 'GET', '/api/empresas', U)).json(), [])
  assert.equal((await call(app, 'GET', `/api/empresas/${e.id}/documentos`, U)).statusCode, 403)
  assert.equal((await call(app, 'DELETE', `/api/admin/empresas/${e.id}/miembros/${uid}`, S)).statusCode, 404)

  const log = (await call(app, 'GET', `/api/admin/accesos?empresaId=${e.id}`, S)).json().map(l => l.accion)
  assert.ok(log.includes(`QUITAR MIEMBRO ${correo}`))
  assert.ok(log.includes(`CAMBIAR ROL ${correo} -> contador`))
})

test('A5: cuota de almacenamiento por empresa y tope de tamaño del historial', async () => {
  const a = crear({ cuotas: { empresaBytes: 6000, historialBytes: 2500 } })
  const u = tok(`a5c${RUN}`)
  const emp = (await call(a, 'POST', '/api/empresas', u, { nombre: 'Cuota' })).json().id
  // pg comprime: se usa texto que no comprime bien
  const relleno = (n) => Array.from({ length: n }, () => Math.random().toString(36).slice(2)).join('')
  const put = (col, datos, version) => call(a, 'PUT', `/api/empresas/${emp}/documentos/${col}`, u, { datos, version })
  assert.equal((await put('empleados', [relleno(300)], 0)).statusCode, 200)
  assert.equal((await put('prestamos', [relleno(300)], 0)).statusCode, 413)   // ~3.3 KB + ~3.3 KB > 6 KB
  assert.equal((await put('prestamos', [relleno(100)], 0)).statusCode, 200)
  // historial: cada versión pesa ~1.1 KB; con tope de 2.5 KB quedan 2, no 5
  for (let v = 1; v <= 5; v++) assert.equal((await put('prestamos', [relleno(100)], v)).statusCode, 200)
  const h = (await call(a, 'GET', `/api/empresas/${emp}/documentos/prestamos/historial`, u)).json()
  assert.deepEqual(h.map(x => x.version), [5, 4])
})

test('M4: la base no entrega documentos a quien no es miembro, aunque se fije app.empresa_id', async () => {
  const u = tok(`m4${RUN}`)
  const emp = (await call(app, 'POST', '/api/empresas', u, { nombre: 'RLS' })).json().id
  await call(app, 'PUT', `/api/empresas/${emp}/documentos/empleados`, u, { datos: [{ id: 1 }], version: 0 })
  await call(app, 'PUT', `/api/empresas/${emp}/documentos/empleados`, u, { datos: [{ id: 2 }], version: 1 })
  const intruso = { uid: `intruso${RUN}`, empresaId: emp, email: 'i@t.com', superadmin: false }
  const filas = await conContexto(intruso, async (c) => ({
    docs: (await c.query('SELECT 1 FROM documentos')).rowCount,
    hist: (await c.query('SELECT 1 FROM documentos_historial')).rowCount,
    upd: (await c.query("UPDATE documentos SET datos = '[]'")).rowCount,
  }))
  assert.deepEqual(filas, { docs: 0, hist: 0, upd: 0 })
  await assert.rejects(conContexto(intruso, (c) => c.query(
    "INSERT INTO documentos (empresa_id, coleccion, datos) VALUES ($1, 'prestamos', '[]')", [emp])), /row-level security/)
  // el miembro y el super admin sí
  const miembro = await conContexto({ uid: `m4${RUN}`, empresaId: emp }, (c) => c.query('SELECT 1 FROM documentos'))
  assert.equal(miembro.rowCount, 1)
  const sup = await conContexto({ uid: 'otro', empresaId: emp, superadmin: true }, (c) => c.query('SELECT 1 FROM documentos'))
  assert.equal(sup.rowCount, 1)
})
