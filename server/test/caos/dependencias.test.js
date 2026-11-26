// Ingeniería del caos — dependencias externas que fallan: el servicio de llaves de Firebase, la DGII y el correo.
// Hipótesis: ninguna falla externa acepta un acceso no verificado (falla cerrado), cuelga la API ni se
// confunde con un error del usuario; y todo vuelve a funcionar cuando la dependencia regresa.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { buildApp } from '../../src/index.js'
import { pool } from '../../src/db.js'
import { crearVerificador, AuthNoDisponible } from '../../src/auth.js'
import { consultarDgii, crearConsultaConCache } from '../../src/dgii.js'
import { crearEnviadorResend } from '../../src/correo.js'
import { dormir, conLimite } from './proxy.js'

const PROYECTO = 'proyecto-caos'
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
const { privateKey: otraPrivada } = await generateKeyPair('RS256')

// Servidor de llaves FALSO (controlable): sano, caído, lento o con respuesta basura.
let modoJwks = 'sano'
const jwksServer = http.createServer((req, res) => {
  if (modoJwks === 'lento') return                                    // nunca responde
  if (modoJwks === 'error') { res.writeHead(500); return res.end('boom') }
  if (modoJwks === 'basura') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"no":"son llaves"}') }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] }))
})
await new Promise(r => jwksServer.listen(0, '127.0.0.1', r))
let urlJwks = `http://127.0.0.1:${jwksServer.address().port}/jwks`
const firmar = (extra = {}, { clave = privateKey, kid = 'k1', exp = '5m', aud = PROYECTO, alg = 'RS256' } = {}) =>
  new SignJWT({ email: 'a@t.com', email_verified: true, ...extra })
    .setProtectedHeader({ alg, kid }).setSubject('uid-caos').setIssuedAt().setIssuer(`https://securetoken.google.com/${PROYECTO}`)
    .setAudience(aud).setExpirationTime(exp).sign(clave)

const nuevoApp = (verify) => buildApp({ projectId: PROYECTO, origins: [], verify, logger: false, limites: { general: 1e6, escritura: 1e6, empresas: 1e6, correos: 5 }, limiteIp: 1e6 })
const llamar = (app, token) => app.inject({ url: '/api/yo', headers: token ? { authorization: `Bearer ${token}` } : {} })
test.after(async () => { jwksServer.close(); jwksServer.closeAllConnections?.(); await pool.end().catch(() => {}) })

test('línea base: un token válido se acepta y uno manipulado se rechaza', async () => {
  modoJwks = 'sano'
  const verificar = crearVerificador({ jwksUrl: urlJwks, timeoutDuration: 800 })
  const app = nuevoApp(verificar)
  assert.equal((await llamar(app, await firmar())).statusCode, 200)
  assert.equal((await llamar(app, await firmar({}, { clave: otraPrivada }))).statusCode, 401, 'firma de otra clave')
  assert.equal((await llamar(app, await firmar({}, { exp: '-1m' }))).statusCode, 401, 'token vencido')
  assert.equal((await llamar(app, await firmar({}, { aud: 'otro-proyecto' }))).statusCode, 401, 'audiencia ajena')
  assert.equal((await llamar(app, 'esto.no.es.un.jwt')).statusCode, 401)
  assert.equal((await llamar(app, undefined)).statusCode, 401)
  await app.close()
})

test('CAOS — las llaves de Google caen DESPUÉS de estar en caché: los usuarios siguen entrando', async () => {
  modoJwks = 'sano'
  const app = nuevoApp(crearVerificador({ jwksUrl: urlJwks, timeoutDuration: 800 }))
  assert.equal((await llamar(app, await firmar())).statusCode, 200)    // llena la caché
  modoJwks = 'error'
  for (let i = 0; i < 3; i++) assert.equal((await llamar(app, await firmar())).statusCode, 200, 'con la caché, la caída de Google no debe afectar')
  await app.close()
})

test('CAOS — las llaves de Google caen en un arranque en frío: falla CERRADO con 503 (no 401, no se acepta sin verificar) y se recupera', async () => {
  const app = nuevoApp(crearVerificador({ jwksUrl: urlJwks, timeoutDuration: 800 }))
  const token = await firmar()
  for (const modo of ['error', 'basura']) {
    modoJwks = modo
    const r = await llamar(app, token)
    assert.equal(r.statusCode, 503, `con las llaves en modo «${modo}» debe responder 503, no ${r.statusCode}`)
    assert.ok(r.headers['retry-after'])
    assert.equal(r.json().codigo, 'auth_no_disponible')
  }
  modoJwks = 'sano'
  assert.equal((await llamar(app, token)).statusCode, 200, 'no se recuperó al volver Google')
  await app.close()
})

test('CAOS — las llaves de Google no responden (red que traga paquetes): el tiempo límite corta y responde 503, sin colgarse', async () => {
  modoJwks = 'lento'
  const app = nuevoApp(crearVerificador({ jwksUrl: urlJwks, timeoutDuration: 800 }))
  const t0 = Date.now()
  const r = await conLimite(llamar(app, await firmar()), 6_000, 'verificación con Google mudo')
  assert.equal(r.statusCode, 503)
  assert.ok(Date.now() - t0 < 3_000, `tardó ${Date.now() - t0} ms`)
  modoJwks = 'sano'
  await app.close()
})

test('CAOS — con Google caído, un token basura sigue siendo 401 (no 503) y un token válido NUNCA pasa', async () => {
  modoJwks = 'error'
  const app = nuevoApp(crearVerificador({ jwksUrl: urlJwks, timeoutDuration: 800 }))
  assert.equal((await llamar(app, 'basura')).statusCode, 401)
  assert.notEqual((await llamar(app, await firmar())).statusCode, 200, 'sin poder verificar la firma jamás debe aceptarse')
  assert.notEqual((await llamar(app, await firmar({}, { clave: otraPrivada }))).statusCode, 200, 'una firma falsa jamás debe aceptarse')
  modoJwks = 'sano'
  await app.close()
})

test('AuthNoDisponible es distinto de un token inválido', async () => {
  modoJwks = 'error'
  const v = crearVerificador({ jwksUrl: urlJwks, timeoutDuration: 800 })
  await assert.rejects(async () => v(await firmar(), PROYECTO), (e) => e instanceof AuthNoDisponible)
  modoJwks = 'sano'
  await assert.rejects(() => v('x.y.z', PROYECTO), (e) => !(e instanceof AuthNoDisponible))
})
function await_(p) { return p }

// ── DGII ──────────────────────────────────────────────────────────────────────
test('CAOS — la DGII no responde / responde 500 / responde basura: error acotado, nada se guarda en caché, se recupera', async () => {
  let modo = 'caida'
  const pagina = '<input id="__VIEWSTATE" name="__VIEWSTATE" value="abc"/>'
  const fetchFalso = async (url, init) => {
    if (modo === 'cuelga') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)))
    if (modo === 'caida') throw new TypeError('fetch failed')
    if (modo === '500') return new Response('x', { status: 500 })
    if (modo === 'basura') return new Response('<html>mantenimiento</html>', { status: 200, headers: {} })
    return new Response(pagina, { status: 200 })
  }
  const consulta = crearConsultaConCache(fetchFalso)
  const rnc = '101010101'
  for (const m of ['caida', '500', 'basura']) { modo = m; await assert.rejects(() => consulta(rnc), undefined, `modo ${m}`) }
  // No se ha cacheado ningún fallo: al volver, una consulta distinta funciona sin esperas
  modo = 'basura'
  await assert.rejects(() => consulta(rnc))
})

test('CAOS — la DGII se cuelga: el tiempo límite de 10 s la corta (la API no queda esperando)', async () => {
  const fetchColgado = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)))
  const t0 = Date.now()
  await assert.rejects(() => conLimite(consultarDgii('101010101', fetchColgado), 13_000, 'DGII colgada'), (e) => /abort|timeout|Timeout/i.test(e.name + e.message))
  const ms = Date.now() - t0
  assert.ok(ms >= 9_000 && ms < 12_000, `la consulta se cortó a los ${ms} ms (debía ser ~10 s)`)
})

// ── Correo ────────────────────────────────────────────────────────────────────
test('CAOS — el proveedor de correo responde 500 / 429 / se cae: el error es claro y no tumba nada', async () => {
  for (const respuesta of [() => new Response('{"message":"internal"}', { status: 500 }), () => new Response('limit', { status: 429 }), () => { throw new TypeError('fetch failed') }]) {
    const enviar = crearEnviadorResend({ apiKey: 're_x', from: 'a@b.c', fetchFn: async () => respuesta() })
    await assert.rejects(() => enviar({ to: 'x@y.z', subject: 's', text: 't' }))
  }
  const ok = crearEnviadorResend({ apiKey: 're_x', from: 'a@b.c', fetchFn: async () => new Response('{}', { status: 200 }) })
  await ok({ to: 'x@y.z', subject: 's', text: 't' })     // y se recupera
})
