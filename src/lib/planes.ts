// Planes de Cielo Cloud Nómina. Precio fijo mensual por rango de empleados.
// Pendiente de confirmar con Erick/Manuel: moneda (se muestra "$"), periodo
// (se muestra "/mes") y si todos los planes incluyen las mismas funciones.
export const EMAIL_VENTAS = 'ventas@cieloerp.com'

export interface Plan {
  id: string
  rango: string          // texto del rango de empleados
  precio?: number        // precio fijo mensual (ausente si es a cotizar)
  extra?: string         // cargo adicional, si aplica
  popular?: boolean
  cotizar?: boolean      // más de 100 empleados: se cotiza con ventas
}

export const PLANES: Plan[] = [
  { id: 'basico',  rango: 'Hasta 10 empleados', precio: 25 },
  { id: 'popular', rango: 'De 11 a 30 empleados', precio: 59, popular: true },
  {
    id: 'pro',
    rango: 'De 31 a 50 empleados',
    precio: 90,
  },
  { id: 'empresa', rango: 'Más de 100 empleados', cotizar: true, extra: 'Escríbenos y te preparamos una cotización' },
]

export function mailtoCotizar(): string {
  const asunto = encodeURIComponent('Cotización Cielo Cloud Nómina — más de 100 empleados')
  const cuerpo = encodeURIComponent('Hola, quisiera cotizar Cielo Cloud Nómina para una empresa de más de 100 empleados.\n\nEmpresa:\nNúmero de empleados:\nContacto:')
  return `mailto:${EMAIL_VENTAS}?subject=${asunto}&body=${cuerpo}`
}

// Funciones que ya anuncia el producto en las pantallas de acceso.
export const INCLUYE = [
  'TSS e ISR calculados automáticamente',
  'Nómina mensual y quincenal',
  'Comprobantes y reportes PDF',
  'Préstamos, liquidaciones y más',
]
