import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/index.js'
import { pool } from '../src/db.js'

const SUP = `super${Date.now()}@cielo.test`
const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false, superadmins: [SUP], autoregistro: false })
await app.listen({ port: 0, host: '127.0.0.1' })
process.env.NEXT_PUBLIC_API_URL = `http://127.0.0.1:${app.server.address().port}`
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'x'
const store = new Map()
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
const { storage, initRemoteStore, getAcceso } = await import('../../src/lib/storage.ts')
test.after(async () => { await app.close(); await pool.end() })

const sfx = Date.now()
const H = (uid, email) => ({ authorization: `Bearer ${uid}:${email}` })
const admin = (m, u, p) => app.inject({ method: m, url: u, headers: H('sa', SUP), payload: p })
const rnc = () => String(Math.floor(100000000 + Math.random() * 899999999))
const entrar = (uid, email) => initRemoteStore(uid, async () => `${uid}:${email}`)

test('sin empresa y sin autoregistro: no hay empresa activa (pantalla «sin empresa»)', async () => {
  await entrar(`n${sfx}`, `nadie${sfx}@t.com`)
  assert.equal(getAcceso().activa, null); assert.deepEqual(getAcceso().empresas, [])
})

test('invitado a una empresa: queda activa sola y puede guardar', async () => {
  const id = (await admin('POST', '/api/admin/empresas', { nombre: 'Uno', rnc: rnc() })).json().id
  await admin('POST', `/api/admin/empresas/${id}/invitaciones`, { email: `uno${sfx}@t.com`, rol: 'gerente' })
  await entrar(`u1${sfx}`, `uno${sfx}@t.com`)
  assert.equal(getAcceso().activa.id, id); assert.equal(getAcceso().soporte, false)
  storage.setItem(`cielo-empleados::u1${sfx}`, '[{"id":"x"}]')
})

test('contador con dos empresas: debe elegir; al elegir carga solo esa', async () => {
  const mail = `cont${sfx}@t.com`, uid = `c${sfx}`
  const ids = []
  for (const nombre of ['A', 'B']) {
    const id = (await admin('POST', '/api/admin/empresas', { nombre, rnc: rnc() })).json().id
    await admin('POST', `/api/admin/empresas/${id}/invitaciones`, { email: mail, rol: 'contador' })
    ids.push(id)
  }
  await entrar(uid, mail)
  assert.equal(getAcceso().activa, null); assert.equal(getAcceso().empresas.length, 2)
  store.set(`cielo-empresa-activa::${uid}`, JSON.stringify({ id: ids[1], nombre: 'B', rnc: null }))
  await entrar(uid, mail)
  assert.equal(getAcceso().activa.id, ids[1])
})

test('super admin: sin empresas va al panel; entrando a una ajena queda en modo soporte; una guardada ajena de un usuario normal se descarta', async () => {
  await entrar('sa', SUP)
  assert.equal(getAcceso().esSuperadmin, true); assert.equal(getAcceso().activa, null)
  const id = (await admin('POST', '/api/admin/empresas', { nombre: 'Aj', rnc: rnc() })).json().id
  store.set('cielo-empresa-activa::sa', JSON.stringify({ id, nombre: 'Aj', rnc: null }))
  await entrar('sa', SUP)
  assert.equal(getAcceso().activa.id, id); assert.equal(getAcceso().soporte, true)

  // un usuario normal con una empresa ajena guardada en el navegador no entra a ella
  store.set(`cielo-empresa-activa::intruso${sfx}`, JSON.stringify({ id, nombre: 'Aj', rnc: null }))
  await entrar(`intruso${sfx}`, `intruso${sfx}@t.com`)
  assert.equal(getAcceso().activa, null)
})
