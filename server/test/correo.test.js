import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/index.js'
import { pool } from '../src/db.js'

const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const enviados = []
const app = buildApp({
  projectId: 'x', origins: [], verify, logger: false,
  enviarCorreo: async (m) => { if (m.to === 'falla@t.com') throw new Error('x'); enviados.push(m) },
})
const sinCorreo = buildApp({ projectId: 'x', origins: [], verify, logger: false })
const H = (u) => ({ authorization: `Bearer ${u}:${u}@t.com` })
const PDF = 'JVBERi0xLjQKJcfs'
test.after(async () => { await app.close(); await sinCorreo.close(); await pool.end() })

async function empresaConEmpleados(a, u, empleados) {
  const id = (await a.inject({ method: 'POST', url: '/api/empresas', headers: H(u), payload: { nombre: 'E' } })).json().id
  await a.inject({ method: 'PUT', url: `/api/empresas/${id}/documentos/empleados`, headers: H(u), payload: { datos: empleados, version: 0 } })
  return id
}
const enviar = (a, id, u, items) =>
  a.inject({ method: 'POST', url: `/api/empresas/${id}/comprobantes/enviar`, headers: H(u), payload: { items } })

test('envía solo al correo guardado del empleado, nunca a uno enviado por el cliente', async () => {
  const u = `m${Date.now()}`
  const id = await empresaConEmpleados(app, u, [
    { id: 'e1', email: 'ana@t.com' }, { id: 'e2', email: 'falla@t.com' }, { id: 'e3' },
  ])
  const base = { asunto: 'Hola', cuerpo: 'Texto', pdfBase64: PDF }
  const r = await enviar(app, id, u, [
    { ...base, empleadoId: 'e1', email: 'atacante@x.com', to: 'atacante@x.com' },
    { ...base, empleadoId: 'e2' }, { ...base, empleadoId: 'e3' },
    { ...base, empleadoId: 'e1', pdfBase64: 'no-es-pdf' }, { ...base, empleadoId: 'zz' },
  ])
  assert.equal(r.statusCode, 200)
  const res = Object.fromEntries(r.json().resultados.map((x, i) => [i, x]))
  assert.deepEqual(r.json().resultados.map(x => x.ok).sort(), [false, false, false, false, true])
  assert.equal(enviados.length, 1)
  assert.equal(enviados[0].to, 'ana@t.com')
  assert.equal(enviados[0].attachments[0].filename, 'comprobante-de-pago.pdf')
  void res
})

test('otra cuenta no puede enviar por una empresa ajena → 403', async () => {
  const u = `m1${Date.now()}`
  const id = await empresaConEmpleados(app, u, [{ id: 'e1', email: 'ana@t.com' }])
  const r = await enviar(app, id, `otro${Date.now()}`, [{ empleadoId: 'e1', asunto: 'a', cuerpo: 'b', pdfBase64: PDF }])
  assert.equal(r.statusCode, 403)
})

test('sin configurar Resend → 503; lote vacío o enorme → 400', async () => {
  const u = `m2${Date.now()}`
  const id = await empresaConEmpleados(sinCorreo, u, [{ id: 'e1', email: 'ana@t.com' }])
  assert.equal((await enviar(sinCorreo, id, u, [{ empleadoId: 'e1' }])).statusCode, 503)
  assert.equal((await enviar(app, id, u, [])).statusCode, 400)
  assert.equal((await enviar(app, id, u, Array(51).fill({ empleadoId: 'e1' }))).statusCode, 400)
})
