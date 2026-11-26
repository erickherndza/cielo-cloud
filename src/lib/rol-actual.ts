'use client'

import { useRemoteStore } from './remote-store'

/** Rol de la persona en la empresa activa (null sin API o sin empresa). El super admin en modo soporte actúa como admin. */
export function useRolActual(): string | null {
  const { acceso } = useRemoteStore()
  if (!acceso?.activa) return null
  if (acceso.soporte) return 'admin'
  return acceso.empresas.find(e => e.id === acceso.activa!.id)?.rol ?? null
}
