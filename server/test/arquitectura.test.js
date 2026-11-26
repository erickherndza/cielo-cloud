// Fitness functions de arquitectura: reglas que deben cumplirse SIEMPRE.
// Corren en CI en cada cambio; si una falla, el cambio no se publica.
// Reglas de origen: secure.md (Parte 1) y CLAUDE.md.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../src/index.js'
import { pool } from '../src/db.js'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
test.after(async () => { await pool.end() })

function archivos(dir, exts, acc = []) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name)
    if (n.isDirectory()) { if (!['node_modules', '.next', 'out'].includes(n.name)) archivos(p, exts, acc) }
    else if (exts.some(e => n.name.endsWith(e))) acc.push(p)
  }
  return acc
}
const rel = (p) => path.relative(RAIZ, p)
// Quita comentarios para no contar menciones en texto.
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// ── Base de datos ─────────────────────────────────────────────────────────────
// Tablas públicas que NO son de una empresa (catálogos globales). Cualquier otra
// tabla nueva debe tener RLS forzada o esta prueba falla.
const TABLAS_GLOBALES = new Set(['parametros_legales', 'migraciones']) // catálogos globales y control de migraciones (sin datos de empresa)

test('toda tabla de empresa tiene RLS activada y forzada', async () => {
  const { rows } = await pool.query(`
    SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzada
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'`)
  assert.ok(rows.length >= 8, 'no se leyó el catálogo de tablas')
  const mal = rows.filter(r => !TABLAS_GLOBALES.has(r.relname) && !(r.rls && r.forzada)).map(r => r.relname)
  assert.deepEqual(mal, [], `tablas sin RLS forzada: ${mal.join(', ')}`)
})

test('toda tabla con empresa_id tiene al menos una política de RLS', async () => {
  const { rows } = await pool.query(`
    SELECT t.table_name,
      (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.table_name) AS politicas
    FROM information_schema.columns t
    WHERE t.table_schema = 'public' AND t.column_name = 'empresa_id'`)
  assert.ok(rows.length > 0)
  const mal = rows.filter(r => Number(r.politicas) === 0).map(r => r.table_name)
  assert.deepEqual(mal, [], `tablas con empresa_id sin política: ${mal.join(', ')}`)
})

test('la API usa un rol sin privilegios (ni superusuario ni BYPASSRLS)', async () => {
  const { rows } = await pool.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)
  assert.equal(rows[0].rolsuper, false)
  assert.equal(rows[0].rolbypassrls, false)
})

test('el rol de la API no puede crear objetos en el esquema público', async () => {
  const { rows } = await pool.query(`SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS puede`)
  assert.equal(rows[0].puede, false)
})

// ── API ───────────────────────────────────────────────────────────────────────
test('toda ruta (salvo /health) exige sesión: sin token responde 401', async () => {
  const fuente = fs.readFileSync(path.join(RAIZ, 'server/src/index.js'), 'utf8')
  const rutas = [...fuente.matchAll(/app\.(get|post|put|delete|patch)\(\s*'([^']+)'/g)].map(m => [m[1], m[2]])
  assert.ok(rutas.length >= 20, `solo se encontraron ${rutas.length} rutas`)
  const app = buildApp({ projectId: 'x', origins: [], verify: async () => { throw new Error('no') }, logger: false })
  try {
    const abiertas = []
    for (const [metodo, ruta] of rutas) {
      if (ruta === '/health') continue
      const url = ruta.replace(/:[A-Za-z]+/g, '00000000-0000-0000-0000-000000000000')
      const r = await app.inject({ method: metodo.toUpperCase(), url, payload: metodo === 'get' || metodo === 'delete' ? undefined : {} })
      if (r.statusCode !== 401) abiertas.push(`${metodo.toUpperCase()} ${ruta} → ${r.statusCode}`)
    }
    assert.deepEqual(abiertas, [], `rutas sin autenticación: ${abiertas.join('; ')}`)
  } finally { await app.close() }
})

test('el servidor no usa SQL interpolado: toda consulta usa parámetros', () => {
  const sospechosas = []
  for (const f of archivos(path.join(RAIZ, 'server/src'), ['.js'])) {
    const txt = sinComentarios(fs.readFileSync(f, 'utf8'))
    // query(`... ${valor} ...`) con interpolación dentro de la plantilla
    for (const m of txt.matchAll(/\.query\(\s*`([^`]*)`/g)) {
      if (/\$\{/.test(m[1])) sospechosas.push(`${rel(f)}: ${m[1].slice(0, 60).replace(/\s+/g, ' ')}…`)
    }
  }
  assert.deepEqual(sospechosas, [], 'consultas con interpolación (usar $1, $2): ' + sospechosas.join(' | '))
})

// ── Frontend ──────────────────────────────────────────────────────────────────
// Único código que puede tocar localStorage directamente (todo lo demás pasa por
// src/lib/storage.ts). Agregar un archivo aquí exige justificarlo en la revisión.
const LOCALSTORAGE_PERMITIDO = new Set([
  'src/lib/storage.ts',          // capa de datos
  'src/lib/theme.tsx',           // preferencia de tema
  'src/lib/auth-context.tsx',    // registro de cuentas vinculadas
  'src/components/layout/Sidebar.tsx', // estado del menú y nombre de empresa
  'src/app/layout.tsx',          // script anti-parpadeo del tema
])

test('ningún dato de negocio toca localStorage fuera de la capa permitida', () => {
  const fuera = []
  for (const f of archivos(path.join(RAIZ, 'src'), ['.ts', '.tsx'])) {
    if (LOCALSTORAGE_PERMITIDO.has(rel(f))) continue
    if (/\blocalStorage\s*[.[]/.test(sinComentarios(fs.readFileSync(f, 'utf8')))) fuera.push(rel(f))
  }
  assert.deepEqual(fuera, [], `usan localStorage directo (usar src/lib/storage.ts): ${fuera.join(', ')}`)
})

test('no hay innerHTML, eval ni new Function (solo el script de tema en layout.tsx)', () => {
  const mal = []
  for (const f of archivos(path.join(RAIZ, 'src'), ['.ts', '.tsx'])) {
    const txt = sinComentarios(fs.readFileSync(f, 'utf8'))
    if (/\.innerHTML\s*=|\beval\(|new Function\(/.test(txt)) mal.push(`${rel(f)}: innerHTML/eval/Function`)
    if (/dangerouslySetInnerHTML/.test(txt) && rel(f) !== 'src/app/layout.tsx') mal.push(`${rel(f)}: dangerouslySetInnerHTML`)
  }
  assert.deepEqual(mal, [])
})

test('no se reintroduce xlsx (SheetJS) ni firebase-admin / firestore', () => {
  const mal = []
  for (const dir of ['src', 'server/src']) {
    for (const f of archivos(path.join(RAIZ, dir), ['.ts', '.tsx', '.js'])) {
      const txt = sinComentarios(fs.readFileSync(f, 'utf8'))
      if (/from\s+['"]xlsx['"]|require\(['"]xlsx['"]\)/.test(txt)) mal.push(`${rel(f)}: xlsx`)
      if (/firebase-admin|firebase\/firestore/.test(txt)) mal.push(`${rel(f)}: firebase-admin/firestore`)
    }
  }
  assert.deepEqual(mal, [])
})

test('ninguna variable NEXT_PUBLIC_ lleva un secreto', () => {
  const mal = []
  for (const f of ['.env.production', '.env.local.example'].map(n => path.join(RAIZ, n)).filter(fs.existsSync)) {
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = l.match(/^(\w+)=/)
      if (m && !m[1].startsWith('NEXT_PUBLIC_') && !/^(BASE_PATH)$/.test(m[1])) mal.push(`${rel(f)}: ${m[1]}`)
      if (m && /SECRET|PASSWORD|PRIVATE|TOKEN/i.test(m[1])) mal.push(`${rel(f)}: ${m[1]}`)
    }
  }
  assert.deepEqual(mal, [])
})

// ── Cadena de suministro y configuración ──────────────────────────────────────
test('toda acción de GitHub está fijada por SHA de commit (no por etiqueta movible)', () => {
  const dir = path.join(RAIZ, '.github/workflows')
  const sueltas = []
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yml'))) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/uses:\s*([^\s#]+)/g)) {
      if (m[1].startsWith('./')) continue   // workflow reutilizable del propio repo
      if (!/@[0-9a-f]{40}$/.test(m[1])) sueltas.push(`${f}: ${m[1]}`)
    }
  }
  assert.deepEqual(sueltas, [], 'acciones sin fijar por SHA: ' + sueltas.join(', '))
})

test('la API se niega a arrancar en producción sin verificar el certificado de la base', async () => {
  const { spawnSync } = await import('node:child_process')
  const lanzar = (env) => spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/db.js'); process.exit(0)"], {
    cwd: path.join(RAIZ, 'server'), encoding: 'utf8',
    env: { PATH: process.env.PATH, DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x', ...env },
  })
  const sinCA = lanzar({ NODE_ENV: 'production' })
  assert.notEqual(sinCA.status, 0, 'debía fallar sin DATABASE_CA_CERT en producción')
  assert.match(sinCA.stderr, /DATABASE_CA_CERT es obligatorio/)
  const sinCAconSslmode = lanzar({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x?sslmode=require' })
  assert.notEqual(sinCAconSslmode.status, 0)
  assert.equal(lanzar({ NODE_ENV: 'development' }).status, 0, 'en desarrollo sí arranca')
})

// ── Mantenibilidad: los archivos grandes no pueden seguir creciendo ───────────
// Un archivo de más de 1,000 líneas es difícil de cambiar sin romper algo. Los que ya lo eran se
// congelan en su tamaño actual (un «trinquete»): pueden encogerse, nunca crecer. Al dividir uno,
// se baja o se quita su entrada. Todo archivo nuevo tiene el tope general.
const TOPE_LINEAS = 1000
const CONGELADOS = {
  'src/app/nomina/page.tsx': 2752,
  'src/app/configuracion/page.tsx': 1715,
  'src/app/liquidacion/page.tsx': 1665,
  'src/app/empleados/page.tsx': 1597,
  'src/app/prestamos/page.tsx': 1471,
  'src/lib/dominican-labor.ts': 1361,
  'src/app/retribuciones-complementarias/page.tsx': 1080,
  'src/app/bonificacion/page.tsx': 1044,
}
test('ningún archivo supera el tope de líneas ni crece si ya lo superaba', () => {
  const mal = []
  for (const f of archivos(path.join(RAIZ, 'src'), ['.ts', '.tsx'])) {
    const lineas = (fs.readFileSync(f, 'utf8').match(/\n/g) ?? []).length
    const tope = CONGELADOS[rel(f)] ?? TOPE_LINEAS
    if (lineas > tope) mal.push(`${rel(f)}: ${lineas} líneas (tope ${tope})`)
  }
  assert.deepEqual(mal, [], 'archivos demasiado grandes — dividirlos en componentes: ' + mal.join('; '))
})
test('las entradas congeladas siguen siendo necesarias (si un archivo ya bajó del tope, quitarlo de la lista)', () => {
  const obsoletas = Object.entries(CONGELADOS).filter(([f]) => {
    const p = path.join(RAIZ, f)
    return !fs.existsSync(p) || (fs.readFileSync(p, 'utf8').match(/\n/g) ?? []).length <= TOPE_LINEAS
  }).map(([f]) => f)
  assert.deepEqual(obsoletas, [], 'quitar de CONGELADOS: ' + obsoletas.join(', '))
})

// ── Resiliencia: protecciones que los experimentos de caos exigieron (test/caos/) ──
// Los experimentos las prueban en funcionamiento (lentos); estas guardas baratas impiden quitarlas por accidente.
test('resiliencia: el pool de la base tiene tiempo límite, manejador de errores y destruye conexiones rotas', () => {
  const db = fs.readFileSync(path.join(RAIZ, 'server/src/db.js'), 'utf8')
  assert.match(db, /connectionTimeoutMillis/, 'sin tiempo límite de conexión una base muda cuelga todas las peticiones')
  assert.match(db, /query_timeout/, 'sin tiempo límite de consulta una red muda a mitad de petición la cuelga')
  assert.match(db, /pool\.on\('error'/, 'sin manejador, la pérdida de una conexión inactiva tumba el proceso')
  assert.match(db, /client\.on\('error'/, 'sin manejador en la conexión en uso, su pérdida tumba el proceso')
  assert.match(db, /release\(fallo\)/, 'una conexión rota no debe volver al pool')
})
test('resiliencia: la API instala el cierre ordenado y responde 503 (no 500) ante fallas de infraestructura', () => {
  const idx = fs.readFileSync(path.join(RAIZ, 'server/src/index.js'), 'utf8')
  assert.match(idx, /instalarCierreOrdenado\(/, 'sin cierre ordenado cada despliegue (SIGTERM) pierde las peticiones en curso')
  assert.match(idx, /esFallaDeInfraestructura\(err\)/)
  assert.match(idx, /keepAliveTimeout:\s*65_000/, 'el keep-alive debe superar al del balanceador (evita 502 esporádicos)')
  assert.match(idx, /AuthNoDisponible/, 'si Google no responde debe ser 503, no 401 (no parecer sesión vencida)')
})
test('resiliencia: el cliente pone tiempo límite a las peticiones, acota flushStorage y reconoce su propia escritura perdida', () => {
  const st = fs.readFileSync(path.join(RAIZ, 'src/lib/storage.ts'), 'utf8')
  assert.match(st, /AbortSignal\.timeout\(TIMEOUT_API_MS\)/, 'una petición sin tiempo límite bloquea todos los guardados siguientes')
  assert.match(st, /limiteMs/, 'flushStorage sin límite deja colgado el cierre de sesión')
  assert.match(st, /adoptarSiFueNuestra/, 'sin esto, una respuesta perdida se confunde con un conflicto y se pierden cambios')
  assert.match(st, /ESPERA_MAXIMA_MS/, 'sin espera máxima, quien escribe sin parar nunca guarda')
})
