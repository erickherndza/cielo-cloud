'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { puedeEscribirColeccion, ETIQUETA_ROL } from '@/lib/roles'

// Colecciones que cada pantalla modifica. Si el rol no puede escribir NINGUNA de ellas,
// la pantalla queda en solo lectura. (El servidor es quien lo hace cumplir de verdad.)
const PANTALLAS: Record<string, string[]> = {
  '/empleados': ['empleados'],
  '/prestamos': ['prestamos'],
  '/vacaciones': ['disfrutes-vacaciones'],
  '/licencias': ['licencias'],
  '/horas-extras': ['horas-extras'],
  '/liquidacion': ['liquidaciones'],
  '/aumentos': ['aumentos'],
  '/bandas-salariales': ['bandas-salariales'],
  '/retribuciones-complementarias': ['retribuciones-complementarias'],
  '/configuracion': ['empresa'],
  '/nomina': ['periodos'],
  '/nomina/envios': ['periodos'],
  '/regalia-pascual': ['periodos'],
  '/bonificacion': ['periodos'],
}

// Botones que cambian datos. Solo se bloquean dentro de una pantalla en solo lectura.
const ACCION = /^\s*(nuev[oa]|agregar|añadir|eliminar|borrar|guardar|registrar|importar|otorgar|aplicar|aprobar|rechazar|dar de baja|suspender|reactivar|quitar|procesar|reabrir|solicitar|marcar|deshacer|vender|cargar|generar|crear|confirmar|editar)\b/i

export function SoloLectura({ rol }: { rol: string | null }) {
  const ruta = (usePathname() ?? '').replace(/\/$/, '') || '/'
  const cols = PANTALLAS[ruta]
  const soloLectura = !!rol && !!cols && !cols.some(c => puedeEscribirColeccion(rol, c))

  useEffect(() => {
    if (!soloLectura) return
    const marcar = () => {
      document.querySelectorAll<HTMLButtonElement>('main button').forEach(b => {
        if (b.dataset.sl) return
        const t = `${b.textContent ?? ''}`.trim() || b.getAttribute('aria-label') || ''
        if (!ACCION.test(t) && !/^(eliminar|quitar|editar|borrar)/i.test(b.getAttribute('aria-label') ?? '')) return
        b.dataset.sl = '1'
        b.disabled = true
        b.title = 'Solo lectura: tu rol no puede modificar esta pantalla'
        b.style.opacity = '0.4'
        b.style.cursor = 'not-allowed'
      })
    }
    marcar()
    const obs = new MutationObserver(marcar)
    obs.observe(document.body, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [soloLectura, ruta])

  if (!soloLectura) return null
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[80] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-lg border shadow-lg border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
      Solo lectura: como {ETIQUETA_ROL[rol!] ?? rol} puedes ver esta pantalla pero no modificarla.
    </div>
  )
}
