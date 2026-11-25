// Matriz de roles (misma que server/src/index.js; el servidor es quien la hace cumplir,
// aquí solo se evita guardar lo que ya se sabe que será rechazado).
// Todo miembro lee todas las colecciones; lo que cambia es qué puede escribir.
export type RolEmpresa = 'admin' | 'gerente' | 'rrhh' | 'contador'

const NOMINA = ['periodos', 'horas-extras', 'disfrutes-vacaciones', 'licencias', 'prestamos',
  'saldo-isr', 'retribuciones-complementarias', 'liquidaciones', 'agenda-custom', 'agenda-done']

const ESCRITURA: Record<RolEmpresa, Set<string> | 'todo'> = {
  admin: 'todo',
  gerente: new Set(['aumentos', 'periodos', 'agenda-custom', 'agenda-done']),
  rrhh: new Set([...NOMINA, 'empleados', 'aumentos', 'feriados']),
  contador: new Set(NOMINA),
}

export function puedeEscribirColeccion(rol: string | null | undefined, coleccion: string): boolean {
  if (!rol) return true   // sin API (modo local) no hay roles
  const p = ESCRITURA[rol as RolEmpresa]
  if (!p) return false
  return p === 'todo' || p.has(coleccion)
}

export const ETIQUETA_ROL: Record<string, string> = {
  admin: 'Administrador', gerente: 'Gerente', rrhh: 'Recursos Humanos', contador: 'Contador',
}
