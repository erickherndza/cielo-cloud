// Parámetros legales globales (Código de Trabajo, Ley 16-92) que el super admin
// puede ajustar desde /admin cuando el abogado o el contador los corrige.
// Los valores por defecto son los que el motor usaba antes de existir esta
// pantalla; con la tabla vacía el comportamiento es idéntico al anterior.
//
// Este módulo no depende de React ni de la red: el motor de cálculo lee de
// `getParametros()` en cada llamada, y `storage.ts` lo actualiza al iniciar
// sesión con lo que devuelve la API.

export type MotivoParam =
  | 'renuncia' | 'despido_sin_causa' | 'despido_con_causa' | 'mutuo_acuerdo' | 'vencimiento_contrato'

export interface ParametrosLegales {
  vacaciones: {
    diasHasta5: number      // días laborables por año hasta el umbral (Art. 177)
    diasMas5: number        // días laborables por año después del umbral
    umbralAnios: number     // «más de N años» pasa a la tasa mayor
  }
  divisor: {
    ordinario: number       // salario mensual ÷ N = salario diario
    intermitente: number    // régimen intermitente (Res. 04-93)
  }
  cesantia: {               // Art. 80
    d3a6m: number           // 3–6 meses
    d6a12m: number          // 6–12 meses
    diasAnio1a5: number     // días por año completo, de 1 a menos de 5 años
    diasAnio5mas: number    // días por año completo, 5 años o más
  }
  preaviso: {               // Art. 76
    d3a6m: number
    d6a12m: number
    d12mas: number
  }
  asistencia: {             // Art. 82
    d3a6m: number
    d6a12m: number
    diasPorAnio: number
  }
  // Qué prestaciones genera cada motivo de terminación (renuncia, despido,
  // mutuo acuerdo, vencimiento de contrato).
  motivos: Record<MotivoParam, { cesantia: boolean; preaviso: boolean; asistencia: boolean }>
}

export const PARAMETROS_POR_DEFECTO: ParametrosLegales = {
  vacaciones: { diasHasta5: 14, diasMas5: 18, umbralAnios: 5 },
  divisor: { ordinario: 23.83, intermitente: 26 },
  cesantia: { d3a6m: 6, d6a12m: 13, diasAnio1a5: 21, diasAnio5mas: 23 },
  preaviso: { d3a6m: 7, d6a12m: 14, d12mas: 28 },
  asistencia: { d3a6m: 5, d6a12m: 10, diasPorAnio: 15 },
  motivos: {
    renuncia:             { cesantia: false, preaviso: false, asistencia: false },
    despido_sin_causa:    { cesantia: true,  preaviso: true,  asistencia: false },
    despido_con_causa:    { cesantia: false, preaviso: false, asistencia: false },
    mutuo_acuerdo:        { cesantia: true,  preaviso: true,  asistencia: false },
    vencimiento_contrato: { cesantia: false, preaviso: false, asistencia: true  },
  },
}

// Rangos aceptados (los mismos que valida el servidor). Sirven también para
// limitar los campos de la pantalla de administración.
export const RANGOS_PARAMETROS = {
  vacaciones: { diasHasta5: [1, 60], diasMas5: [1, 60], umbralAnios: [1, 30] },
  divisor: { ordinario: [15, 31], intermitente: [15, 31] },
  cesantia: { d3a6m: [0, 60], d6a12m: [0, 60], diasAnio1a5: [0, 60], diasAnio5mas: [0, 60] },
  preaviso: { d3a6m: [0, 90], d6a12m: [0, 90], d12mas: [0, 90] },
  asistencia: { d3a6m: [0, 60], d6a12m: [0, 60], diasPorAnio: [0, 60] },
} as const

let actuales: ParametrosLegales = PARAMETROS_POR_DEFECTO
let version = 0

export function getParametros(): ParametrosLegales { return actuales }
export function getVersionParametros(): number { return version }

// Combina lo recibido con los valores por defecto: una clave que falte (por
// ejemplo, un parámetro agregado después de guardar la versión) nunca deja el
// motor con `undefined`.
export function mezclarConDefecto(datos: unknown): ParametrosLegales {
  const d = (datos && typeof datos === 'object' ? datos : {}) as Record<string, Record<string, unknown>>
  const base = PARAMETROS_POR_DEFECTO
  const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def)
  const out = JSON.parse(JSON.stringify(base)) as ParametrosLegales
  for (const [grupo, rangos] of Object.entries(RANGOS_PARAMETROS)) {
    for (const k of Object.keys(rangos)) {
      const g = out[grupo as keyof typeof RANGOS_PARAMETROS] as Record<string, number>
      g[k] = num(d[grupo]?.[k], g[k])
    }
  }
  const m = (d.motivos ?? {}) as Record<string, Record<string, unknown>>
  for (const motivo of Object.keys(base.motivos) as MotivoParam[]) {
    for (const p of ['cesantia', 'preaviso', 'asistencia'] as const) {
      const v = m[motivo]?.[p]
      if (typeof v === 'boolean') out.motivos[motivo][p] = v
    }
  }
  return out
}

export function setParametros(datos: unknown, nuevaVersion = 0) {
  actuales = datos ? mezclarConDefecto(datos) : PARAMETROS_POR_DEFECTO
  version = nuevaVersion
}
