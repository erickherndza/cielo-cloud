import pg from 'pg'

const { DATABASE_URL, DATABASE_CA_CERT } = process.env

// DigitalOcean Managed PostgreSQL exige TLS. Con DATABASE_CA_CERT (el
// certificado de CA del panel de la base) se valida el servidor; sin él, solo
// se acepta en desarrollo local.
function sslConfig() {
  if (DATABASE_CA_CERT) return { ca: DATABASE_CA_CERT, rejectUnauthorized: true }
  if (/sslmode=/.test(DATABASE_URL ?? '')) {
    // En producción nunca se acepta un servidor sin verificar (suplantación).
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_CA_CERT es obligatorio en producción')
    }
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

export const pool = new pg.Pool({
  connectionString: urlSinSslmode(DATABASE_URL),
  ssl: sslConfig(),
  max: 10,
})

// Ejecuta fn dentro de una transacción con el contexto de seguridad fijado
// (set_config local a la transacción): las políticas RLS leen estos valores.
export async function conContexto({ uid, empresaId, email, superadmin }, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.uid', $1, true)", [uid])
    await client.query("SELECT set_config('app.empresa_id', $1, true)", [empresaId ?? ''])
    // Solo la API (tras verificar el token) puede fijar estos dos valores.
    await client.query("SELECT set_config('app.email', $1, true)", [(email ?? '').toLowerCase()])
    await client.query("SELECT set_config('app.superadmin', $1, true)", [superadmin ? 'on' : 'off'])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
