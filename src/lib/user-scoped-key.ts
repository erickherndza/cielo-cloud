'use client'

import { useAuth } from './auth-context'
import { FIREBASE_ENABLED } from './firebase'
import { REMOTE_ENABLED } from './storage'
import { useRemoteStore } from './remote-store'
import { scopedKey } from './utils'

// `ready` es false mientras no se sepa con certeza a qué usuario pertenece la
// key (evita leer/escribir datos de la cuenta equivocada durante la carga
// inicial o un cambio de sesión). Con API, además espera a que los datos de
// la empresa estén cargados desde PostgreSQL.
export function useUserScopedKey(base: string): { key: string; ready: boolean } {
  const { user, loading } = useAuth()
  const remote = useRemoteStore()
  if (!FIREBASE_ENABLED) return { key: base, ready: true }
  if (loading || !user) return { key: base, ready: false }
  if (REMOTE_ENABLED && !remote.ready) return { key: scopedKey(base, user.uid), ready: false }
  return { key: scopedKey(base, user.uid), ready: true }
}
