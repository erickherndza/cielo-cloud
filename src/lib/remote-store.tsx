'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { useAuth } from './auth-context'
import {
  REMOTE_ENABLED, initRemoteStore, resetRemoteStore, onSyncStatus, getSyncStatus, getAcceso, type SyncStatus, type AccesoInfo,
} from './storage'

interface RemoteCtx {
  /** Datos de una empresa cargados y listos. */
  ready: boolean
  /** La sesión está cargada pero no hay empresa activa (elegir / sin empresa / panel admin). */
  sinEmpresa: boolean
  acceso: AccesoInfo | null
  error: string | null
  status: SyncStatus
}
const Ctx = createContext<RemoteCtx>({ ready: true, sinEmpresa: false, acceso: null, error: null, status: 'idle' })

// Carga los datos de la empresa desde la API una vez que hay sesión. Mientras
// no estén cargados, `ready` es false y ningún módulo de datos lee ni escribe.
export function RemoteStoreProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const [ready, setReady] = useState(!REMOTE_ENABLED)
  const [sinEmpresa, setSinEmpresa] = useState(false)
  const [acceso, setAcceso] = useState<AccesoInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus())

  useEffect(() => onSyncStatus(setStatus), [])

  useEffect(() => {
    if (!REMOTE_ENABLED || loading) return
    if (!user) { resetRemoteStore(); setReady(false); setSinEmpresa(false); setAcceso(null); setError(null); return }
    let cancelled = false
    setReady(false)
    setSinEmpresa(false)
    setError(null)
    initRemoteStore(user.uid, () => user.getIdToken())
      .then(() => {
        if (cancelled) return
        const a = getAcceso()
        setAcceso(a)
        if (a?.activa) setReady(true); else setSinEmpresa(true)
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Error de conexión') })
    return () => { cancelled = true }
  }, [user, loading])

  return <Ctx.Provider value={{ ready, sinEmpresa, acceso, error, status }}>{children}</Ctx.Provider>
}

export function useRemoteStore() { return useContext(Ctx) }
