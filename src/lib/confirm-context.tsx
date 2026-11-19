'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { BTN_PRIMARY, cn } from './utils'

// Confirmación propia de la app: reemplaza a window.confirm(), que el navegador
// puede dejar detrás de la ventana y que congela la automatización del navegador.
interface Opciones {
  titulo?: string
  mensaje: string
  confirmarLabel?: string
  peligroso?: boolean
}
type Confirmar = (o: Opciones | string) => Promise<boolean>

const Ctx = createContext<Confirmar>(() => Promise.resolve(false))
export const useConfirm = () => useContext(Ctx)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [op, setOp] = useState<Opciones | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const confirmar = useCallback<Confirmar>(o => {
    setOp(typeof o === 'string' ? { mensaje: o } : o)
    return new Promise<boolean>(res => { resolver.current = res })
  }, [])

  const cerrar = useCallback((v: boolean) => {
    resolver.current?.(v)
    resolver.current = null
    setOp(null)
  }, [])

  useEffect(() => {
    if (!op) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [op, cerrar])

  return (
    <Ctx.Provider value={confirmar}>
      {children}
      {op && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 animate-backdrop-in" onClick={() => cerrar(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141722] p-6 shadow-xl animate-modal-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              {op.peligroso && <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />}
              <div>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{op.titulo ?? 'Confirmar acción'}</h3>
                <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-300">{op.mensaje}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => cerrar(false)} className="rounded-lg border border-tabler-line dark:border-[#252840] px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-[#1a1d2e]">
                Cancelar
              </button>
              <button
                autoFocus
                onClick={() => cerrar(true)}
                className={cn(op.peligroso ? 'rounded-lg bg-rose-600 hover:bg-rose-700 px-4 py-2 text-sm font-semibold text-white' : BTN_PRIMARY)}
              >
                {op.confirmarLabel ?? 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}
