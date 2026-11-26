'use client'

import { storage } from './storage'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { Licencia, TipoLicencia, Empleado } from '@/types'
import { useUserScopedKey } from './user-scoped-key'
import { getDivisorSalarioDiario } from './dominican-labor'
import { parseFechaLocal } from './utils'

const KEY = 'cielo-licencias'

// Días calendario pagados al 100% según tipo de licencia (práctica estándar TSS)
export const DIAS_LICENCIA: Record<'matrimonial' | 'fallecimiento' | 'alumbramiento', number> = {
  matrimonial:   5,  // Licencia matrimonial
  fallecimiento: 3,  // Fallecimiento de familiar (abuelos, padres, hijos, cónyuge)
  alumbramiento: 2,  // Alumbramiento de esposa/compañera registrada
}

// Días sugeridos para licencias con subsidio — variables según certificado
// médico/legal, el usuario puede ajustarlos. Maternidad: 12 semanas (Art. 236
// Código de Trabajo — 6 semanas antes y 6 después del parto).
export const DIAS_SUGERIDOS_SUBSIDIO: Record<'enfermedad_comun' | 'accidente_laboral' | 'maternidad', number> = {
  enfermedad_comun:  3,
  accidente_laboral: 3,
  maternidad:        84,
}

export const TIPOS_CON_SUBSIDIO: TipoLicencia[] = ['enfermedad_comun', 'accidente_laboral', 'maternidad']

export function esLicenciaConSubsidio(tipo: TipoLicencia): boolean {
  return TIPOS_CON_SUBSIDIO.includes(tipo)
}

export function labelLicencia(tipo: TipoLicencia): string {
  switch (tipo) {
    case 'matrimonial':       return 'Matrimonial'
    case 'fallecimiento':     return 'Fallecimiento de Familiar'
    case 'alumbramiento':     return 'Alumbramiento'
    case 'enfermedad_comun':  return 'Enfermedad Común'
    case 'accidente_laboral': return 'Accidente Laboral / Enf. Profesional'
    case 'maternidad':        return 'Maternidad'
  }
}

// % de subsidio que paga o reembolsa SISALRIL/ARL — no lo desembolsa Cielo
// Cloud, es solo informativo para que la empresa sepa cuánto reclamar/esperar.
function porcentajeSubsidio(tipo: TipoLicencia, modalidadEnfermedad?: 'ambulatoria' | 'hospitalaria'): number {
  switch (tipo) {
    case 'enfermedad_comun':  return modalidadEnfermedad === 'hospitalaria' ? 0.40 : 0.60
    case 'accidente_laboral': return 0.75
    case 'maternidad':        return 1.00 // empleador paga 100% y luego SISALRIL reembolsa
    default:                  return 0
  }
}

interface RegistrarOpciones {
  dias?: number                                          // requerido para tipos con subsidio
  modalidadEnfermedad?: 'ambulatoria' | 'hospitalaria'    // solo enfermedad_comun
  disfruteSueldo?: boolean                                // solo enfermedad_comun / accidente_laboral
  notas?: string
  documentoSoporte?: string  // base64 — certificado médico/acta adjunto
  documentoNombre?: string   // nombre original del archivo
}

interface LicenciasCtx {
  licencias: Licencia[]
  registrar: (
    empleadoId: string,
    tipo: TipoLicencia,
    fechaInicio: string,
    empleado: Pick<Empleado, 'salarioBase' | 'regimenIntermitente'>,
    opciones?: RegistrarOpciones,
  ) => Licencia
  eliminar: (licenciaId: string) => void
  completarMontosPendientes: (empleados: Pick<Empleado, 'id' | 'salarioBase' | 'regimenIntermitente'>[]) => void
  licenciaActiva: (empleadoId: string, fecha?: Date) => Licencia | null
  estaDeLicencia: (empleadoId: string, fecha?: Date) => boolean
  marcarReclamado: (licenciaId: string, fecha: string) => void
  marcarReembolsado: (licenciaId: string, fecha: string, monto?: number) => void
  revertirEstadoReclamo: (licenciaId: string) => void
}

const Ctx = createContext<LicenciasCtx>({
  licencias: [],
  registrar: () => { throw new Error('LicenciasProvider not mounted') },
  eliminar: () => {},
  completarMontosPendientes: () => {},
  licenciaActiva: () => null,
  estaDeLicencia: () => false,
  marcarReclamado: () => {},
  marcarReembolsado: () => {},
  revertirEstadoReclamo: () => {},
})

function calcularMontosLicencia(
  tipo: TipoLicencia, dias: number,
  empleado: Pick<Empleado, 'salarioBase' | 'regimenIntermitente'>,
  opciones: Pick<RegistrarOpciones, 'modalidadEnfermedad' | 'disfruteSueldo'>,
): { montoPagado: number; montoSubsidioEstimado: number | undefined } {
  const conSubsidio = esLicenciaConSubsidio(tipo)
  const salarioDiario = empleado.salarioBase / getDivisorSalarioDiario(empleado)
  const montoCompleto = Math.round(salarioDiario * dias * 100) / 100
  if (tipo === 'maternidad') {
    // El empleador paga el 100% y luego solicita reembolso a SISALRIL.
    return { montoPagado: montoCompleto, montoSubsidioEstimado: montoCompleto }
  }
  if (conSubsidio) {
    // enfermedad_comun / accidente_laboral: SISALRIL/ARL paga el subsidio directo al empleado — Cielo Cloud
    // solo lo registra. El "disfrute de sueldo" es un beneficio adicional que la empresa paga vía nómina.
    return {
      montoSubsidioEstimado: Math.round(montoCompleto * porcentajeSubsidio(tipo, opciones.modalidadEnfermedad) * 100) / 100,
      montoPagado: opciones.disfruteSueldo ? montoCompleto : 0,
    }
  }
  return { montoPagado: montoCompleto, montoSubsidioEstimado: undefined }
}

export function LicenciasProvider({ children }: { children: ReactNode }) {
  const [licencias, setLicencias] = useState<Licencia[]>([])
  const { key, ready } = useUserScopedKey(KEY)

  useEffect(() => {
    if (!ready) return
    try {
      const raw = storage.getItem(key)
      setLicencias(raw ? JSON.parse(raw) as Licencia[] : [])
    } catch {
      setLicencias([])
    }
  }, [key, ready])

  function persist(next: Licencia[]) {
    try { storage.setItem(key, JSON.stringify(next)) } catch { /* ignore */ }
  }

  function registrar(
    empleadoId: string,
    tipo: TipoLicencia,
    fechaInicio: string,
    empleado: Pick<Empleado, 'salarioBase' | 'regimenIntermitente'>,
    opciones: RegistrarOpciones = {},
  ): Licencia {
    const conSubsidio = esLicenciaConSubsidio(tipo)
    const dias = conSubsidio
      ? Math.max(1, opciones.dias ?? DIAS_SUGERIDOS_SUBSIDIO[tipo as 'enfermedad_comun' | 'accidente_laboral' | 'maternidad'])
      : DIAS_LICENCIA[tipo as 'matrimonial' | 'fallecimiento' | 'alumbramiento']

    const inicio = parseFechaLocal(fechaInicio)
    const fin = new Date(inicio)
    fin.setDate(fin.getDate() + (dias - 1))

    // Un auxiliar no recibe el sueldo (salarioBase llega en 0): los montos quedan pendientes y los calcula
    // quien sí ve salarios (analista/admin) la próxima vez que abra Licencias.
    const sinSueldo = !(empleado.salarioBase > 0)
    const { montoPagado, montoSubsidioEstimado } = calcularMontosLicencia(tipo, dias, empleado, opciones)

    const nueva: Licencia = {
      id: `licencia-${Date.now().toString(36)}`,
      empleadoId,
      tipo,
      fechaInicio,
      fechaFin: fin.toISOString().split('T')[0],
      dias,
      montoPagado,
      notas: opciones.notas,
      modalidadEnfermedad: tipo === 'enfermedad_comun' ? opciones.modalidadEnfermedad : undefined,
      disfruteSueldo: conSubsidio && tipo !== 'maternidad' ? (opciones.disfruteSueldo ?? false) : undefined,
      montoSubsidioEstimado,
      documentoSoporte: opciones.documentoSoporte,
      documentoNombre: opciones.documentoNombre,
      estadoReclamo: conSubsidio ? 'por_reclamar' : undefined,
      montoPendiente: sinSueldo ? true : undefined,
    }
    setLicencias(prev => {
      const next = [nueva, ...prev]
      persist(next)
      return next
    })
    return nueva
  }

  /** Calcula los montos de las licencias registradas sin acceso al sueldo (ver `registrar`). */
  function completarMontosPendientes(empleados: Pick<Empleado, 'id' | 'salarioBase' | 'regimenIntermitente'>[]) {
    setLicencias(prev => {
      let cambio = false
      const next = prev.map(l => {
        if (!l.montoPendiente) return l
        const emp = empleados.find(e => e.id === l.empleadoId)
        if (!emp || !(emp.salarioBase > 0)) return l
        cambio = true
        const m = calcularMontosLicencia(l.tipo, l.dias, emp, { modalidadEnfermedad: l.modalidadEnfermedad, disfruteSueldo: l.disfruteSueldo })
        return { ...l, ...m, montoPendiente: undefined }
      })
      if (!cambio) return prev
      persist(next)
      return next
    })
  }

  function eliminar(licenciaId: string) {
    setLicencias(prev => {
      const next = prev.filter(l => l.id !== licenciaId)
      persist(next)
      return next
    })
  }

  // Licencia vigente HOY (o en `fecha`) para un empleado — puramente
  // derivado de fechaInicio/fechaFin, sin ningún estado persistido en
  // Empleado (mismo patrón que disfruteActivo/estaDeVacaciones en
  // vacaciones-context.tsx). Se actualiza solo con el paso del tiempo, sin
  // necesidad de una acción manual de "cerrar" la licencia.
  function licenciaActiva(empleadoId: string, fecha: Date = new Date()): Licencia | null {
    const f = fecha.getTime()
    return licencias.find(l =>
      l.empleadoId === empleadoId &&
      parseFechaLocal(l.fechaInicio).getTime() <= f &&
      parseFechaLocal(l.fechaFin).getTime() >= f
    ) ?? null
  }

  function estaDeLicencia(empleadoId: string, fecha?: Date): boolean {
    return licenciaActiva(empleadoId, fecha) !== null
  }

  // ── Trazabilidad de reclamo/reembolso del subsidio (SISALRIL/ARL) ────────
  // por_reclamar → reclamado → reembolsado, con reversión de un paso a la
  // vez (deshacer un error de captura sin perder el registro anterior).
  function marcarReclamado(licenciaId: string, fecha: string) {
    setLicencias(prev => {
      const next = prev.map(l => l.id === licenciaId ? { ...l, estadoReclamo: 'reclamado' as const, fechaReclamo: fecha } : l)
      persist(next)
      return next
    })
  }

  function marcarReembolsado(licenciaId: string, fecha: string, monto?: number) {
    setLicencias(prev => {
      const next = prev.map(l => l.id === licenciaId
        ? { ...l, estadoReclamo: 'reembolsado' as const, fechaReembolso: fecha, montoReembolsado: monto ?? l.montoSubsidioEstimado }
        : l)
      persist(next)
      return next
    })
  }

  function revertirEstadoReclamo(licenciaId: string) {
    setLicencias(prev => {
      const next = prev.map(l => {
        if (l.id !== licenciaId) return l
        if (l.estadoReclamo === 'reembolsado') {
          return { ...l, estadoReclamo: 'reclamado' as const, fechaReembolso: undefined, montoReembolsado: undefined }
        }
        if (l.estadoReclamo === 'reclamado') {
          return { ...l, estadoReclamo: 'por_reclamar' as const, fechaReclamo: undefined }
        }
        return l
      })
      persist(next)
      return next
    })
  }

  return (
    <Ctx.Provider value={{
      licencias, registrar, eliminar, completarMontosPendientes, licenciaActiva, estaDeLicencia,
      marcarReclamado, marcarReembolsado, revertirEstadoReclamo,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useLicencias = () => useContext(Ctx)
