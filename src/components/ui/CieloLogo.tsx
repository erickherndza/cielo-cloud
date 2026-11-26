const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/**
 * Logo de Cielo Cloud Nómina. Muestra la versión clara o la oscura según el tema
 * (`darkMode: 'class'`). `variant="dark"` fuerza la versión oscura (para fondos
 * siempre oscuros, como el panel azul del login).
 */
export function CieloLogo({ className = 'h-11', variant = 'auto' }: { className?: string; variant?: 'auto' | 'dark' }) {
  if (variant === 'dark') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`${BASE}/cielo-erp-logo-dark.png`} alt="Cielo Cloud Nómina" className={`${className} w-auto object-contain`} />
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${BASE}/cielo-erp-logo.png`} alt="Cielo Cloud Nómina" className={`${className} w-auto object-contain dark:hidden`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${BASE}/cielo-erp-logo-dark.png`} alt="Cielo Cloud Nómina" className={`${className} w-auto object-contain hidden dark:block`} />
    </>
  )
}
