import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { conContexto, pool } from './db.js'
import { verificarToken } from './auth.js'
import { crearEnviadorResend } from './correo.js'
import { crearConsultaConCache, rncValido, limpiarRnc } from './dgii.js'

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
    // La ventana más larga es de una hora (empresas, correos): no se borra antes.
    for (const [k, v] of cubos) if (!v.length || ahora - v[v.length - 1] > VENTANA_MAX_MS) cubos.delete(k)
  }, 60_000)
  t.unref()
  // `n` = unidades que consume la petición (p. ej. correos de un lote). Si el
  // lote no cabe, no se consume nada: se rechaza entero.
  return function excede(clave, max, ventanaMs, n = 1) {
    const ahora = Date.now()
    const arr = (cubos.get(clave) ?? []).filter(x => ahora - x < ventanaMs)
    const pasa = arr.length + n > max
    if (!pasa || n === 1) for (let i = 0; i < n; i++) arr.push(ahora)
    cubos.set(clave, arr)
    return pasa
  }
}

const VENTANA_MAX_MS = 3_600_000
const HISTORIAL_VERSIONES = 20
const MAX_EMPRESAS_POR_USUARIO = 3
const UID_OK = /^[A-Za-z0-9:_.@-]{1,128}$/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function buildApp({
  projectId, origins, verify = verificarToken,
  limites = { general: 240, escritura: 40, empresas: 5, correos: 600 }, logger = true,
  // Tope de peticiones por IP y minuto (incluye las que no traen token).
  limiteIp = 600,
  // Cuotas de almacenamiento: total por empresa (colecciones vigentes) y
  // tamaño del historial de versiones por colección.
  cuotas = { empresaBytes: 100 * 1024 * 1024, historialBytes: 30 * 1024 * 1024 },
  enviarCorreo = null,
  consultarRnc = crearConsultaConCache(),
  // Correos (verificados) de los super admin de la plataforma. Vienen de la
  // variable SUPERADMIN_EMAILS del servidor, nunca del código ni de la base.
  superadmins = [],
  // Transición: mientras el frontend no tenga la pantalla "sin empresa", un
  // usuario sin empresa puede seguir creando la suya. Apagar con
  // AUTOREGISTRO_EMPRESAS=false cuando las empresas se creen solo por el super admin.
  autoregistro = true,
} = {}) {
  const SUPER = new Set(superadmins.map(e => e.trim().toLowerCase()).filter(Boolean))
  const app = Fastify({
    logger: logger && { redact: ['req.headers.authorization', 'req.headers.cookie'] },
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: true,
  })
  const excede = crearLimitador()

  app.register(helmet, { global: true })
  // Tope por IP contra inundaciones (incluye peticiones sin token). La IP sale
  // de CF-Connecting-IP (la fija Cloudflare; X-Forwarded-For lo puede escribir
  // el cliente). Es una defensa gruesa; el límite fino es por usuario, abajo.
  // OJO: el plugin solo limita rutas declaradas DESPUÉS de cargarse; por eso
  // todas las rutas viven dentro del plugin `rutas`, registrado más abajo.
  app.register(rateLimit, {
    max: limiteIp, timeWindow: '1 minute',
    keyGenerator: (req) => String(req.headers['cf-connecting-ip'] ?? req.ip),
  })

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
    methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  })

  app.register(async function rutas(app) {

  // La comprobación de la base se reutiliza 5 s: /health es público y no debe
  // servir para agotar las conexiones del pool.
  let salud = { hasta: 0, promesa: null }
  app.get('/health', async () => {
    if (Date.now() > salud.hasta) {
      salud = { hasta: Date.now() + 5000, promesa: pool.query('SELECT 1') }
      salud.promesa.catch(() => { salud.hasta = 0 })
    }
    await salud.promesa
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
    req.user.esSuperadmin = !!req.user.email && SUPER.has(req.user.email.toLowerCase())
    const uid = req.user.uid
    const escribe = req.method === 'PUT' || req.method === 'POST' || req.method === 'DELETE'
    // La ruta se compara por su patrón, no por la URL cruda (que admite ?x=1).
    const ruta = req.routeOptions?.url
    const limitado =
      excede(`g:${uid}`, limites.general, 60_000) ||
      (escribe && excede(`w:${uid}`, limites.escritura, 60_000)) ||
      (req.method === 'POST' && ruta === '/api/empresas' && excede(`e:${uid}`, limites.empresas, 3_600_000))
    if (limitado) {
      reply.header('Retry-After', '60')
      return reply.code(429).send({ error: 'Demasiadas peticiones, espera un minuto' })
    }
  })

  const ctx = (req, extra = {}) => ({
    uid: req.user.uid, email: req.user.email, superadmin: req.user.esSuperadmin, ...extra,
  })

  app.get('/api/yo', async (req) => ({
    uid: req.user.uid, email: req.user.email, esSuperadmin: req.user.esSuperadmin,
  }))

  // Empresas a las que pertenece el usuario. Antes acepta las invitaciones
  // pendientes dirigidas a su correo (ya verificado por el token).
  app.get('/api/empresas', async (req) => {
    const { uid, email } = req.user
    return conContexto(ctx(req, { superadmin: false }), async (c) => {
      if (email) {
        const pend = await c.query(
          `SELECT id, empresa_id, rol FROM invitaciones
            WHERE email = $1 AND estado = 'pendiente' AND expira_en > now()`, [email.toLowerCase()])
        for (const inv of pend.rows) {
          await c.query(
            `INSERT INTO miembros (empresa_id, uid, email, rol) VALUES ($1, $2, $3, $4)
             ON CONFLICT (empresa_id, uid) DO NOTHING`, [inv.empresa_id, uid, email, inv.rol])
          await c.query("UPDATE invitaciones SET estado = 'aceptada' WHERE id = $1", [inv.id])
        }
      }
      const r = await c.query(
        `SELECT e.id, e.nombre, e.rnc, e.estado, m.rol
           FROM miembros m JOIN empresas e ON e.id = m.empresa_id
          WHERE m.uid = $1 ORDER BY e.creado_en`, [uid])
      return r.rows
    })
  })

  // Crea una empresa y deja al creador como admin.
  app.post('/api/empresas', async (req, reply) => {
    if (!autoregistro) return reply.code(403).send({ error: 'Las empresas las crea el administrador de Cielo' })
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

  // Registra que un super admin entró a una empresa ajena. Las lecturas se
  // deduplican 10 minutos; toda escritura se registra siempre.
  async function registrarAcceso(c, req, empresaId) {
    const accion = `${req.method} ${req.routeOptions?.url ?? req.url}${req.params.coleccion ? ':' + req.params.coleccion : ''}`
    if (req.method === 'GET') {
      const ya = await c.query(
        `SELECT 1 FROM accesos_log WHERE empresa_id = $1 AND uid = $2 AND accion = $3
            AND creado_en > now() - interval '10 minutes' LIMIT 1`, [empresaId, req.user.uid, accion])
      if (ya.rowCount) return
    }
    await c.query(
      'INSERT INTO accesos_log (empresa_id, uid, email, accion) VALUES ($1, $2, $3, $4)',
      [empresaId, req.user.uid, req.user.email, accion])
  }

  // Resuelve la empresa de la URL y confirma que el usuario es miembro. El
  // super admin entra a cualquier empresa (con rol admin) y queda registrado.
  async function conEmpresa(req, reply, fn) {
    const empresaId = req.params.empresaId
    if (!UUID.test(empresaId)) return reply.code(400).send({ error: 'empresaId inválido' })
    const { uid, esSuperadmin } = req.user
    return conContexto(ctx(req, { empresaId }), async (c) => {
      if (esSuperadmin) {
        const e = await c.query('SELECT 1 FROM empresas WHERE id = $1', [empresaId])
        if (!e.rowCount) return reply.code(404).send({ error: 'No encontrado' })
        await registrarAcceso(c, req, empresaId)
        return fn(c, 'admin')
      }
      const m = await c.query(
        `SELECT m.rol, e.estado FROM miembros m JOIN empresas e ON e.id = m.empresa_id
          WHERE m.empresa_id = $1 AND m.uid = $2`, [empresaId, uid])
      if (!m.rowCount) return reply.code(403).send({ error: 'Sin acceso a esta empresa' })
      if (m.rows[0].estado === 'suspendida') return reply.code(403).send({ error: 'Empresa suspendida — contacta a Cielo' })
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
      const json = JSON.stringify(datos)
      // Cuota por empresa: lo ya guardado en las demás colecciones + lo que llega.
      const uso = await c.query(
        `SELECT COALESCE(sum(pg_column_size(datos)), 0)::bigint AS bytes FROM documentos
          WHERE empresa_id = $1 AND coleccion <> $2`, [empresaId, coleccion])
      if (Number(uso.rows[0].bytes) + Buffer.byteLength(json) > cuotas.empresaBytes) {
        return reply.code(413).send({ error: 'La empresa alcanzó su límite de almacenamiento — contacta a Cielo' })
      }
      if (version === 0) {
        const r = await c.query(
          `INSERT INTO documentos (empresa_id, coleccion, datos, actualizado_por)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (empresa_id, coleccion) DO NOTHING RETURNING version`,
          [empresaId, coleccion, json, uid])
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
        [json, uid, empresaId, coleccion, version])
      const nueva = r.rows[0].version
      await c.query(
        'DELETE FROM documentos_historial WHERE empresa_id = $1 AND coleccion = $2 AND version <= $3',
        [empresaId, coleccion, nueva - HISTORIAL_VERSIONES])
      // Además del tope de versiones, el historial tiene tope de tamaño: se
      // borran las más viejas que no quepan (la más reciente se conserva siempre).
      await c.query(
        `DELETE FROM documentos_historial h USING (
           SELECT version,
                  sum(pg_column_size(datos)) OVER (ORDER BY version DESC) AS acum,
                  row_number() OVER (ORDER BY version DESC) AS n
             FROM documentos_historial WHERE empresa_id = $1 AND coleccion = $2) s
          WHERE h.empresa_id = $1 AND h.coleccion = $2 AND h.version = s.version
            AND s.n > 1 AND s.acum > $3`,
        [empresaId, coleccion, cuotas.historialBytes])
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

  // Envía comprobantes de pago por correo desde la cuenta del sistema. El
  // destinatario NUNCA viene del cliente: se toma del correo del empleado ya
  // guardado en la empresa, para que la API no sirva de relé de spam.
  const MAX_ITEMS_ENVIO = 50
  const MAX_PDF_B64 = 1_500_000
  app.post('/api/empresas/:empresaId/comprobantes/enviar', (req, reply) =>
    conEmpresa(req, reply, async (c, rol) => {
      if (!ROLES_ESCRITURA.has(rol)) return reply.code(403).send({ error: 'Rol sin permiso' })
      if (!enviarCorreo) return reply.code(503).send({ error: 'El envío de correo no está configurado' })
      const items = req.body?.items
      if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS_ENVIO) {
        return reply.code(400).send({ error: `Envía entre 1 y ${MAX_ITEMS_ENVIO} comprobantes por petición` })
      }
      // Cada comprobante cuenta como un correo dentro de la ventana de una hora.
      if (excede(`m:${req.user.uid}`, limites.correos ?? 600, 3_600_000, items.length)) {
        reply.header('Retry-After', '3600')
        return reply.code(429).send({ error: 'Límite de correos por hora alcanzado' })
      }
      const doc = await c.query(
        "SELECT datos FROM documentos WHERE empresa_id = $1 AND coleccion = 'empleados'", [req.params.empresaId])
      const empleados = Array.isArray(doc.rows[0]?.datos) ? doc.rows[0].datos : []
      const porId = new Map(empleados.filter(e => e && typeof e === 'object').map(e => [String(e.id), e]))
      const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/

      const resultados = []
      const cola = [...items]
      async function trabajador() {
        for (let it = cola.shift(); it; it = cola.shift()) {
          const empleadoId = String(it?.empleadoId ?? '')
          const fallo = (error) => resultados.push({ empleadoId, ok: false, error })
          const emp = porId.get(empleadoId)
          const pdf = typeof it?.pdfBase64 === 'string' ? it.pdfBase64 : ''
          if (!emp) { fallo('Empleado no encontrado'); continue }
          if (!EMAIL.test(emp.email ?? '') || emp.email.length > 254) { fallo('Empleado sin correo válido'); continue }
          if (typeof it.asunto !== 'string' || typeof it.cuerpo !== 'string' || !it.asunto.trim() || !it.cuerpo.trim()) { fallo('Asunto o cuerpo vacío'); continue }
          if (!/^[A-Za-z0-9+/=]+$/.test(pdf) || pdf.length > MAX_PDF_B64 || !pdf.startsWith('JVBER')) { fallo('PDF inválido'); continue }
          try {
            await enviarCorreo({
              to: emp.email,
              subject: it.asunto.replace(/[\r\n]+/g, ' ').slice(0, 200),
              text: it.cuerpo.slice(0, 5000),
              attachments: [{ filename: 'comprobante-de-pago.pdf', content: pdf }],
            })
            resultados.push({ empleadoId, ok: true })
          } catch (e) {
            req.log.error({ err: e, detalle: e.detalle }, 'fallo al enviar correo')
            fallo('No se pudo enviar')
          }
        }
      }
      await Promise.all(Array.from({ length: 4 }, trabajador))
      return { resultados }
    }))

  // Validación de RNC contra la DGII. Cualquier usuario autenticado (también en
  // el asistente de su primera empresa); límite propio por usuario.
  app.get('/api/dgii/rnc/:rnc', async (req, reply) => {
    const rnc = limpiarRnc(req.params.rnc)
    if (!rncValido(rnc)) return reply.code(400).send({ error: 'RNC inválido: revisa los dígitos (9 para empresa, 11 para cédula)' })
    if (excede(`d:${req.user.uid}`, limites.dgii ?? 20, 60_000)) {
      reply.header('Retry-After', '60')
      return reply.code(429).send({ error: 'Demasiadas consultas, espera un minuto' })
    }
    try {
      return await consultarRnc(rnc)
    } catch (e) {
      req.log.warn({ err: e }, 'consulta DGII fallida')
      return reply.code(502).send({ error: 'No se pudo consultar la DGII en este momento' })
    }
  })

  // ── Administración de la plataforma (solo super admin) ────────────────────
  const soloSuper = (req, reply) => {
    if (req.user.esSuperadmin) return false
    reply.code(404).send({ error: 'No encontrado' })   // no revela que la ruta existe
    return true
  }
  const normRnc = (v) => String(v ?? '').replace(/[\s-]/g, '')
  const RNC_OK = /^([0-9]{9}|[0-9]{11})$/
  const ROLES = new Set(['admin', 'gerente', 'rrhh', 'contador'])
  const unico = (err) => err?.code === '23505'

  app.get('/api/admin/empresas', async (req, reply) => {
    if (soloSuper(req, reply)) return
    const q = String(req.query?.q ?? '').trim().slice(0, 100).replace(/[\\%_]/g, m => '\\' + m)
    return conContexto(ctx(req), async (c) => (await c.query(
      `SELECT e.id, e.nombre, e.rnc, e.estado, e.creado_en,
              (SELECT count(*)::int FROM miembros m WHERE m.empresa_id = e.id) AS miembros
         FROM empresas e
        WHERE $1 = '' OR e.nombre ILIKE '%' || $1 || '%' OR e.rnc LIKE $1 || '%'
        ORDER BY e.creado_en DESC LIMIT 200`, [q])).rows)
  })

  app.post('/api/admin/empresas', async (req, reply) => {
    if (soloSuper(req, reply)) return
    const nombre = String(req.body?.nombre ?? '').trim().slice(0, 200)
    const rnc = normRnc(req.body?.rnc)
    if (!nombre) return reply.code(400).send({ error: 'Falta el nombre' })
    if (!RNC_OK.test(rnc)) return reply.code(400).send({ error: 'RNC inválido (9 dígitos; 11 si es cédula)' })
    try {
      const r = await conContexto(ctx(req), (c) => c.query(
        'INSERT INTO empresas (nombre, rnc, owner_uid) VALUES ($1, $2, $3) RETURNING id, nombre, rnc, estado',
        [nombre, rnc, req.user.uid]))
      return reply.code(201).send(r.rows[0])
    } catch (e) {
      if (unico(e)) return reply.code(409).send({ error: 'Ya existe una empresa con ese RNC' })
      throw e
    }
  })

  app.put('/api/admin/empresas/:empresaId', async (req, reply) => {
    if (soloSuper(req, reply)) return
    if (!UUID.test(req.params.empresaId)) return reply.code(400).send({ error: 'empresaId inválido' })
    const { estado, nombre } = req.body ?? {}
    const rnc = req.body?.rnc === undefined ? undefined : normRnc(req.body.rnc)
    if (estado !== undefined && !['activa', 'suspendida'].includes(estado)) return reply.code(400).send({ error: 'Estado inválido' })
    if (rnc !== undefined && !RNC_OK.test(rnc)) return reply.code(400).send({ error: 'RNC inválido (9 dígitos; 11 si es cédula)' })
    if (nombre !== undefined && !String(nombre).trim()) return reply.code(400).send({ error: 'Nombre vacío' })
    try {
      const r = await conContexto(ctx(req), (c) => c.query(
        `UPDATE empresas SET estado = COALESCE($2, estado), nombre = COALESCE($3, nombre), rnc = COALESCE($4, rnc)
          WHERE id = $1 RETURNING id, nombre, rnc, estado`,
        [req.params.empresaId, estado ?? null, nombre === undefined ? null : String(nombre).trim().slice(0, 200), rnc ?? null]))
      return r.rowCount ? r.rows[0] : reply.code(404).send({ error: 'No encontrado' })
    } catch (e) {
      if (unico(e)) return reply.code(409).send({ error: 'Ya existe una empresa con ese RNC' })
      throw e
    }
  })

  app.get('/api/admin/empresas/:empresaId/invitaciones', async (req, reply) => {
    if (soloSuper(req, reply)) return
    if (!UUID.test(req.params.empresaId)) return reply.code(400).send({ error: 'empresaId inválido' })
    return conContexto(ctx(req, { empresaId: req.params.empresaId }), async (c) => ({
      invitaciones: (await c.query(
        `SELECT id, email, rol, estado, creado_en, expira_en FROM invitaciones
          WHERE empresa_id = $1 ORDER BY creado_en DESC`, [req.params.empresaId])).rows,
      miembros: (await c.query(
        'SELECT uid, email, rol, creado_en FROM miembros WHERE empresa_id = $1 ORDER BY creado_en', [req.params.empresaId])).rows,
    }))
  })

  app.post('/api/admin/empresas/:empresaId/invitaciones', async (req, reply) => {
    if (soloSuper(req, reply)) return
    if (!UUID.test(req.params.empresaId)) return reply.code(400).send({ error: 'empresaId inválido' })
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const rol = req.body?.rol
    if (!/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(email) || email.length > 254) return reply.code(400).send({ error: 'Correo inválido' })
    if (!ROLES.has(rol)) return reply.code(400).send({ error: 'Rol inválido' })
    try {
      const r = await conContexto(ctx(req, { empresaId: req.params.empresaId }), async (c) => {
        const e = await c.query('SELECT 1 FROM empresas WHERE id = $1', [req.params.empresaId])
        if (!e.rowCount) return null
        return c.query(
          `INSERT INTO invitaciones (empresa_id, email, rol, creado_por) VALUES ($1, $2, $3, $4)
           RETURNING id, email, rol, estado, expira_en`, [req.params.empresaId, email, rol, req.user.uid])
      })
      return r ? reply.code(201).send(r.rows[0]) : reply.code(404).send({ error: 'No encontrado' })
    } catch (e) {
      if (unico(e)) return reply.code(409).send({ error: 'Ya hay una invitación pendiente para ese correo' })
      throw e
    }
  })

  app.post('/api/admin/empresas/:empresaId/invitaciones/:id/revocar', async (req, reply) => {
    if (soloSuper(req, reply)) return
    if (!UUID.test(req.params.empresaId) || !UUID.test(req.params.id)) return reply.code(400).send({ error: 'Id inválido' })
    const r = await conContexto(ctx(req, { empresaId: req.params.empresaId }), (c) => c.query(
      "UPDATE invitaciones SET estado = 'revocada' WHERE id = $1 AND empresa_id = $2 AND estado = 'pendiente' RETURNING id",
      [req.params.id, req.params.empresaId]))
    return r.rowCount ? { ok: true } : reply.code(404).send({ error: 'No encontrado' })
  })

  // Quitar a una persona de una empresa o cambiarle el rol. Queda registrado.
  // Las invitaciones pendientes de ese correo se revocan para que no vuelva a entrar.
  const miembroInvalido = (req) => !UUID.test(req.params.empresaId) || !UID_OK.test(req.params.uid)

  app.delete('/api/admin/empresas/:empresaId/miembros/:uid', async (req, reply) => {
    if (soloSuper(req, reply)) return
    if (miembroInvalido(req)) return reply.code(400).send({ error: 'Id inválido' })
    const { empresaId, uid } = req.params
    const ok = await conContexto(ctx(req, { empresaId }), async (c) => {
      const r = await c.query(
        'DELETE FROM miembros WHERE empresa_id = $1 AND uid = $2 RETURNING email', [empresaId, uid])
      if (!r.rowCount) return false
      const email = r.rows[0].email
      if (email) {
        await c.query(
          "UPDATE invitaciones SET estado = 'revocada' WHERE empresa_id = $1 AND email = $2 AND estado = 'pendiente'",
          [empresaId, email.toLowerCase()])
      }
      await c.query(
        'INSERT INTO accesos_log (empresa_id, uid, email, accion) VALUES ($1, $2, $3, $4)',
        [empresaId, req.user.uid, req.user.email, `QUITAR MIEMBRO ${email ?? uid}`.slice(0, 300)])
      return true
    })
    return ok ? { ok: true } : reply.code(404).send({ error: 'No encontrado' })
  })

  app.put('/api/admin/empresas/:empresaId/miembros/:uid', async (req, reply) => {
    if (soloSuper(req, reply)) return
    if (miembroInvalido(req)) return reply.code(400).send({ error: 'Id inválido' })
    const rol = req.body?.rol
    if (!ROLES.has(rol)) return reply.code(400).send({ error: 'Rol inválido' })
    const { empresaId, uid } = req.params
    const fila = await conContexto(ctx(req, { empresaId }), async (c) => {
      const r = await c.query(
        'UPDATE miembros SET rol = $3 WHERE empresa_id = $1 AND uid = $2 RETURNING uid, email, rol', [empresaId, uid, rol])
      if (!r.rowCount) return null
      await c.query(
        'INSERT INTO accesos_log (empresa_id, uid, email, accion) VALUES ($1, $2, $3, $4)',
        [empresaId, req.user.uid, req.user.email, `CAMBIAR ROL ${r.rows[0].email ?? uid} -> ${rol}`.slice(0, 300)])
      return r.rows[0]
    })
    return fila ?? reply.code(404).send({ error: 'No encontrado' })
  })

  app.get('/api/admin/accesos', async (req, reply) => {
    if (soloSuper(req, reply)) return
    const empresaId = req.query?.empresaId
    if (empresaId !== undefined && !UUID.test(empresaId)) return reply.code(400).send({ error: 'empresaId inválido' })
    return conContexto(ctx(req), async (c) => (await c.query(
      `SELECT l.id, l.empresa_id, e.nombre AS empresa, e.rnc, l.email, l.accion, l.creado_en
         FROM accesos_log l JOIN empresas e ON e.id = l.empresa_id
        WHERE $1::uuid IS NULL OR l.empresa_id = $1::uuid
        ORDER BY l.creado_en DESC LIMIT 200`, [empresaId ?? null])).rows)
  })

  })   // fin del plugin `rutas`

  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (!projectId) throw new Error('Falta FIREBASE_PROJECT_ID')
  const origins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const enviarCorreo = crearEnviadorResend({ apiKey: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM })
  const superadmins = (process.env.SUPERADMIN_EMAILS ?? '').split(',')
  const autoregistro = (process.env.AUTOREGISTRO_EMPRESAS ?? 'true') !== 'false'
  const app = buildApp({ projectId, origins, enviarCorreo, superadmins, autoregistro })
  await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' })
}
