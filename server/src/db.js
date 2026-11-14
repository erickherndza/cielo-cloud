import pg from 'pg'

const { DATABASE_URL, DATABASE_CA_CERT } = process.env

// DigitalOcean Managed PostgreSQL exige TLS. Con DATABASE_CA_CERT (el
// certificado de CA del panel de la base) se valida el servidor; sin él, solo
// se acepta en desarrollo local.
function sslConfig() {
  if (DATABASE_CA_CERT) return { ca: DATABASE_CA_CERT, rejectUnauthorized: true }
  if (/sslmode=require/.test(DATABASE_URL ?? '')) return { rejectUnauthorized: false }
  return undefined
}

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig(),
  max: 10,
})

// Ejecuta fn dentro de una transacción con el contexto de seguridad fijado
// (set_config local a la transacción): las políticas RLS leen estos valores.
export async function conContexto({ uid, empresaId }, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.uid', $1, true)", [uid])
    await client.query("SELECT set_config('app.empresa_id', $1, true)", [empresaId ?? ''])
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
