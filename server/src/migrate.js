import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { pool } from './db.js'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql')

await pool.query(`CREATE TABLE IF NOT EXISTS migraciones (
  nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())`)
const hechas = new Set((await pool.query('SELECT nombre FROM migraciones')).rows.map(r => r.nombre))

for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  if (hechas.has(f)) continue
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(readFileSync(join(dir, f), 'utf8'))
    await client.query('INSERT INTO migraciones (nombre) VALUES ($1)', [f])
    await client.query('COMMIT')
    console.log('aplicada', f)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('falló', f, e.message)
    process.exitCode = 1
    break
  } finally {
    client.release()
  }
}
await pool.end()
