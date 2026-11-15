// Validación de los parámetros legales globales. Lista de permitidos: solo
// existen estas claves y estos rangos; cualquier otra cosa se rechaza.
// Debe coincidir con RANGOS_PARAMETROS de src/lib/parametros-legales.ts.

const RANGOS = {
  vacaciones: { diasHasta5: [1, 60], diasMas5: [1, 60], umbralAnios: [1, 30] },
  divisor: { ordinario: [15, 31], intermitente: [15, 31] },
  cesantia: { d3a6m: [0, 60], d6a12m: [0, 60], diasAnio1a5: [0, 60], diasAnio5mas: [0, 60] },
  preaviso: { d3a6m: [0, 90], d6a12m: [0, 90], d12mas: [0, 90] },
  asistencia: { d3a6m: [0, 60], d6a12m: [0, 60], diasPorAnio: [0, 60] },
}
const MOTIVOS = ['renuncia', 'despido_sin_causa', 'despido_con_causa', 'mutuo_acuerdo', 'vencimiento_contrato']
const PRESTACIONES = ['cesantia', 'preaviso', 'asistencia']

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const mismasClaves = (obj, esperadas) =>
  Object.keys(obj).length === esperadas.length && esperadas.every(k => Object.hasOwn(obj, k))

/** Devuelve { ok: true, datos } con el objeto normalizado, o { ok: false, error }. */
export function validarParametros(entrada) {
  if (!esObjeto(entrada)) return { ok: false, error: 'Parámetros inválidos' }
  const grupos = [...Object.keys(RANGOS), 'motivos']
  if (!mismasClaves(entrada, grupos)) return { ok: false, error: 'Faltan o sobran secciones de parámetros' }
  const datos = {}
  for (const [grupo, campos] of Object.entries(RANGOS)) {
    const g = entrada[grupo]
    if (!esObjeto(g) || !mismasClaves(g, Object.keys(campos))) return { ok: false, error: `Sección «${grupo}» incompleta o con campos desconocidos` }
    datos[grupo] = {}
    for (const [campo, [min, max]] of Object.entries(campos)) {
      const v = g[campo]
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
        return { ok: false, error: `${grupo}.${campo} debe ser un número entre ${min} y ${max}` }
      }
      datos[grupo][campo] = Math.round(v * 100) / 100
    }
  }
  const m = entrada.motivos
  if (!esObjeto(m) || !mismasClaves(m, MOTIVOS)) return { ok: false, error: 'Motivos de terminación incompletos o desconocidos' }
  datos.motivos = {}
  for (const motivo of MOTIVOS) {
    const x = m[motivo]
    if (!esObjeto(x) || !mismasClaves(x, PRESTACIONES) || PRESTACIONES.some(p => typeof x[p] !== 'boolean')) {
      return { ok: false, error: `Motivo «${motivo}» inválido` }
    }
    datos.motivos[motivo] = { cesantia: x.cesantia, preaviso: x.preaviso, asistencia: x.asistencia }
  }
  return { ok: true, datos }
}
