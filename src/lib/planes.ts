// Planes de Cielo Cloud Nómina. Precio fijo mensual por rango de empleados.
// Pendiente de confirmar con Erick/Manuel: moneda (se muestra "$"), periodo
// (se muestra "/mes") y si todos los planes incluyen las mismas funciones.
export interface Plan {
  id: string
  rango: string          // texto del rango de empleados
  precio: number         // precio fijo mensual
  extra?: string         // cargo adicional, si aplica
  popular?: boolean
}

export const PLANES: Plan[] = [
  { id: 'basico',  rango: 'Hasta 10 empleados', precio: 25 },
  { id: 'popular', rango: 'De 11 a 30 empleados', precio: 59, popular: true },
  {
    id: 'pro',
    rango: 'De 31 a 50 empleados',
    precio: 90,
    extra: '+ $2.50 por empleado/mes por cada uno arriba de 50',
  },
]

// Funciones que ya anuncia el producto en las pantallas de acceso.
export const INCLUYE = [
  'TSS e ISR calculados automáticamente',
  'Nómina mensual y quincenal',
  'Comprobantes y reportes PDF',
  'Préstamos, liquidaciones y más',
]
