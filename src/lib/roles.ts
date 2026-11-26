// Matriz de roles (misma que server/src/index.js; el servidor es quien la hace cumplir,
// aquí solo se evita guardar lo que ya se sabe que será rechazado).
// Todo miembro lee todas las colecciones; lo que cambia es qué puede escribir.
//  - admin:    «Gerente de nómina / administrador» — acceso completo.
//  - analista: «Analista de nómina y recursos humanos» — todo menos la configuración de la empresa,
//              los catálogos y la administración de usuarios.
//  - auxiliar: «Auxiliar de nómina / recursos humanos» — solo captura (horas extras, licencias,
//              vacaciones, préstamos). No toca períodos, liquidaciones, aumentos ni empleados.
export type RolEmpresa = 'admin' | 'analista' | 'auxiliar'

// Roles anteriores que aún pueden venir de miembros ya invitados: se tratan como «analista».
const ROL_ANTERIOR: Record<string, RolEmpresa> = { gerente: 'analista', rrhh: 'analista', contador: 'analista' }
export function normalizarRol(rol: string | null | undefined): string | null {
  if (!rol) return null
  return ROL_ANTERIOR[rol] ?? rol
}

const COLECCIONES = [
  'empresa', 'empleados', 'periodos', 'prestamos', 'aumentos', 'licencias', 'bandas-salariales', 'liquidaciones',
  'saldo-isr', 'feriados', 'disfrutes-vacaciones', 'retribuciones-complementarias', 'conceptos-personalizados',
  'agenda-custom', 'agenda-done', 'horas-extras',
]
const SIN_CONFIGURACION = new Set(['empresa', 'conceptos-personalizados', 'bandas-salariales', 'feriados'])

const ESCRITURA: Record<RolEmpresa, Set<string> | 'todo'> = {
  admin: 'todo',
  analista: new Set(COLECCIONES.filter(c => !SIN_CONFIGURACION.has(c))),
  auxiliar: new Set(['horas-extras', 'licencias', 'disfrutes-vacaciones', 'prestamos', 'agenda-custom', 'agenda-done']),
}

export function puedeEscribirColeccion(rol: string | null | undefined, coleccion: string): boolean {
  if (!rol) return true   // sin API (modo local) no hay roles
  const p = ESCRITURA[normalizarRol(rol) as RolEmpresa]
  if (!p) return false
  return p === 'todo' || p.has(coleccion)
}

export const ETIQUETA_ROL: Record<string, string> = {
  admin: 'Gerente de nómina / Administrador',
  analista: 'Analista de nómina y RR. HH.',
  auxiliar: 'Auxiliar de nómina / RR. HH.',
  gerente: 'Analista de nómina y RR. HH.', rrhh: 'Analista de nómina y RR. HH.', contador: 'Analista de nómina y RR. HH.',
}
