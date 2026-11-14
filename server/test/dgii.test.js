import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/index.js'
import { pool } from '../src/db.js'
import { rncValido, interpretarRespuesta, consultarDgii, crearConsultaConCache } from '../src/dgii.js'

const PAGINA = `<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="abc&#43;def==" />
<input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="4F4BAA71" />
<input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="ev123" />`
const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`
const OK = `<table id="cphMain_dvDatosContribuyentes">${row('Cédula/RNC', '430-30967-2')}${row('Nombre/Razón Social', 'JUNTA &amp; CIA')}
${row('Nombre Comercial', '')}${row('Categoría', '')}${row('Régimen de pagos', 'NORMAL')}${row('Estado', 'ACTIVO')}
${row('Actividad Economica', 'SERVICIOS')}${row('Administracion Local', 'ADM LOCAL SAN CRISTOBAL')}${row('Facturador Electrónico', 'NO')}</table>`
const NO = `<span id="cphMain_lblInformacion" class="label">El RNC/Cédula consultado no se encuentra inscrito como Contribuyente.</span>`

test('dígito verificador del RNC', () => {
  assert.equal(rncValido('430-30967-2'), true)
  assert.equal(rncValido('430309673'), false)
  assert.equal(rncValido('12345'), false)
  assert.equal(rncValido('00112345678'), true)   // 11 dígitos: solo largo
})

test('interpreta resultado, no inscrito y respuesta desconocida', () => {
  const r = interpretarRespuesta(OK)
  assert.deepEqual([r.encontrado, r.rnc, r.razonSocial, r.estado, r.regimenPagos, r.administracionLocal],
    [true, '430309672', 'JUNTA & CIA', 'ACTIVO', 'NORMAL', 'ADM LOCAL SAN CRISTOBAL'])
  assert.deepEqual(interpretarRespuesta(NO), { encontrado: false })
  assert.throws(() => interpretarRespuesta('<html>cambió todo</html>'), /no reconocida/)
})

test('consulta: manda el ViewState decodificado y el RNC; usa la cookie de sesión', async () => {
  const llamadas = []
  const fetchFalso = async (url, init = {}) => {
    llamadas.push({ method: init.method ?? 'GET', body: init.body?.toString(), cookie: init.headers?.Cookie })
    const html = init.method === 'POST' ? OK : PAGINA
    return { ok: true, status: 200, text: async () => html, headers: { getSetCookie: () => ['ASP.NET_SessionId=zz; path=/; HttpOnly'] } }
  }
  const r = await consultarDgii('430309672', fetchFalso)
  assert.equal(r.encontrado, true)
  const post = llamadas[1]
  assert.equal(post.method, 'POST'); assert.equal(post.cookie, 'ASP.NET_SessionId=zz')
  const p = new URLSearchParams(post.body)
  assert.equal(p.get('__VIEWSTATE'), 'abc+def=='); assert.equal(p.get('ctl00$cphMain$txtRNCCedula'), '430309672')
})

test('caché: la segunda consulta no sale a la DGII; un fallo no se guarda', async () => {
  let n = 0, falla = false
  const f = async (url, init = {}) => {
    n++; if (falla) return { ok: false, status: 500, text: async () => '', headers: { getSetCookie: () => [] } }
    return { ok: true, status: 200, text: async () => (init.method === 'POST' ? OK : PAGINA), headers: { getSetCookie: () => [] } }
  }
  const c = crearConsultaConCache(f)
  await c('430309672'); await c('430309672'); assert.equal(n, 2)   // GET + POST una sola vez
  const c2 = crearConsultaConCache(f); falla = true
  await assert.rejects(c2('430309672')); falla = false
  assert.equal((await c2('430309672')).encontrado, true)
})

const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false,
  consultarRnc: async (r) => { if (r === '999999990') throw new Error('x'); return { encontrado: true, rnc: r, razonSocial: 'X' } },
  limites: { general: 1000, escritura: 1000, empresas: 5, dgii: 3 } })
test.after(async () => { await app.close(); await pool.end() })
const H = (u) => ({ authorization: `Bearer ${u}:${u}@t.com` })

test('ruta: exige sesión, valida el RNC, 502 si la DGII falla y limita por usuario', async () => {
  const g = (rnc, u) => app.inject({ method: 'GET', url: `/api/dgii/rnc/${rnc}`, headers: u ? H(u) : {} })
  assert.equal((await g('430309672')).statusCode, 401)
  assert.equal((await g('430309673', 'u1')).statusCode, 400)
  assert.equal((await g('430-30967-2', 'u1')).json().razonSocial, 'X')
  const u = `lim${Date.now()}`
  for (let i = 0; i < 3; i++) assert.equal((await g('430309672', u)).statusCode, 200)
  assert.equal((await g('430309672', u)).statusCode, 429)
})
