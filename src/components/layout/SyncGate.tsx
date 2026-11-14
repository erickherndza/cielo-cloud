'use client'

import { ReactNode } from 'react'
import { useAuth } from '@/lib/auth-context'
import { REMOTE_ENABLED } from '@/lib/storage'
import { useRemoteStore } from '@/lib/remote-store'

// Con base de datos remota: bloquea la app mientras se cargan los datos (así
// nadie escribe sobre una lista vacía) y avisa si algo no se pudo guardar.
export function SyncGate({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { ready, error, status } = useRemoteStore()
  if (!REMOTE_ENABLED || !user) return <>{children}</>

  if (!ready) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white p-6 dark:bg-[#0d0f1a]">
        <div className="max-w-sm text-center">
          {error ? (
            <>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">No se pudieron cargar tus datos</p>
              <p className="mt-1 text-sm text-zinc-500">Revisa tu conexión e inténtalo de nuevo. No se ha modificado nada.</p>
              <button onClick={() => window.location.reload()}
                className="mt-4 rounded-lg bg-[#1B2980] px-4 py-2 text-sm font-semibold text-white">Reintentar</button>
            </>
          ) : (
            <p className="text-sm text-zinc-500">Cargando tus datos…</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {status === 'conflict' && (
        <div className="fixed inset-x-0 top-0 z-[90] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-white">
          Otra sesión modificó estos datos. Tus últimos cambios no se guardaron.
          <button onClick={() => window.location.reload()} className="rounded bg-white/20 px-2 py-0.5 font-semibold">Recargar</button>
        </div>
      )}
      {status === 'error' && (
        <div className="fixed inset-x-0 top-0 z-[90] bg-rose-600 px-4 py-2 text-center text-sm font-medium text-white">
          Sin conexión con el servidor. Reintentando; no cierres esta pestaña.
        </div>
      )}
      {children}
    </>
  )
}
