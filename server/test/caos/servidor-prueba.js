// Servidor de prueba para los experimentos de caos de proceso (señales reales, SIGKILL).
// Usa la MISMA aplicación y el MISMO cierre ordenado que producción; solo cambia el verificador de
// tokens (acepta «uid:correo») para poder autenticarse sin Firebase. Nunca se usa fuera de las pruebas.
import { buildApp } from '../../src/index.js'
import { pool } from '../../src/db.js'
import { instalarCierreOrdenado } from '../../src/ciclo-vida.js'

const verify = async (t) => { const [uid, email] = t.split(':'); return { uid, email, emailVerified: true } }
const app = buildApp({
  projectId: 'x', origins: [], verify, logger: process.env.LOG === '1',
  superadmins: (process.env.SUPERADMINS ?? '').split(',').filter(Boolean),
  limites: { general: 1e6, escritura: 1e6, empresas: 1e6, correos: 5 }, limiteIp: 1e6,
})
instalarCierreOrdenado({ app, pool, plazoMs: Number(process.env.PLAZO_CIERRE_MS ?? 8000) })
await app.listen({ port: Number(process.env.PORT), host: '127.0.0.1' })
console.log('LISTO')
