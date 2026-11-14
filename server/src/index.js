import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { conContexto, pool } from './db.js'
import { verificarToken } from './auth.js'

// Colecciones que el frontend puede sincronizar (las mismas claves que hoy
// usa localStorage, sin el prefijo `cielo-`). Todo lo demás se rechaza.
export const COLECCIONES = new Set([
  'empresa', 'empleados', 'periodos', 'prestamos', 'aumentos', 'licencias',
  'bandas-salariales', 'liquidaciones', 'saldo-isr', 'feriados',
  'disfrutes-vacaciones', 'retribuciones-complementarias',
  'conceptos-personalizados', 'agenda-custom', 'agenda-done',
])

// Matriz de roles pendiente de definir con el cliente (gerente / RRHH /
// contador). Fase 1: todo miembro puede leer y escribir. Cuando exista la
// matriz, restringir aquí en un solo lugar.
const ROLES_ESCRITURA = new Set(['admin', 'gerente', 'rrhh', 'contador'])

// Limitador de ventana deslizante en memoria, por usuario VERIFICADO (la clave
// es el uid del token ya validado, no una cabecera que el cliente pueda falsear).
// Una sola instancia de la API: suficiente; con varias habría que moverlo a Redis.
function crearLimitador() {
  const cubos = new Map()
  const t = setInterval(() => {
    const ahora = Date.now()
    for (const [k, v] of cubos) if (!v.length || ahora - v[v.length - 1] > 120_000) cubos.delete(k)
  }, 60_000)
  t.unref()
  return function excede(clave, max, ventanaMs) {
    const ahora = Date.now()
    const arr = (cubos.get(clave) ?? []).filter(x => ahora - x < ventanaMs)
    arr.push(ahora)
    cubos.set(clave, arr)
    return arr.length > max
  }
}

const HISTORIAL_VERSIONES = 20
const MAX_EMPRESAS_POR_USUARIO = 10

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function buildApp({
  projectId, origins, verify = verificarToken,
  limites = { general: 240, escritura: 40, empresas: 5 }, logger = true,
} = {}) {
  const app = Fastify({
    logger: logger && { redact: ['req.headers.authorization', 'req.headers.cookie'] },
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: true,
  })
  const excede = crearLimitador()

  app.register(helmet, { global: true })
  // Tope por IP contra inundaciones (incluye peticiones sin token). Con
  // trustProxy la IP sale de X-Forwarded-For: es una defensa gruesa; el límite
  // fino es por usuario verificado, más abajo.
  app.register(rateLimit, { max: 600, timeWindow: '1 minute' })

  app.setErrorHandler((err, req, reply) => {
    const code = err.statusCode ?? 500
    if (code >= 500) {
      req.log.error({ err }, 'error interno')
      return reply.code(500).send({ error: 'Error interno' })
    }
    return reply.code(code).send({ error: code === 429 ? 'Demasiadas peticiones' : (err.message || 'Petición inválida') })
  })
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'No encontrado' }))

  app.register(cors, {
    origin: origins?.length ? origins : false,
    methods: ['GET', 'PUT', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  })

  app.get('/health', async () => {
    await pool.query('SELECT 1')
    return { ok: true }
  })

  // Todas las rutas /api exigen un ID token de Firebase válido.
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return
    const h = req.headers.authorization ?? ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : ''
    if (!token) return reply.code(401).send({ error: 'No autenticado' })
    try {
      req.user = await verify(token, projectId)
    } catch {
      return reply.code(401).send({ error: 'Token inválido' })
    }
    if (!req.user.emailVerified) {
      return reply.code(403).send({ error: 'Verifica tu correo para usar la plataforma' })
    }
    const uid = req.user.uid
    const escribe = req.method === 'PUT' || req.method === 'POST'
    const limitado =
      excede(`g:${uid}`, limites.general, 60_000) ||
      (escribe && excede(`w:${uid}`, limites.escritura, 60_000)) ||
      (req.method === 'POST' && req.url === '/api/empresas' && excede(`e:${uid}`, limites.empresas, 3_600_000))
    if (limitado) {
      reply.header('Retry-After', '60')
      return reply.code(429).send({ error: 'Demasiadas peticiones, espera un minuto' })
    }
  })

  // Empresas a las que pertenece el usuario.
  app.get('/api/empresas', async (req) => {
    const { uid } = req.user
    return conContexto({ uid }, async (c) => {
      const r = await c.query(
        `SELECT e.id, e.nombre, m.rol
           FROM miembros m JOIN empresas e ON e.id = m.empresa_id
          WHERE m.uid = $1 ORDER BY e.creado_en`, [uid])
      return r.rows
    })
  })

  // Crea una empresa y deja al creador como admin.
  app.post('/api/empresas', async (req, reply) => {
    const { uid, email } = req.user
    const nombre = String(req.body?.nombre ?? '').slice(0, 200)
    const id = await conContexto({ uid }, async (c) => {
      const n = await c.query('SELECT count(*)::int AS n FROM empresas WHERE owner_uid = $1', [uid])
      if (n.rows[0].n >= MAX_EMPRESAS_POR_USUARIO) return null
      const e = await c.query(
        'INSERT INTO empresas (nombre, owner_uid) VALUES ($1, $2) RETURNING id', [nombre, uid])
      const empresaId = e.rows[0].id
      await c.query("SELECT set_config('app.empresa_id', $1, true)", [empresaId])
      await c.query(
        "INSERT INTO miembros (empresa_id, uid, email, rol) VALUES ($1, $2, $3, 'admin')",
        [empresaId, uid, email])
      return empresaId
    })
    if (!id) return reply.code(409).send({ error: 'Límite de empresas alcanzado' })
    return reply.code(201).send({ id, nombre, rol: 'admin' })
  })

  // Resuelve la empresa de la URL y confirma que el usuario es miembro.
  async function conEmpresa(req, reply, fn) {
    const empresaId = req.params.empresaId
    if (!UUID.test(empresaId)) return reply.code(400).send({ error: 'empresaId inválido' })
    const { uid } = req.user
    return conContexto({ uid, empresaId }, async (c) => {
      const m = await c.query(
        'SELECT rol FROM miembros WHERE empresa_id = $1 AND uid = $2', [empresaId, uid])
      if (!m.rowCount) return reply.code(403).send({ error: 'Sin acceso a esta empresa' })
      return fn(c, m.rows[0].rol)
    })
  }

  // Carga masiva: todas las colecciones de la empresa en una sola petición.
  app.get('/api/empresas/:empresaId/documentos', (req, reply) =>
    conEmpresa(req, reply, async (c) => {
      const r = await c.query(
        'SELECT coleccion, datos, version FROM documentos WHERE empresa_id = $1',
        [req.params.empresaId])
      const out = {}
      for (const row of r.rows) out[row.coleccion] = { datos: row.datos, version: row.version }
      return out
    }))

  // Guarda una colección completa con control de concurrencia optimista:
  // `version` debe coincidir con la guardada (0 = no existe todavía), si no 409.
  app.put('/api/empresas/:empresaId/documentos/:coleccion', (req, reply) =>
    conEmpresa(req, reply, async (c, rol) => {
      const { coleccion, empresaId } = req.params
      if (!COLECCIONES.has(coleccion)) return reply.code(400).send({ error: 'Colección no permitida' })
      if (!ROLES_ESCRITURA.has(rol)) return reply.code(403).send({ error: 'Rol sin permiso de escritura' })
      const { datos, version } = req.body ?? {}
      const esEstructura = datos !== null && typeof datos === 'object'   // array u objeto, no primitivos
      if (!esEstructura || !Number.isInteger(version) || version < 0) {
        return reply.code(400).send({ error: 'Cuerpo inválido' })
      }
      const uid = req.user.uid
      if (version === 0) {
        const r = await c.query(
          `INSERT INTO documentos (empresa_id, coleccion, datos, actualizado_por)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (empresa_id, coleccion) DO NOTHING RETURNING version`,
          [empresaId, coleccion, JSON.stringify(datos), uid])
        if (!r.rowCount) return reply.code(409).send({ error: 'Conflicto de versión' })
        return { version: r.rows[0].version }
      }
      // 1) bloquea la fila de la versión esperada; 2) la archiva; 3) actualiza.
      // Todo en la misma transacción de conContexto: si algo falla, no queda nada a medias.
      const lock = await c.query(
        `SELECT 1 FROM documentos
          WHERE empresa_id = $1 AND coleccion = $2 AND version = $3 FOR UPDATE`,
        [empresaId, coleccion, version])
      if (!lock.rowCount) return reply.code(409).send({ error: 'Conflicto de versión' })
      await c.query(
        `INSERT INTO documentos_historial
                (empresa_id, coleccion, version, datos, actualizado_en, actualizado_por)
         SELECT empresa_id, coleccion, version, datos, actualizado_en, actualizado_por
           FROM documentos WHERE empresa_id = $1 AND coleccion = $2 AND version = $3
         ON CONFLICT DO NOTHING`,
        [empresaId, coleccion, version])
      const r = await c.query(
        `UPDATE documentos SET datos = $1, version = version + 1,
                actualizado_en = now(), actualizado_por = $2
          WHERE empresa_id = $3 AND coleccion = $4 AND version = $5
          RETURNING version`,
        [JSON.stringify(datos), uid, empresaId, coleccion, version])
      const nueva = r.rows[0].version
      await c.query(
        'DELETE FROM documentos_historial WHERE empresa_id = $1 AND coleccion = $2 AND version <= $3',
        [empresaId, coleccion, nueva - HISTORIAL_VERSIONES])
      return { version: nueva }
    }))

  // Lista las versiones guardadas de una colección (para recuperar un error).
  app.get('/api/empresas/:empresaId/documentos/:coleccion/historial', (req, reply) =>
    conEmpresa(req, reply, async (c) => {
      const { coleccion, empresaId } = req.params
      if (!COLECCIONES.has(coleccion)) return reply.code(400).send({ error: 'Colección no permitida' })
      const r = await c.query(
        `SELECT version, actualizado_en, actualizado_por, pg_column_size(datos) AS bytes
           FROM documentos_historial WHERE empresa_id = $1 AND coleccion = $2
          ORDER BY version DESC`, [empresaId, coleccion])
      return r.rows
    }))

  // Devuelve el contenido de una versión anterior.
  app.get('/api/empresas/:empresaId/documentos/:coleccion/historial/:version', (req, reply) =>
    conEmpresa(req, reply, async (c) => {
      const { coleccion, empresaId, version } = req.params
      const v = Number(version)
      if (!COLECCIONES.has(coleccion) || !Number.isInteger(v)) return reply.code(400).send({ error: 'Petición inválida' })
      const r = await c.query(
        `SELECT version, datos, actualizado_en, actualizado_por FROM documentos_historial
          WHERE empresa_id = $1 AND coleccion = $2 AND version = $3`, [empresaId, coleccion, v])
      return r.rowCount ? r.rows[0] : reply.code(404).send({ error: 'No encontrado' })
    }))

  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (!projectId) throw new Error('Falta FIREBASE_PROJECT_ID')
  const origins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const app = buildApp({ projectId, origins })
  await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' })
}
