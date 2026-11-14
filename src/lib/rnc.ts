import { REMOTE_ENABLED, apiJson } from './storage'

const PESOS = [7, 9, 8, 6, 5, 4, 3, 2]

export function limpiarRnc(v: string): string { return (v ?? '').replace(/\D/g, '') }

// 9 dígitos = RNC de empresa, con dígito verificador (misma fórmula que el
// servidor; probada contra el listado oficial de la DGII). 11 = cédula de una
// persona física con negocio: solo se valida el largo.
export function rncValido(v: string): boolean {
  const d = limpiarRnc(v)
  if (d.length === 11) return true
  if (d.length !== 9) return false
  const m = PESOS.reduce((s, p, i) => s + Number(d[i]) * p, 0) % 11
  const dv = m === 0 ? 2 : m === 1 ? 1 : 11 - m
  return dv === Number(d[8])
}

export function formatearRnc(v: string): string {
  const d = limpiarRnc(v)
  if (d.length === 9) return `${d.slice(0, 3)}-${d.slice(3, 8)}-${d.slice(8)}`
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`
  return v
}

export interface DatosDgii {
  rnc: string
  razonSocial: string
  nombreComercial?: string
  categoria?: string
  regimenPagos?: string
  estado?: string
  actividadEconomica?: string
  administracionLocal?: string
  facturadorElectronico?: string
  consultadoEn?: string
}

export type ResultadoDgii =
  | { estado: 'ok'; datos: DatosDgii }
  | { estado: 'no-inscrito' }
  | { estado: 'no-disponible'; mensaje: string }
  | { estado: 'invalido'; mensaje: string }

// Consulta la DGII a través de nuestra API (el navegador no puede llamarla directo).
export async function validarRncDgii(rnc: string): Promise<ResultadoDgii> {
  if (!rncValido(rnc)) return { estado: 'invalido', mensaje: 'RNC inválido: revisa los dígitos (9 para empresa, 11 para cédula).' }
  if (!REMOTE_ENABLED) return { estado: 'no-disponible', mensaje: 'La consulta a la DGII requiere conexión con el servidor.' }
  try {
    const r = await apiJson<DatosDgii & { encontrado?: boolean; error?: string }>(`/api/dgii/rnc/${limpiarRnc(rnc)}`)
    if (r.status === 429) return { estado: 'no-disponible', mensaje: 'Demasiadas consultas seguidas, espera un minuto.' }
    if (!r.ok) return { estado: 'no-disponible', mensaje: r.data?.error ?? 'No se pudo consultar la DGII en este momento.' }
    if (!r.data.encontrado) return { estado: 'no-inscrito' }
    return { estado: 'ok', datos: r.data }
  } catch {
    return { estado: 'no-disponible', mensaje: 'No se pudo consultar la DGII en este momento.' }
  }
}
