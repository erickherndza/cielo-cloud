// Ingeniería del caos — integridad de datos bajo concurrencia y cortes de conexión.
// Hipótesis: con 8 escritores compitiendo por la misma colección mientras se cortan las conexiones con la
// base cada pocos milisegundos, (1) ninguna escritura confirmada se pierde, (2) nada se duplica, (3) la
// colección nunca queda a medias y (4) el historial de versiones no tiene huecos.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ProxyCaos, urlPorProxy, destinoDe, dormir } from './proxy.js'

const URL_REAL = process.env.DATABASE_URL
const proxy = new ProxyCaos(destinoDe(URL_REAL))
const puerto = await proxy.iniciar()
process.env.DATABASE_URL = urlPorProxy(URL_REAL, puerto)
const { buildApp } = await import('../../src/index.js')
const { pool } = await import('../../src/db.js')

const RUN = `${Date.now()}${process.pid}`
const SUP = `super${RUN}@cielo.test`
const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const app = buildApp({ projectId: 'x', origins: [], verify, logger: false, superadmins: [SUP], limites: { general: 1e7, escritura: 1e7, empresas: 1e7, correos: 5 }, limiteIp: 1e7 })
const H = { authorization: `Bearer sa${RUN}:${SUP}`, 'content-type': 'application/json' }
const req = (method, url, payload) => app.inject({ method, url, headers: H, payload })
const errores = []
process.on('uncaughtException', e => errores.push(e)); process.on('unhandledRejection', e => errores.push(e))
test.after(async () => { await app.close(); await pool.end().catch(() => {}); await proxy.apagar().catch(() => {}) })

async function conReintentos(fn, etiqueta, veces = 60) {
  for (let i = 0; i < veces; i++) { const r = await fn(); if (r.statusCode !== 503 && r.statusCode !== 500) return r; await dormir(40) }
  throw new Error(`${etiqueta}: la API no se recuperó tras ${veces} intentos`)
}

test('8 escritores + cortes de conexión cada ~60 ms: no se pierde, duplica ni corrompe nada', async () => {
  const rnc = String(Math.floor(100000000 + Math.random() * 899999999))
  const emp = await conReintentos(() => req('POST', '/api/admin/empresas', { nombre: 'Caos integridad', rnc }), 'crear empresa')
  const id = emp.json().id
  assert.ok(id)

  const POR_ESCRITOR = 12, ESCRITORES = 8
  const confirmadas = new Set()                              // escrituras con 200 del servidor
  const estadisticas = { c409: 0, c503: 0, c500: 0, exitos: 0 }

  async function escritor(w) {
    for (let n = 0; n < POR_ESCRITOR; n++) {
      for (let intento = 0; intento < 400; intento++) {
        const g = await req('GET', `/api/empresas/${id}/documentos`)
        if (g.statusCode !== 200) { estadisticas[`c${g.statusCode}`] = (estadisticas[`c${g.statusCode}`] ?? 0) + 1; await dormir(20); continue }
        const doc = g.json().empleados
        const lista = doc?.datos ?? []
        if (lista.some(x => x.w === w && x.n === n)) break           // ya quedó aplicada (p. ej. la respuesta se perdió en un corte)
        const r = await req('PUT', `/api/empresas/${id}/documentos/empleados`, { datos: [...lista, { w, n }], version: doc?.version ?? 0 })
        if (r.statusCode === 200) { confirmadas.add(`${w}:${n}`); estadisticas.exitos++; break }
        estadisticas[`c${r.statusCode}`] = (estadisticas[`c${r.statusCode}`] ?? 0) + 1
        if (r.statusCode === 422 || r.statusCode === 400 || r.statusCode === 403) throw new Error(`respuesta inesperada ${r.statusCode}: ${r.body}`)
        await dormir(10 + Math.random() * 30)
      }
    }
  }

  let activo = true
  const cortador = (async () => {
    while (activo) { await dormir(40 + Math.random() * 40); proxy.cortarTodas(); if (Math.random() < 0.15) { proxy.latenciaMs = 30; await dormir(60); proxy.latenciaMs = 0 } }
  })()
  await Promise.all(Array.from({ length: ESCRITORES }, (_, w) => escritor(w)))
  activo = false; await cortador
  proxy.normal()
  await dormir(200)

  // ── Verificación (con la base sana) ─────────────────────────────────────────
  const fin = await conReintentos(() => req('GET', `/api/empresas/${id}/documentos`), 'lectura final')
  const doc = fin.json().empleados
  const claves = doc.datos.map(x => `${x.w}:${x.n}`)
  const unicas = new Set(claves)
  const esperadas = ESCRITORES * POR_ESCRITOR
  assert.equal(unicas.size, claves.length, 'hay elementos duplicados')
  assert.equal(unicas.size, esperadas, `deben existir las ${esperadas} escrituras; faltan: ${[...Array(ESCRITORES).keys()].flatMap(w => [...Array(POR_ESCRITOR).keys()].map(n => `${w}:${n}`)).filter(k => !unicas.has(k)).slice(0, 8)}`)
  const perdidas = [...confirmadas].filter(k => !unicas.has(k))
  assert.deepEqual(perdidas, [], 'escrituras confirmadas con 200 que se perdieron')

  // El historial se lee por la API (la RLS no deja leerlo sin contexto de empresa) y NO puede estar vacío.
  const hist = await conReintentos(() => req('GET', `/api/empresas/${id}/documentos/empleados/historial`), 'historial')
  const vs = hist.json().map(r => r.version).sort((a, b) => a - b)
  assert.ok(vs.length >= 15, `el historial debería conservar las últimas ~20 versiones (tiene ${vs.length}): la comprobación sería vacía`)
  for (let i = 1; i < vs.length; i++) assert.equal(vs[i], vs[i - 1] + 1, `hueco en el historial entre las versiones ${vs[i - 1]} y ${vs[i]}`)
  assert.equal(vs[vs.length - 1], doc.version - 1, `el historial no termina justo antes de la versión vigente (historial: ${vs.slice(-4)}, vigente: ${doc.version}, versiones en historial: ${vs.length})`)
  assert.equal(doc.version, esperadas, 'cada escritura aplicada debe haber subido la versión exactamente una vez')

  console.log(`  (estadísticas del caos: ${JSON.stringify(estadisticas)}, conexiones abiertas por el proxy: ${proxy.conexiones})`)
  assert.ok(estadisticas.c409 + estadisticas.c503 + (estadisticas.c500 ?? 0) > 0, 'el experimento no llegó a provocar ni un conflicto ni un fallo: no probó nada')
  assert.deepEqual(errores.map(e => e.message), [], 'errores no capturados durante el caos')
})
