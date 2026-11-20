'use client'
import { useEffect, useState } from 'react'
import type { CatalogosMT } from '@/lib/dgt-mt'

// Catálogos oficiales del Ministerio de Trabajo (nacionalidades, ocupaciones,
// niveles educativos, discapacidades). ~240 KB: se descargan una sola vez, y solo
// cuando alguien abre la sección que los necesita.
let cache: CatalogosMT | null = null
let pendiente: Promise<CatalogosMT> | null = null

export function cargarCatalogosMT(): Promise<CatalogosMT> {
  if (cache) return Promise.resolve(cache)
  if (!pendiente) {
    pendiente = fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/catalogos-mt.json`)
      .then(r => { if (!r.ok) throw new Error('catálogos'); return r.json() as Promise<CatalogosMT> })
      .then(c => (cache = c))
      .catch(e => { pendiente = null; throw e })
  }
  return pendiente
}

export function useCatalogosMT(): CatalogosMT | null {
  const [c, setC] = useState<CatalogosMT | null>(cache)
  useEffect(() => { if (!cache) cargarCatalogosMT().then(setC).catch(() => {}) }, [])
  return c
}
