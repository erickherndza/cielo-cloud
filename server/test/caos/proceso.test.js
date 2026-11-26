// Ingeniería del caos — el proceso de la API se detiene en mitad del trabajo.
// Hipótesis: un despliegue (SIGTERM) no pierde peticiones en curso; una caída brusca (SIGKILL) nunca
// deja datos a medias: lo confirmado sigue ahí y lo no confirmado no existe, sin corrupción.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProxyCaos, urlPorProxy, destinoDe, dormir, conLimite } from './proxy.js'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const URL_REAL = process.env.DATABASE_URL
const RUN = `${Date.now()}${process.pid}`
const SUP = `super${RUN}@cielo.test`
const proxy = new ProxyCaos(destinoDe(URL_REAL))
await proxy.iniciar()

const libre = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })

async function lanzar({ viaProxy = false, extra = {} } = {}) {
  const puerto = await libre()
  const hijo = spawn(process.execPath, ['--import', 'tsx', path.join(AQUI, 'servidor-prueba.js')], {
    env: { ...process.env, DATABASE_URL: viaProxy ? urlPorProxy(URL_REAL, proxy.puerto) : URL_REAL, PORT: String(puerto), SUPERADMINS: SUP, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let salida = ''
  hijo.stdout.on('data', d => { salida += d }); hijo.stderr.on('data', d => { salida += d })
  const fin = new Promise(r => hijo.on('exit', (code, sig) => r({ code, sig })))
  const t0 = Date.now()
  while (!salida.includes('LISTO')) {
    if (Date.now() - t0 > 15_000) throw new Error('el servidor de prueba no arrancó: ' + salida)
    await dormir(50)
  }
  return { hijo, puerto, fin, salida: () => salida, base: `http://127.0.0.1:${puerto}` }
}
const SA = { authorization: `Bearer sa${RUN}:${SUP}`, 'content-type': 'application/json' }
const rnc = () => String(Math.floor(100000000 + Math.random() * 899999999))
async function crearEmpresa(base) {
  const r = await fetch(`${base}/api/admin/empresas`, { method: 'POST', headers: SA, body: JSON.stringify({ nombre: 'Caos proceso', rnc: rnc() }) })
  return (await r.json()).id
}
test.after(async () => { await proxy.apagar().catch(() => {}) })

test('SIGTERM (despliegue) con una petición en curso: la petición termina bien, el proceso sale con código 0 y no acepta nuevas', async () => {
  const s = await lanzar({ viaProxy: true, extra: { PLAZO_CIERRE_MS: '20000' } })
  const id = await crearEmpresa(s.base)
  proxy.latenciaMs = 250                                   // cada viaje a la base tarda 0.5 s: la petición dura ~3 s
  const enCurso = fetch(`${s.base}/api/empresas/${id}/documentos`, { headers: SA })
  await dormir(500)                                        // la petición ya entró y está esperando a la base
  s.hijo.kill('SIGTERM')
  await dormir(150)
  const nueva = await fetch(`${s.base}/api/yo`, { headers: SA }).then(r => r.status, () => 'rechazada')
  assert.ok(nueva === 'rechazada' || nueva === 503, `una petición nueva durante el cierre debe rechazarse (recibió ${nueva})`)
  const r = await conLimite(enCurso, 15_000, 'petición en curso durante el SIGTERM')
  assert.equal(r.status, 200, 'la petición en curso se perdió con el cierre')
  const { code, sig } = await conLimite(s.fin, 15_000, 'cierre del proceso')
  assert.equal(code, 0, `debía salir con código 0 (salió con ${code}/${sig}): ${s.salida()}`)
  proxy.normal()
})

test('SIGTERM sin tráfico: sale de inmediato y con código 0', async () => {
  const s = await lanzar()
  const t0 = Date.now()
  s.hijo.kill('SIGTERM')
  const { code } = await conLimite(s.fin, 8_000, 'cierre')
  assert.equal(code, 0)
  assert.ok(Date.now() - t0 < 3_000, `tardó ${Date.now() - t0} ms en cerrar sin tráfico`)
})

test('SIGKILL en mitad de una tormenta de escrituras: nada queda a medias y lo confirmado sobrevive', async () => {
  let s = await lanzar()
  const id = await crearEmpresa(s.base)
  const H = SA
  const base0 = async () => (await (await fetch(`${s.base}/api/empresas/${id}/documentos`, { headers: H })).json()).empleados
  const confirmados = []                                   // escrituras que el servidor respondió 200 (y por tanto debe conservar)
  let parar = false
  const trabajador = async (w) => {
    let n = 0
    while (!parar) {
      try {
        const cur = await base0()
        const lista = cur?.datos ?? []
        const item = { w, n: n++ }
        const r = await fetch(`${s.base}/api/empresas/${id}/documentos/empleados`, { method: 'PUT', headers: H, body: JSON.stringify({ datos: [...lista, item], version: cur?.version ?? 0 }) })
        if (r.status === 200) confirmados.push(item)
      } catch { /* el servidor murió: es parte del experimento */ }
    }
  }
  const obreros = Array.from({ length: 6 }, (_, w) => trabajador(w))
  await dormir(900)
  s.hijo.kill('SIGKILL')                                   // muerte brusca, sin cierre ordenado
  await s.fin
  await dormir(200)
  parar = true; await Promise.all(obreros)
  assert.ok(confirmados.length > 3, `la tormenta no llegó a escribir nada (${confirmados.length})`)

  // Reinicio: lo confirmado sigue ahí, la colección es coherente y la historia no tiene huecos
  s = await lanzar()
  const doc = (await (await fetch(`${s.base}/api/empresas/${id}/documentos`, { headers: H })).json()).empleados
  const claves = new Set(doc.datos.map(x => `${x.w}:${x.n}`))
  const perdidas = confirmados.filter(x => !claves.has(`${x.w}:${x.n}`))
  assert.deepEqual(perdidas, [], 'escrituras confirmadas al cliente que se perdieron tras la caída')
  assert.equal(claves.size, doc.datos.length, 'elementos duplicados tras la caída')
  // El historial se lee por la API (la RLS no deja leerlo sin contexto de empresa) y NO puede estar vacío.
  const hist = await (await fetch(`${s.base}/api/empresas/${id}/documentos/empleados/historial`, { headers: H })).json()
  const vs = hist.map(r => r.version).sort((a, b) => a - b)
  assert.ok(vs.length >= 3, `el historial no puede estar vacío tras una tormenta de escrituras (tiene ${vs.length})`)
  for (let i = 1; i < vs.length; i++) assert.equal(vs[i], vs[i - 1] + 1, `hueco en el historial entre ${vs[i - 1]} y ${vs[i]}`)
  assert.ok(vs[vs.length - 1] === doc.version - 1, 'el historial no termina justo antes de la versión vigente')
  s.hijo.kill('SIGTERM'); await s.fin
})
