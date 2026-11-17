'use client'

import { useEffect } from 'react'
import { reportarError } from '@/lib/error-reporter'

// Si una pantalla falla al dibujarse, se avisa a Cielo y la persona puede
// reintentar sin perder la sesión.
export default function ErrorPantalla({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportarError(`Pantalla: ${error.message}`, error.stack ?? '') }, [error])
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Algo salió mal en esta pantalla</p>
        <p className="mt-1 text-sm text-zinc-500">Ya se avisó al equipo de Cielo. Tus datos no se han modificado.</p>
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={reset} className="rounded-lg bg-[#1B2980] px-4 py-2 text-sm font-semibold text-white">Reintentar</button>
          <a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/`} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 dark:border-[#252840] dark:text-zinc-300">Ir al inicio</a>
        </div>
      </div>
    </div>
  )
}
