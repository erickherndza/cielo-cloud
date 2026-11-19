import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string
  sub?: string
  icon: LucideIcon
  iconColor?: string
  trend?: 'up' | 'down' | 'neutral'
  trendLabel?: string
}

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  iconColor = 'bg-[#eef0fb] text-[#1B2980]',
  trend,
  trendLabel,
}: StatCardProps) {
  return (
    <div className="t-card p-4 md:p-5 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <p className="t-subheader min-w-0">{label}</p>
        <div className={cn('hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', iconColor)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="whitespace-nowrap text-xl font-semibold text-tabler-ink dark:text-zinc-100 leading-tight tabular-nums">{value}</p>
        {trend && trendLabel && (
          <span
            className={cn(
              'flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold shrink-0',
              trend === 'up'   ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' :
              trend === 'down' ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400' :
                                  'bg-zinc-50 text-zinc-600 dark:bg-[#262626] dark:text-zinc-400'
            )}
          >
            {trend === 'up' && <TrendingUp className="h-3 w-3" />}
            {trend === 'down' && <TrendingDown className="h-3 w-3" />}
            {trendLabel}
          </span>
        )}
      </div>
      {sub && <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500 border-t border-zinc-50 dark:border-[#2a2a2a] pt-2">{sub}</p>}
    </div>
  )
}
