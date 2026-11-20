// Reinicia el historial de nómina de la empresa activa para repetir pruebas desde cero:
// borra períodos, liquidaciones, aumentos, vacaciones, préstamos, licencias, saldos de ISR y
// retribuciones complementarias. CONSERVA el perfil de la empresa, la configuración y los
// empleados, a los que reactiva y limpia salidas/pagos de regalía registrados por nómina.
// Solo desarrollo local o super admin (ver Configuración → Datos y Migración).

import { storage } from './storage'
import { scopedKey } from './utils'
import type { Empleado } from '@/types'

const VACIAR = [
  'cielo-periodos', 'cielo-liquidaciones', 'cielo-aumentos', 'cielo-disfrutes-vacaciones',
  'cielo-prestamos', 'cielo-licencias', 'cielo-saldo-isr', 'cielo-retribuciones-complementarias',
]

export function reiniciarNomina(uid?: string | null): { empleados: number; reactivados: number } {
  const k = (b: string) => scopedKey(b, uid)
  for (const base of VACIAR) storage.setItem(k(base), JSON.stringify([]))
  let empleados: Empleado[] = []
  try { empleados = JSON.parse(storage.getItem(k('cielo-empleados')) ?? '[]') as Empleado[] } catch { empleados = [] }
  let reactivados = 0
  const limpios = empleados.map(e => {
    if (!e.activo || e.salidaPendiente) reactivados++
    const { salidaPendiente: _a, fechaSalidaPendiente: _b, motivoSalidaPendiente: _c, pagoDiasTrabajadosPendiente: _d,
      regaliaPagadaEsteAnio: _e, regaliaPagadaAnio: _f, historialSuspensiones: _g, suspendido: _h, fechaSuspension: _i, motivoSuspension: _j, ...resto } = e
    return { ...resto, activo: true } as Empleado
  })
  storage.setItem(k('cielo-empleados'), JSON.stringify(limpios))
  // el perfil de la empresa conserva todo salvo las marcas de años de regalía/bonificación ya resueltos
  try {
    const emp = JSON.parse(storage.getItem(k('cielo-empresa')) ?? 'null')
    if (emp) {
      delete emp.regaliaResueltaAnios; delete emp.bonificacionExentaAnios; delete emp.horasExtrasDGT2
      storage.setItem(k('cielo-empresa'), JSON.stringify(emp))
    }
  } catch { /* sin perfil: nada que limpiar */ }
  return { empleados: limpios.length, reactivados }
}
