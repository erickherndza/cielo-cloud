import pg from 'pg'

const { DATABASE_URL, DATABASE_CA_CERT } = process.env

// DigitalOcean Managed PostgreSQL exige TLS. Con DATABASE_CA_CERT (el
// certificado de CA del panel de la base) se valida el servidor; sin él, solo
// se acepta en desarrollo local.
function sslConfig() {
  if (DATABASE_CA_CERT) return { ca: DATABASE_CA_CERT, rejectUnauthorized: true }
  // En producción nunca se acepta un servidor sin verificar (suplantación), ni una conexión sin TLS,
  // aunque la URL no traiga `sslmode`.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_CA_CERT es obligatorio en producción')
  }
  if (/sslmode=/.test(DATABASE_URL ?? '')) {
    console.warn('[db] DATABASE_CA_CERT no definido: TLS cifrado pero sin verificar el servidor')
    return { rejectUnauthorized: false }
  }
  return undefined
}

// `sslmode` en la URL tiene prioridad sobre la opción `ssl` de pg y fuerza
// verificación completa; se quita para que mande sslConfig().
function urlSinSslmode(url) {
  if (!url) return url
  const u = new URL(url)
  u.searchParams.delete('sslmode')
  return u.toString()
}

// Tiempos límite: sin ellos, una base que no responde deja las peticiones colgadas para siempre
// y agota el pool. Se pueden ajustar por entorno (las pruebas de caos los acortan).
const num = (v, def) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : def)

export const pool = new pg.Pool({
  connectionString: urlSinSslmode(DATABASE_URL),
  ssl: sslConfig(),
  max: 10,
  connectionTimeoutMillis: num(process.env.DB_CONNECT_TIMEOUT_MS, 5_000),   // esperar una conexión: máx. 5 s
  idleTimeoutMillis: 30_000,                                                  // cierra las inactivas
  query_timeout: num(process.env.DB_QUERY_TIMEOUT_MS, 25_000),               // red tragándose paquetes a mitad de consulta
  keepAlive: true,
  application_name: 'cielo-api',
})

// Una conexión INACTIVA que muere (reinicio de la base, corte de red) emite 'error' en el pool; sin
// este manejador Node lo trata como excepción no capturada y tumba todo el proceso.
pool.on('error', (err) => {
  console.error('[db] conexión inactiva perdida (el pool la descarta):', err.message)
})

/** ¿El error viene de la infraestructura (base caída, red, saturación) y no de una consulta incorrecta? */
export function esFallaDeInfraestructura(err) {
  if (!err) return false
  const codigo = String(err.code ?? '')
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'].includes(codigo)) return true
  // Clase 08 (conexión), 53 (recursos insuficientes), 57P01-57P03 (la base se apaga o reinicia)
  if (/^(08|53)/.test(codigo) || ['57P01', '57P02', '57P03'].includes(codigo)) return true
  return /timeout exceeded when trying to connect|Connection terminated|Client has encountered a connection error|Query read timeout|connection timeout|the database system is (starting up|shutting down)/i.test(String(err.message ?? ''))
}

// Ejecuta fn dentro de una transacción con el contexto de seguridad fijado
// (set_config local a la transacción): las políticas RLS leen estos valores.
export async function conContexto({ uid, empresaId, email, superadmin }, fn) {
  const client = await pool.connect()
  let fallo = false
  // Una conexión puede morir MIENTRAS está en uso (entre dos consultas): pg emite 'error' en el cliente y,
  // sin un oyente, Node lo trata como excepción no capturada y tumba el proceso. Se marca como rota y se destruye.
  const alError = () => { fallo = true }
  client.on('error', alError)
  try {
    await client.query('BEGIN')
    // Un solo viaje a la base para fijar el contexto (antes eran cuatro): con latencia de red, cada viaje
    // extra multiplica el tiempo que la conexión está ocupada y satura el pool.
    // Solo la API (tras verificar el token) puede fijar estos valores; las políticas RLS los leen.
    await client.query(
      `SELECT set_config('app.uid', $1, true), set_config('app.empresa_id', $2, true),
              set_config('app.email', $3, true), set_config('app.superadmin', $4, true)`,
      [uid, empresaId ?? '', (email ?? '').toLowerCase(), superadmin ? 'on' : 'off'])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    // Una conexión rota o colgada no debe volver al pool: se destruye (release(true)).
    if (esFallaDeInfraestructura(err)) fallo = true
    throw err
  } finally {
    client.removeListener('error', alError)
    client.release(fallo)
  }
}
