import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/lib/theme'
import { EmpleadosProvider } from '@/lib/empleados-context'
import { PeriodosProvider } from '@/lib/periodos-context'
import { EmpresaProvider } from '@/lib/empresa-context'
import { PrestamosProvider } from '@/lib/prestamos-context'
import { AumentosProvider } from '@/lib/aumentos-context'
import { LicenciasProvider } from '@/lib/licencias-context'
import { HorasExtrasProvider } from '@/lib/horas-extras-context'
import { BandasSalarialesProvider } from '@/lib/bandas-salariales-context'
import { ConceptosPersonalizadosProvider } from '@/lib/conceptos-personalizados-context'
import { LiquidacionesProvider } from '@/lib/liquidaciones-context'
import { SaldoISRProvider } from '@/lib/saldo-isr-context'
import { FeriadosProvider } from '@/lib/feriados-context'
import { VacacionesProvider } from '@/lib/vacaciones-context'
import { RetribucionesProvider } from '@/lib/retribuciones-context'
import { AuthProvider } from '@/lib/auth-context'
import { ConfirmProvider } from '@/lib/confirm-context'
import { RemoteStoreProvider } from '@/lib/remote-store'
import { SyncGate } from '@/components/layout/SyncGate'
import { RouteGuard } from '@/components/auth/RouteGuard'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Cielo Cloud — Gestión de Nómina',
  description:
    'Sistema de nómina para pymes dominicanas. Cálculo automático de TSS, ISR, regalía pascual y vacaciones según legislación dominicana.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var t = localStorage.getItem('cielo-theme');
            var p = window.matchMedia('(prefers-color-scheme: dark)').matches;
            if (t === 'dark' || (!t && p)) document.documentElement.classList.add('dark');
          } catch(e) {}
        `}} />
      </head>
      <body className="flex h-screen overflow-hidden bg-tabler-bg dark:bg-[#171717] font-sans transition-colors duration-200">
        <ThemeProvider>
          <ConfirmProvider>
          <AuthProvider>
            <RemoteStoreProvider>
            <SyncGate>
            <EmpresaProvider>
              <EmpleadosProvider>
                <BandasSalarialesProvider>
                  <ConceptosPersonalizadosProvider>
                    <PrestamosProvider>
                      <AumentosProvider>
                        <LicenciasProvider>
                          <HorasExtrasProvider>
                          <LiquidacionesProvider>
                            <SaldoISRProvider>
                              <PeriodosProvider>
                                <FeriadosProvider>
                                  <VacacionesProvider>
                                    <RetribucionesProvider>
                                      <RouteGuard>{children}</RouteGuard>
                                    </RetribucionesProvider>
                                  </VacacionesProvider>
                                </FeriadosProvider>
                              </PeriodosProvider>
                            </SaldoISRProvider>
                          </LiquidacionesProvider>
                          </HorasExtrasProvider>
                        </LicenciasProvider>
                      </AumentosProvider>
                    </PrestamosProvider>
                  </ConceptosPersonalizadosProvider>
                </BandasSalarialesProvider>
              </EmpleadosProvider>
            </EmpresaProvider>
          </SyncGate>
            </RemoteStoreProvider>
          </AuthProvider>
          </ConfirmProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
