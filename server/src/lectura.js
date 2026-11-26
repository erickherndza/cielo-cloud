// Qué puede VER cada rol (el permiso de escritura vive en index.js). El servidor devuelve a cada rol
// solo lo que le toca, así que un auxiliar no puede leer salarios llamando a la API directamente.
//  - admin y analista: todas las colecciones.
//  - auxiliar: solo lo que captura (horas extras, licencias, vacaciones, préstamos, agenda), más el perfil
//    de la empresa y los feriados (el motor los necesita) y la lista de empleados SIN datos sensibles.
//    No ve períodos, liquidaciones, aumentos, saldos de ISR, retribuciones, bandas ni catálogos.
const SOLO_AUXILIAR = new Set([
  'empresa', 'empleados', 'feriados', 'horas-extras', 'licencias', 'disfrutes-vacaciones', 'prestamos',
  'agenda-custom', 'agenda-done',
])

// Campos del empleado que el auxiliar sí recibe (lista de permitidos: un campo nuevo queda oculto por defecto).
const CAMPOS_EMPLEADO_AUXILIAR = [
  'id', 'nombre', 'apellido', 'cargo', 'departamento', 'fechaIngreso', 'tipoContrato', 'activo',
  'regimenIntermitente', 'avatarColor', 'supervisorId', 'registradoEn',
  'suspendido', 'fechaSuspension', 'historialSuspensiones', 'salidaPendiente', 'fechaSalidaPendiente',
]

export function puedeLeer(rol, coleccion) {
  if (rol === 'admin' || rol === 'analista') return true
  if (rol === 'auxiliar') return SOLO_AUXILIAR.has(coleccion)
  return false
}

// ¿El rol recibe la colección tal cual está guardada? (si no, se le entrega una versión reducida o nada)
export const leeCompleta = (rol, coleccion) => puedeLeer(rol, coleccion) && !(rol === 'auxiliar' && coleccion === 'empleados')

export function proyectarParaRol(rol, coleccion, datos) {
  if (rol === 'auxiliar' && coleccion === 'empleados') {
    if (!Array.isArray(datos)) return []
    return datos.filter(e => e && typeof e === 'object').map(e => {
      const out = { salarioBase: 0, cedula: '' }
      for (const k of CAMPOS_EMPLEADO_AUXILIAR) if (e[k] !== undefined) out[k] = e[k]
      return out
    })
  }
  return datos
}
