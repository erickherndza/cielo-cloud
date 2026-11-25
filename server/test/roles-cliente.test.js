// Ejercicio de punta a punta: servidor real + capa de almacenamiento del cliente, un usuario por rol.
// Se ejecuta con tsx (el cliente es TypeScript): npx tsx --test test/roles-cliente.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/index.js'
import { pool } from '../src/db.js'

const RUN = Date.now()
const SUP = `superc${RUN}@cielo.test`
const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false, superadmins: [SUP],
  limites: { general: 10_000, escritura: 10_000, empresas: 100, correos: 5 } })
await app.listen({ port: 0, host: '127.0.0.1' })
process.env.NEXT_PUBLIC_API_URL = `http://127.0.0.1:${app.server.address().port}`
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'x'
const store = new Map()
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }
globalThis.sessionStorage = globalThis.localStorage
globalThis.window = { addEventListener() {}, location: { assign() {} } }
const { storage, initRemoteStore, flushStorage, getSyncStatus, getDenegado, rolActivo } = await import('../../src/lib/storage.ts')
test.after(async () => { await app.close(); await pool.end() })

const S = { authorization: `Bearer sac${RUN}:${SUP}` }
const emp = { id: 'e1', nombre: 'Ana', salarioBase: 50000 }

async function entrar(rol, empresaId) {
  const uid = `${rol}${RUN}`, correo = `${rol}${RUN}@t.com`
  await app.inject({ method: 'POST', url: `/api/admin/empresas/${empresaId}/invitaciones`, headers: S, payload: { email: correo, rol } })
  store.clear()
  await initRemoteStore(uid, async () => `${uid}:${correo}`)
  return uid
}

test('cada rol hace su ejercicio con el cliente real', async () => {
  const e = (await app.inject({ method: 'POST', url: '/api/admin/empresas', headers: S,
    payload: { nombre: 'Ejercicio', rnc: String(Math.floor(100000000 + Math.random() * 899999999)) } })).json()
  const intento = async (uid, base, valor) => { storage.setItem(`cielo-${base}::${uid}`, JSON.stringify(valor)); await flushStorage() }

  // RRHH da de alta un empleado y registra horas extras
  let uid = await entrar('rrhh', e.id)
  assert.equal(rolActivo(), 'rrhh')
  await intento(uid, 'empleados', [emp]); assert.equal(getSyncStatus(), 'idle')
  await intento(uid, 'horas-extras', [{ id: 'h1', empleadoId: 'e1', horas: 3 }]); assert.equal(getSyncStatus(), 'idle')
  await intento(uid, 'empresa', { nombre: 'Cambiado' })
  assert.equal(getSyncStatus(), 'denied'); assert.equal(getDenegado().col, 'empresa')   // la configuración no es de RRHH

  // Contador: ve al empleado y las horas, procesa nómina, pero no edita empleados
  uid = await entrar('contador', e.id)
  assert.equal(JSON.parse(storage.getItem(`cielo-empleados::${uid}`))[0].nombre, 'Ana')
  assert.equal(JSON.parse(storage.getItem(`cielo-horas-extras::${uid}`))[0].horas, 3)
  await intento(uid, 'periodos', [{ id: 'p1', estado: 'en_proceso' }]); assert.equal(getSyncStatus(), 'idle')
  await intento(uid, 'empleados', [{ ...emp, salarioBase: 1 }]); assert.equal(getSyncStatus(), 'denied')

  // Gerente: ve todo, aprueba aumentos, no puede borrar ni agregar empleados
  uid = await entrar('gerente', e.id)
  assert.equal(JSON.parse(storage.getItem(`cielo-periodos::${uid}`))[0].id, 'p1')
  await intento(uid, 'aumentos', [{ id: 'a1', estado: 'aprobado' }]); assert.equal(getSyncStatus(), 'idle')
  await intento(uid, 'empleados', []); assert.equal(getSyncStatus(), 'denied')

  // El salario del empleado nunca cambió en el servidor tras los intentos rechazados
  uid = await entrar('rrhh', e.id)
  assert.equal(JSON.parse(storage.getItem(`cielo-empleados::${uid}`))[0].salarioBase, 50000)
  assert.equal(JSON.parse(storage.getItem(`cielo-aumentos::${uid}`))[0].estado, 'aprobado')
})
