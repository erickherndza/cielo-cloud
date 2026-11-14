'use client'

import { ReactNode } from 'react'
import { useAuth } from '@/lib/auth-context'
import { REMOTE_ENABLED } from '@/lib/storage'
import { useRemoteStore } from '@/lib/remote-store'
import { elegirEmpresa, salirDeEmpresa } from '@/lib/storage'
import { AdminPanel } from '@/components/admin/AdminPanel'

// Con base de datos remota: bloquea la app mientras se cargan los datos (así
// nadie escribe sobre una lista vacía) y avisa si algo no se pudo guardar.
export function SyncGate({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const { ready, sinEmpresa, acceso, error, status } = useRemoteStore()
  if (!REMOTE_ENABLED || !user) return <>{children}</>
  // Correo sin verificar: todavía no hay datos que cargar; el RouteGuard
  // muestra la pantalla de verificación.
  if (!user.emailVerified) return <>{children}</>

  // Sesión cargada pero sin empresa activa: panel (super admin), selector o aviso.
  if (!ready && sinEmpresa && acceso) {
    const salir = (
      <button onClick={() => { void logout() }} className="text-xs font-medium text-zinc-500 underline">Cerrar sesión</button>
    )
    if (acceso.esSuperadmin) {
      return (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-zinc-50 dark:bg-[#0d0f1a]">
          <div className="flex justify-end px-6 pt-4">{salir}</div>
          <AdminPanel />
        </div>
      )
    }
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-50 p-6 dark:bg-[#0d0f1a]">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-[#252840] dark:bg-[#141722]">
          {!Array.isArray(acceso.empresas) || acceso.empresas.length === 0 ? (
            <>
              <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Tu cuenta aún no tiene una empresa asignada</p>
              <p className="mt-2 text-sm text-zinc-500">
                Pídele al administrador de tu empresa (o a Cielo) que te invite con este correo:
                <span className="mt-1 block font-medium text-zinc-700 dark:text-zinc-300">{acceso.email}</span>
                Cuando lo haga, vuelve a entrar y quedará asignada automáticamente.
              </p>
              <button onClick={() => window.location.reload()}
                className="mt-4 rounded-lg bg-[#1B2980] px-4 py-2 text-sm font-semibold text-white">Ya me invitaron, reintentar</button>
            </>
          ) : (
            <>
              <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">¿Con qué empresa vas a trabajar?</p>
              <div className="mt-4 space-y-2">
                {acceso.empresas.map(e => (
                  <button key={e.id} onClick={() => elegirEmpresa(e)} disabled={e.estado === 'suspendida'}
                    className="flex w-full items-center justify-between rounded-xl border border-zinc-200 px-4 py-3 text-left hover:border-[#1B2980] disabled:opacity-50 dark:border-[#252840]">
                    <span>
                      <span className="block text-sm font-semibold text-[#1B2980] dark:text-indigo-300">{e.nombre || '(sin nombre)'}</span>
                      <span className="text-xs text-zinc-500">RNC {e.rnc ?? '—'} · {e.rol}{e.estado === 'suspendida' ? ' · suspendida' : ''}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="mt-5 text-center">{salir}</div>
        </div>
      </div>
    )
  }

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
      {acceso?.soporte && acceso.activa && (
        <div className="fixed inset-x-0 top-0 z-[95] flex items-center justify-center gap-3 bg-[#1B2980] px-4 py-1.5 text-xs font-medium text-white">
          Modo soporte · {acceso.activa.nombre || 'Empresa'} {acceso.activa.rnc ? `(RNC ${acceso.activa.rnc})` : ''} · tus accesos quedan registrados
          <button onClick={salirDeEmpresa} className="rounded bg-white/20 px-2 py-0.5 font-semibold">Salir de la empresa</button>
        </div>
      )}
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
