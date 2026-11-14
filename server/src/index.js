import Fastify from 'fastify'
import cors from '@fastify/cors'
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function buildApp({ projectId, origins, verify = verificarToken } = {}) {
  const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 })

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
      const e = await c.query(
        'INSERT INTO empresas (nombre, owner_uid) VALUES ($1, $2) RETURNING id', [nombre, uid])
      const empresaId = e.rows[0].id
      await c.query("SELECT set_config('app.empresa_id', $1, true)", [empresaId])
      await c.query(
        "INSERT INTO miembros (empresa_id, uid, email, rol) VALUES ($1, $2, $3, 'admin')",
        [empresaId, uid, email])
      return empresaId
    })
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
      if (datos === undefined || !Number.isInteger(version) || version < 0) {
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
      const r = await c.query(
        `UPDATE documentos SET datos = $1, version = version + 1,
                actualizado_en = now(), actualizado_por = $2
          WHERE empresa_id = $3 AND coleccion = $4 AND version = $5
          RETURNING version`,
        [JSON.stringify(datos), uid, empresaId, coleccion, version])
      if (!r.rowCount) return reply.code(409).send({ error: 'Conflicto de versión' })
      return { version: r.rows[0].version }
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
