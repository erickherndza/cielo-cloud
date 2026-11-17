import { apiJson, getAcceso, REMOTE_ENABLED } from '@/lib/storage'

// Reporta fallos de la web a la consola de super admin. Solo manda el mensaje,
// el detalle técnico (stack), la ruta y la empresa activa: nunca datos de
// empleados. Máximo 10 por sesión y sin repetir el mismo mensaje.
const vistos = new Set<string>()
let enviados = 0

export function reportarError(mensaje: string, detalle = '') {
  if (!REMOTE_ENABLED || typeof window === 'undefined' || enviados >= 10) return
  const clave = mensaje.slice(0, 200)
  if (!clave || vistos.has(clave)) return
  vistos.add(clave); enviados++
  void apiJson('/api/errores', {
    method: 'POST',
    body: JSON.stringify({
      mensaje: mensaje.slice(0, 500), detalle: detalle.slice(0, 3000),
      ruta: window.location.pathname, empresaId: getAcceso()?.activa?.id,
    }),
  }).catch(() => { /* sin sesión o sin red: no hay nada que hacer */ })
}

// Errores no capturados. Se ignoran los de extensiones del navegador y el
// aviso inofensivo de ResizeObserver.
export function instalarReporteDeErrores(): () => void {
  const onError = (e: ErrorEvent) => {
    if (e.filename && !e.filename.startsWith(window.location.origin)) return
    if (/ResizeObserver loop/i.test(e.message)) return
    reportarError(e.message || 'Error de script', e.error?.stack ?? '')
  }
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason
    reportarError(`Promesa rechazada: ${r?.message ?? String(r)}`, r?.stack ?? '')
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection) }
}
