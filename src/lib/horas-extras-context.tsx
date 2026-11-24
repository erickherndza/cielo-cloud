'use client'

import { storage } from './storage'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { RegistroHoraExtra, TipoHoraExtra } from '@/types'
import { useUserScopedKey } from './user-scoped-key'
import { parseFechaLocal } from './utils'

const KEY = 'cielo-horas-extras'

// Art. 155 Código de Trabajo: máximo 80 horas extras por trimestre y 24 por semana (aprox. de ley).
export const TOPE_SEMANAL_HE = 24

interface Ctx_ {
  registros: RegistroHoraExtra[]
  registrar: (r: { empleadoId: string; fecha: string; horas: number; tipo: TipoHoraExtra; motivo?: string }) => void
  eliminar: (id: string) => void
  // Suma de horas del empleado en [desde, hasta] (inclusive), separada por tipo.
  horasEnRango: (empleadoId: string, desde: Date, hasta: Date) => { he35: number; he100: number; registros: number }
  // Horas extras (ambos tipos) del empleado en la semana lunes–domingo que contiene `fecha`.
  horasSemana: (empleadoId: string, fecha: string) => number
}

const Ctx = createContext<Ctx_>({
  registros: [], registrar: () => {}, eliminar: () => {},
  horasEnRango: () => ({ he35: 0, he100: 0, registros: 0 }), horasSemana: () => 0,
})

export function inicioSemana(fecha: Date): Date {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate())
  const dow = (d.getDay() + 6) % 7   // lunes = 0
  d.setDate(d.getDate() - dow)
  return d
}

export function HorasExtrasProvider({ children }: { children: ReactNode }) {
  const [registros, setRegistros] = useState<RegistroHoraExtra[]>([])
  const { key, ready } = useUserScopedKey(KEY)

  useEffect(() => {
    if (!ready) return
    try {
      const raw = storage.getItem(key)
      setRegistros(raw ? JSON.parse(raw) as RegistroHoraExtra[] : [])
    } catch { setRegistros([]) }
  }, [key, ready])

  function persist(next: RegistroHoraExtra[]) {
    setRegistros(next)
    try { storage.setItem(key, JSON.stringify(next)) } catch { /* ignore */ }
  }

  function registrar(r: { empleadoId: string; fecha: string; horas: number; tipo: TipoHoraExtra; motivo?: string }) {
    const horas = Math.round(r.horas * 100) / 100
    if (!(horas > 0) || horas > 24) return
    persist([
      ...registros,
      { id: crypto.randomUUID(), empleadoId: r.empleadoId, fecha: r.fecha, horas, tipo: r.tipo, motivo: r.motivo?.trim() || undefined, fechaRegistro: new Date().toISOString() },
    ])
  }

  function eliminar(id: string) { persist(registros.filter(x => x.id !== id)) }

  function horasEnRango(empleadoId: string, desde: Date, hasta: Date) {
    let he35 = 0, he100 = 0, n = 0
    for (const r of registros) {
      if (r.empleadoId !== empleadoId) continue
      const f = parseFechaLocal(r.fecha)
      if (f < desde || f > hasta) continue
      n++
      if (r.tipo === 'he100') he100 += r.horas; else he35 += r.horas
    }
    return { he35: Math.round(he35 * 100) / 100, he100: Math.round(he100 * 100) / 100, registros: n }
  }

  function horasSemana(empleadoId: string, fecha: string) {
    const ini = inicioSemana(parseFechaLocal(fecha))
    const fin = new Date(ini); fin.setDate(fin.getDate() + 6)
    const r = horasEnRango(empleadoId, ini, fin)
    return r.he35 + r.he100
  }

  return <Ctx.Provider value={{ registros, registrar, eliminar, horasEnRango, horasSemana }}>{children}</Ctx.Provider>
}

export function useHorasExtras() { return useContext(Ctx) }
