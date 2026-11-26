// Ingeniería del caos — la base de datos falla de formas realistas.
// Hipótesis de estado estable: la API nunca se cae, nunca se cuelga indefinidamente,
// responde con un error claro y vuelve sola a funcionar cuando la base regresa.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ProxyCaos, urlPorProxy, destinoDe, dormir, conLimite } from './proxy.js'

const URL_REAL = process.env.DATABASE_URL
const proxy = new ProxyCaos(destinoDe(URL_REAL))
const puerto = await proxy.iniciar()
process.env.DATABASE_URL = urlPorProxy(URL_REAL, puerto)      // db.js lee esto al importarse
process.env.DB_QUERY_TIMEOUT_MS ??= '2500'                    // acorta el límite de consulta para que la prueba no tarde 25 s
const { buildApp } = await import('../../src/index.js')
const { pool } = await import('../../src/db.js')

const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false, limites: { general: 100_000, escritura: 100_000, empresas: 1000, correos: 5 }, limiteIp: 100_000 })
const U = { authorization: 'Bearer caos1:caos1@t.com' }
const yo = () => app.inject({ url: '/api/empresas', headers: U })

const errores = []
process.on('uncaughtException', e => errores.push(e))
process.on('unhandledRejection', e => errores.push(e))

test.after(async () => { await app.close(); await pool.end().catch(() => {}); await proxy.apagar().catch(() => {}) })

test('línea base: con la base sana la API responde', async () => {
  assert.equal((await yo()).statusCode, 200)
})

test('CAOS 1 — se cortan todas las conexiones con la base (reinicio de la base): la API no se cae y se recupera sola', async () => {
  await yo()                               // deja conexiones abiertas en el pool
  proxy.cortarTodas()
  await dormir(300)                         // da tiempo a que los clientes inactivos detecten el corte
  assert.deepEqual(errores.map(e => e.message), [], 'un error de conexión inactiva tumbó el proceso')
  // Tras el corte, el pool descarta las conexiones muertas: en el peor caso falla UNA petición y luego todo vuelve
  let ok = false
  for (let i = 0; i < 4 && !ok; i++) ok = (await conLimite(yo(), 8000, 'petición tras el corte')).statusCode === 200
  assert.ok(ok, 'la API no se recuperó tras cortar las conexiones')
})

test('CAOS 2 — la base no responde a conexiones NUEVAS (paquetes perdidos): falla con 503 en el límite de conexión, sin colgarse', async () => {
  proxy.cortarTodas(); await dormir(300)    // el pool descarta las conexiones muertas: la siguiente petición abre una nueva
  proxy.modo = 'agujero'
  const t0 = Date.now()
  const r = await conLimite(yo(), 15_000, 'petición con la base caída')
  const ms = Date.now() - t0
  assert.ok([500, 503].includes(r.statusCode), `código inesperado ${r.statusCode}`)
  assert.equal(r.statusCode, 503, 'una base caída debe responder 503 (servicio no disponible), no 500')
  assert.ok(ms >= 1_000 && ms < 8_000, `tardó ${ms} ms: debía agotar el límite de conexión (~5 s), ni instantáneo ni colgado`)
  assert.ok(r.headers['retry-after'], 'debe indicar cuándo reintentar')
  assert.equal(typeof r.json().error, 'string')
  proxy.normal()
})

test('CAOS 2b — la conexión está viva pero la red se traga los paquetes a mitad de petición: el límite de consulta corta y la conexión se destruye', async () => {
  assert.equal((await yo()).statusCode, 200)          // deja una conexión sana en el pool
  proxy.modo = 'agujero'                               // la conexión sigue abierta pero ya no llega nada
  const t0 = Date.now()
  const r = await conLimite(yo(), 15_000, 'petición con la red muda')
  assert.equal(r.statusCode, 503)
  assert.ok(Date.now() - t0 < 8_000, `tardó ${Date.now() - t0} ms`)
  proxy.normal()
  proxy.cortarTodas(); await dormir(300)
  let ok = false
  for (let i = 0; i < 4 && !ok; i++) ok = (await yo()).statusCode === 200
  assert.ok(ok, 'la conexión colgada quedó en el pool y envenenó las siguientes peticiones')
})

test('CAOS 3 — la base rechaza conexiones: 503 inmediato y recuperación al volver', async () => {
  const p = proxy.puerto
  await proxy.apagar()
  const t0 = Date.now()
  const r = await conLimite(yo(), 10_000, 'petición con la base apagada')
  assert.equal(r.statusCode, 503)
  assert.ok(Date.now() - t0 < 5_000, 'debe fallar rápido')
  await proxy.encender(p)
  let ok = false
  for (let i = 0; i < 5 && !ok; i++) { ok = (await yo()).statusCode === 200; if (!ok) await dormir(200) }
  assert.ok(ok, 'no se recuperó al volver la base')
})

test('CAOS 4 — la base responde lento: 30 peticiones simultáneas llegan todas, sin perderse ni dar 500', async () => {
  proxy.latenciaMs = 100
  const t0 = Date.now()
  const rs = await conLimite(Promise.all(Array.from({ length: 30 }, yo)), 25_000, '30 peticiones con latencia')
  const malas = rs.filter(r => r.statusCode !== 200).map(r => r.statusCode)
  assert.deepEqual(malas, [], 'peticiones que no respondieron 200 bajo latencia')
  assert.ok(Date.now() - t0 < 15_000, `tardó ${Date.now() - t0} ms`)
  proxy.normal()
})

test('CAOS 4b — con la base saturada de lentitud, el sistema recorta carga con 503 (nunca 500 ni cuelgues)', async () => {
  proxy.latenciaMs = 700                    // cada consulta tarda >1 s: el pool de 10 no da abasto para 60 peticiones
  const rs = await conLimite(Promise.all(Array.from({ length: 60 }, yo)), 40_000, '60 peticiones con la base saturada')
  const codigos = new Set(rs.map(r => r.statusCode))
  assert.ok([...codigos].every(c => c === 200 || c === 503), `códigos inesperados: ${[...codigos]}`)
  for (const r of rs.filter(r => r.statusCode === 503)) assert.ok(r.headers['retry-after'], '503 sin Retry-After')
  proxy.normal()
  const despues = await conLimite(yo(), 10_000, 'petición tras la saturación')
  assert.equal(despues.statusCode, 200, 'no se recuperó tras la saturación')
})

test('CAOS 5 — /health con la base caída informa 503 y se recupera', async () => {
  proxy.cortarTodas(); proxy.modo = 'agujero'
  await dormir(5100)                         // vence la caché de 5 s de /health
  const r = await conLimite(app.inject({ url: '/health' }), 12_000, '/health con la base caída')
  assert.equal(r.statusCode, 503)
  proxy.normal()
  await dormir(5100)
  let ok = false
  for (let i = 0; i < 4 && !ok; i++) { ok = (await app.inject({ url: '/health' })).statusCode === 200; if (!ok) await dormir(600) }
  assert.ok(ok, '/health no se recuperó')
})

test('ningún error no capturado durante todo el caos', () => {
  assert.deepEqual(errores.map(e => e.message), [])
})
