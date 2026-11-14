'use client'

import { useState } from 'react'
import { CheckCircle2, CircleAlert, ShieldCheck, Loader2 } from 'lucide-react'
import { REMOTE_ENABLED } from '@/lib/storage'
import { rncValido, limpiarRnc, formatearRnc, validarRncDgii, type DatosDgii, type ResultadoDgii } from '@/lib/rnc'

const INPUT = 'w-full rounded-lg border border-zinc-200 dark:border-[#252840] bg-white dark:bg-[#1a1d2e] dark:text-zinc-200 px-3 py-2 text-sm focus:border-[#1B2980] focus:outline-none'

// Campo de RNC con validación local (dígito verificador) y, si hay servidor,
// botón «Validar con DGII» que trae razón social, estado, actividad, etc.
export function RncField({
  id = 'rnc', value, onChange, onDatos, nombreActual, onUsarNombre,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  onDatos?: (d: DatosDgii) => void
  nombreActual?: string
  onUsarNombre?: (nombre: string) => void
}) {
  const [cargando, setCargando] = useState(false)
  const [res, setRes] = useState<ResultadoDgii | null>(null)
  const digitos = limpiarRnc(value)
  const formatoOk = rncValido(value)
  const incompleto = digitos.length > 0 && digitos.length < 9
  const err = digitos.length >= 9 && !formatoOk

  async function validar() {
    setCargando(true); setRes(null)
    const r = await validarRncDgii(value)
    setRes(r); setCargando(false)
    if (r.estado === 'ok') {
      onChange(formatearRnc(r.datos.rnc))
      onDatos?.(r.datos)
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <input id={id} name={id} value={value} inputMode="numeric" placeholder="Ej. 101-12345-6"
          onChange={e => { onChange(e.target.value); setRes(null) }}
          onBlur={() => { if (formatoOk) onChange(formatearRnc(value)) }}
          className={INPUT} />
        {REMOTE_ENABLED && (
          <button type="button" onClick={validar} disabled={!formatoOk || cargando}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#1B2980] px-3 text-xs font-semibold text-white hover:bg-[#151f66] disabled:opacity-40">
            {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Validar con DGII
          </button>
        )}
      </div>

      {err && <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400"><CircleAlert className="h-3 w-3" /> RNC inválido: los dígitos no coinciden con el verificador. Revísalo.</p>}
      {incompleto && <p className="mt-1.5 text-[11px] text-zinc-400">El RNC tiene 9 dígitos (11 si es cédula).</p>}
      {formatoOk && !res && <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Formato válido{REMOTE_ENABLED ? ' — pulsa «Validar con DGII» para traer los datos' : ''}</p>}

      {res?.estado === 'ok' && (
        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-800/40 dark:bg-emerald-950/20">
          <p className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Encontrado en la DGII</p>
          <p className="mt-1 font-medium text-zinc-800 dark:text-zinc-100">{res.datos.razonSocial}</p>
          <p className="text-zinc-500">{[res.datos.nombreComercial, res.datos.regimenPagos && `Régimen ${res.datos.regimenPagos}`, res.datos.administracionLocal].filter(Boolean).join(' · ')}</p>
          {res.datos.actividadEconomica && <p className="mt-0.5 text-zinc-500">{res.datos.actividadEconomica}</p>}
          {res.datos.estado && res.datos.estado.toUpperCase() !== 'ACTIVO' && (
            <p className="mt-2 flex items-center gap-1.5 rounded bg-amber-100 px-2 py-1 font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <CircleAlert className="h-3.5 w-3.5 shrink-0" /> La DGII muestra este RNC como {res.datos.estado}. Puedes continuar, pero verifícalo con el cliente.
            </p>
          )}
          {onUsarNombre && nombreActual?.trim() && nombreActual.trim().toLowerCase() !== res.datos.razonSocial.toLowerCase() && (
            <button type="button" onClick={() => onUsarNombre(res.datos.razonSocial)} className="mt-2 font-semibold text-[#1B2980] underline dark:text-indigo-300">Usar la razón social como nombre</button>
          )}
        </div>
      )}
      {res?.estado === 'no-inscrito' && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-800/40 dark:bg-rose-950/20 dark:text-rose-300">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> La DGII dice que este RNC no está inscrito como contribuyente. Revisa que esté bien escrito.
        </p>
      )}
      {(res?.estado === 'no-disponible' || res?.estado === 'invalido') && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {res.mensaje}{res.estado === 'no-disponible' ? ' El formato es válido: puedes continuar y validarlo después.' : ''}
        </p>
      )}
    </div>
  )
}
