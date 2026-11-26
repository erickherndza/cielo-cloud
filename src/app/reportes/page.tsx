'use client'

import { useState, useCallback, useEffect } from 'react'
import { BarChart3, Users, FileText, CreditCard, Shield, Building2, Calendar, Briefcase, Landmark, Clock, Target, Timer, History, UserX, FileClock, FileCheck2 } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Toast } from '@/components/ui/Toast'
import { useEmpleados } from '@/lib/empleados-context'
import { usePeriodos } from '@/lib/periodos-context'
import { usePrestamos } from '@/lib/prestamos-context'
import { useEmpresa } from '@/lib/empresa-context'
import { useLiquidaciones } from '@/lib/liquidaciones-context'
import { useLicencias } from '@/lib/licencias-context'
import { ReporteAutodeterminacion } from '@/components/reportes/ReporteAutodeterminacion'
import { ReporteDGT } from '@/components/reportes/ReporteDGT'
import { ReporteGerencial } from '@/components/reportes/ReporteGerencial'
import { ReporteNomina } from '@/components/reportes/ReporteNomina'
import { ReporteEmpleados } from '@/components/reportes/ReporteEmpleados'
import { ReportePrestamos } from '@/components/reportes/ReportePrestamos'
import { ReporteTSS } from '@/components/reportes/ReporteTSS'
import { ReporteCostoPorDepto } from '@/components/reportes/ReporteCostoPorDepto'
import { ReportePlanillaACH } from '@/components/reportes/ReportePlanillaACH'
import { ReporteHorasExtras } from '@/components/reportes/ReporteHorasExtras'
import { ReporteProyeccionAnual } from '@/components/reportes/ReporteProyeccionAnual'
import { ReportePreaviso } from '@/components/reportes/ReportePreaviso'
import { ReporteAntiguedad } from '@/components/reportes/ReporteAntiguedad'
import { ReporteSinIngresos } from '@/components/reportes/ReporteSinIngresos'
import { ReporteLicencias } from '@/components/reportes/ReporteLicencias'

// ─── Types ────────────────────────────────────────────────────────────────────
type ReportId = 'gerencial' | 'nomina' | 'empleados' | 'prestamos' | 'tss' | 'departamento' | 'bancaria' | 'horas_extras' | 'proyeccion' | 'preaviso' | 'antiguedad' | 'sin_ingresos' | 'licencias' | 'autodeterminacion' | 'dgt'

interface SidebarItem {
  id: ReportId
  label: string
  icon: React.ComponentType<{ className?: string }>
  desc: string
  grupo?: string   // encabezado que se muestra antes de este ítem
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: 'gerencial',    label: 'Resumen Gerencial',       icon: BarChart3,  desc: 'KPIs y tendencias de nómina' },
  { id: 'nomina',       label: 'Nómina por Período',      icon: FileText,   desc: 'Detalle de nómina por período' },
  { id: 'empleados',    label: 'Listado de Empleados',    icon: Users,      desc: 'Plantilla y datos laborales' },
  { id: 'prestamos',    label: 'Reporte de Préstamos',    icon: CreditCard, desc: 'Cartera de préstamos y saldos' },
  { id: 'tss',          label: 'Cumplimiento Fiscal',     icon: Shield,     desc: 'Conciliación TSS/DGII — factura CNSS e ISR retenido' },
  { id: 'departamento', label: 'Costo por Departamento',  icon: Building2,  desc: 'Masa salarial y headcount por área' },
  { id: 'bancaria',     label: 'Planilla Bancaria / ACH', icon: Landmark,   desc: 'Transferencias agrupadas por banco' },
  { id: 'horas_extras', label: 'Horas Extras',            icon: Clock,      desc: 'HE 35 % / 100 % y topes Art. 155' },
  { id: 'proyeccion',   label: 'Proyección Anual',        icon: Target,     desc: 'Costo proyectado vs ejecutado YTD' },
  { id: 'preaviso',     label: 'Cumplimiento de Preaviso', icon: Timer,     desc: 'Renuncias — anticipación vs. Art. 76' },
  { id: 'antiguedad',   label: 'Antigüedad de Plantilla', icon: History,   desc: 'Distribución por rango de años y por posición' },
  { id: 'sin_ingresos', label: 'Empleados Sin Ingresos',  icon: UserX,      desc: 'Integridad pre-cierre — activos sin nómina registrada' },
  { id: 'licencias',    label: 'Salario vs. Licencias',   icon: FileClock, desc: 'Impacto salarial de licencias registradas, por tipo y mes' },
  { id: 'autodeterminacion', label: 'Autodeterminación mensual', icon: FileCheck2, desc: 'Archivo para la TSS (SUIRPLUS): salarios, aportes y exentos', grupo: 'Reportes regulatorios' },
  { id: 'dgt',          label: 'Ministerio de Trabajo',   icon: Briefcase, desc: 'Formularios DGT-3, DGT-4 y demás (SIRLA)' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ReportesPage() {
  const [activeReport, setActiveReport] = useState<ReportId>('gerencial')
  const [toast, setToast] = useState<string | null>(null)
  // Enlace directo desde las alertas: /reportes?reporte=sin_ingresos&periodo=<mes>-<año>
  const [periodoInicial, setPeriodoInicial] = useState<string | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const r = q.get('reporte') as ReportId | null
    if (r && SIDEBAR_ITEMS.some(x => x.id === r)) {
      setActiveReport(r)
      setPeriodoInicial(q.get('periodo'))
    }
  }, [])

  const { empleados } = useEmpleados()
  const { periodos }  = usePeriodos()
  const { prestamos } = usePrestamos()
  const { empresa }   = useEmpresa()
  const { liquidaciones } = useLiquidaciones()
  const { licencias } = useLicencias()

  const renderReport = useCallback(() => {
    const props = { empresa, empleados, periodos, prestamos, liquidaciones, licencias }
    switch (activeReport) {
      case 'gerencial':    return <ReporteGerencial      {...props} />
      case 'nomina':       return <ReporteNomina          {...props} />
      case 'empleados':    return <ReporteEmpleados       {...props} />
      case 'prestamos':    return <ReportePrestamos       {...props} />
      case 'tss':          return <ReporteTSS             {...props} />
      case 'departamento': return <ReporteCostoPorDepto   {...props} />
      case 'bancaria':     return <ReportePlanillaACH     {...props} />
      case 'horas_extras': return <ReporteHorasExtras     {...props} />
      case 'proyeccion':   return <ReporteProyeccionAnual {...props} />
      case 'preaviso':     return <ReportePreaviso        {...props} />
      case 'antiguedad':   return <ReporteAntiguedad      {...props} />
      case 'sin_ingresos': return <ReporteSinIngresos     {...props} periodoInicial={periodoInicial} />
      case 'licencias':    return <ReporteLicencias       {...props} />
      case 'autodeterminacion': return <ReporteAutodeterminacion />
      case 'dgt':          return <ReporteDGT />
    }
  }, [activeReport, periodoInicial, empresa, empleados, periodos, prestamos, liquidaciones, licencias])

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header
        title="Reportería"
        subtitle="Análisis, exportación y cumplimiento regulatorio"
        actions={
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-zinc-400" />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {new Date().toLocaleDateString('es-DO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          </div>
        }
      />

      <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
        {/* Sidebar */}
        <aside className="w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-tabler-line dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] md:overflow-y-auto">
          {/* Móvil: selector compacto */}
          <div className="md:hidden p-3">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">Tipo de reporte</label>
            <select
              value={activeReport}
              onChange={e => setActiveReport(e.target.value as typeof activeReport)}
              className="w-full rounded-lg border border-tabler-line dark:border-[#2e2e2e] bg-zinc-50 dark:bg-[#262626] dark:text-zinc-200 py-2.5 pl-3 pr-8 text-sm font-medium text-zinc-800"
            >
              {SIDEBAR_ITEMS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
          <div className="hidden md:block p-3">
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Tipos de Reporte</p>
            <nav className="space-y-0.5">
              {SIDEBAR_ITEMS.map(item => {
                const Icon = item.icon
                const active = activeReport === item.id
                return (
                  <div key={item.id}>
                  {item.grupo && <p className="mb-2 mt-4 px-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">{item.grupo}</p>}
                  <button
                    onClick={() => setActiveReport(item.id)}
                    className={`w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      active
                        ? 'bg-[#1B2980] text-white'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-[#262626] hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-indigo-200' : 'text-zinc-400 dark:text-zinc-500'}`} />
                    <div className="min-w-0">
                      <p className={`text-sm leading-tight tracking-tight ${active ? 'font-semibold text-white' : 'font-medium text-zinc-700 dark:text-zinc-300'}`}>{item.label}</p>
                      <p className={`text-[10px] leading-tight mt-0.5 tracking-wide ${active ? 'text-indigo-200' : 'text-zinc-400 dark:text-zinc-500'}`}>{item.desc}</p>
                    </div>
                  </button>
                  </div>
                )
              })}
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-tabler-bg dark:bg-[#171717]">
          {renderReport()}
        </main>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  )
}
