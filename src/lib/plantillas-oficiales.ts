'use client'
// Llena las plantillas Excel OFICIALES (TSS autodeterminación v5.5 y Plantilla General
// del Ministerio de Trabajo) con los datos del sistema, conservando su formato, logos,
// listas desplegables, comentarios y macros (public/plantillas/*.xlsm, generadas por
// scripts/build-plantillas.py). Las celdas de datos de esas plantillas son de TEXTO y
// la macro "Generar Archivo" las lee tal cual, por eso todo se escribe como texto.

import type { FilaAM } from '@/lib/tss-autodeterminacion'
import type { FilaDGT, TipoDGT, CatalogosMT } from '@/lib/dgt-mt'

const BASE = () => process.env.NEXT_PUBLIC_BASE_PATH ?? ''
export const MIME_XLSM = 'application/vnd.ms-excel.sheet.macroEnabled.12'

type Valor = string | number
const esc = (v: string) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const money = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(2)

function colIdx(col: string): number { return col.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) }

function celdaXml(ref: string, estilo: string | null, v: Valor): string {
  const s = estilo ? ` s="${estilo}"` : ''
  if (v === '' || v === null || v === undefined) return `<c r="${ref}"${s}/>`
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`
}

/** Escribe valores en una fila de la hoja (conserva el estilo de cada celda; crea la fila/celda si falta). */
export function escribirFila(xml: string, fila: number, valores: Record<string, Valor>): string {
  const reFila = new RegExp(`<row r="${fila}"(?:\\s[^>]*?)?(?:/>|>[\\s\\S]*?</row>)`)
  let m = reFila.exec(xml)
  if (!m) {
    const nueva = `<row r="${fila}">${Object.keys(valores).sort((a, b) => colIdx(a) - colIdx(b)).map(c => celdaXml(`${c}${fila}`, null, valores[c])).join('')}</row>`
    const fin = xml.lastIndexOf('</sheetData>')
    return xml.slice(0, fin) + nueva + xml.slice(fin)
  }
  let filaXml = m[0]
  if (filaXml.endsWith('/>')) filaXml = filaXml.replace(/\/>$/, '></row>')
  for (const col of Object.keys(valores).sort((a, b) => colIdx(a) - colIdx(b))) {
    const ref = `${col}${fila}`
    const reCel = new RegExp(`<c r="${ref}"((?:\\s[^>]*?)?)(?:/>|>[\\s\\S]*?</c>)`)
    const cm = reCel.exec(filaXml)
    if (cm) {
      const st = /\ss="(\d+)"/.exec(cm[1])
      filaXml = filaXml.replace(reCel, () => celdaXml(ref, st ? st[1] : null, valores[col]))
    } else {
      // insertar en orden de columna
      const refs = Array.from(filaXml.matchAll(/<c r="([A-Z]+)\d+"/g))
      const despues = refs.find(r => colIdx(r[1]) > colIdx(col))
      const nueva = celdaXml(ref, null, valores[col])
      filaXml = despues ? filaXml.replace(`<c r="${despues[1]}${fila}"`, () => nueva + `<c r="${despues[1]}${fila}"`) : filaXml.replace('</row>', () => nueva + '</row>')
    }
  }
  return xml.slice(0, m.index) + filaXml + xml.slice(m.index + m[0].length)
}

async function abrir(nombre: string) {
  const r = await fetch(`${BASE()}/plantillas/${nombre}`)
  if (!r.ok) throw new Error('No se pudo cargar la plantilla oficial')
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await r.arrayBuffer())
  const hoja = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
  return { zip, hoja }
}

async function cerrar(zip: import('jszip'), hoja: string): Promise<Blob> {
  zip.file('xl/worksheets/sheet1.xml', hoja)
  return zip.generateAsync({ type: 'blob', mimeType: MIME_XLSM, compression: 'DEFLATE' })
}

/** Plantilla de Archivo AutoDeterminación v5.5 (TSS). Datos desde la fila 14. */
export async function plantillaAutodeterminacion(args: { rnc: string; mes: number; anio: number; filas: FilaAM[]; proceso?: 'AM' | 'AR' }): Promise<Blob> {
  const { zip, hoja: h0 } = await abrir('autodeterminacion.xlsm')
  let hoja = h0
  const per = `${String(args.mes).padStart(2, '0')}${args.anio}`
  hoja = escribirFila(hoja, 6, { D: args.proceso ?? 'AM' })
  hoja = escribirFila(hoja, 7, { D: args.rnc.replace(/\D/g, '') })
  hoja = escribirFila(hoja, 8, { D: per })
  hoja = escribirFila(hoja, 10, { E: String(args.filas.length) })
  const tipo = (t: string) => (t === '0009' ? 'Entrada de trabajador' : t === '0010' ? 'Salida de trabajador' : 'Normal')
  args.filas.forEach((f, i) => {
    hoja = escribirFila(hoja, 14 + i, {
      B: f.clave, C: f.tipoDoc, D: f.documento, E: f.nombres, F: f.apellido1, G: f.apellido2, H: f.sexo, I: f.fechaNac,
      J: money(f.salarioSS), K: money(f.aporteVoluntario), L: money(f.salarioISR), M: tipo(f.tipoIngreso), N: money(f.otrasRemuneraciones),
      O: '', P: money(0), Q: money(0), R: money(f.exentoRegalia), S: money(f.exentoIndemnizaciones), T: money(0), U: money(0),
    })
  })
  return cerrar(zip, hoja)
}

/** Plantilla General del Ministerio de Trabajo, hoja "Plantilla DGT3-DGT4". Datos desde la fila 14. */
export async function plantillaDGT(args: { rnc: string; mes: number; anio: number; tipo: TipoDGT; filas: FilaDGT[]; cat: CatalogosMT | null }): Promise<Blob> {
  const { zip, hoja: h0 } = await abrir('dgt.xlsm')
  let hoja = h0
  const etq = (lista: [string, string][] | undefined, c: string) => { if (!c) return ''; const x = lista?.find(([, k]) => k === c); return x ? `${x[0]}-${x[1]}` : c }
  hoja = escribirFila(hoja, 7, { D: args.rnc.replace(/\D/g, '') })
  hoja = escribirFila(hoja, 8, { D: `${String(args.mes).padStart(2, '0')}${args.anio}` })
  hoja = escribirFila(hoja, 9, { D: args.tipo })
  hoja = escribirFila(hoja, 10, { F: String(args.filas.length) })
  const nov = (t: string) => (t === 'NI' ? 'Ingreso' : t === 'NS' ? 'Salida' : 'Cambio')
  args.filas.forEach((f, i) => {
    hoja = escribirFila(hoja, 14 + i, {
      B: nov(f.tipoNov), C: String(i + 1), D: f.tipoDoc, E: f.documento, F: f.nombres, G: f.apellido1, H: f.apellido2, I: f.sexo,
      J: etq(args.cat?.nac, f.nacionalidad), K: f.fechaNac, L: money(f.salario), M: f.fechaIngreso, N: f.fechaSalida,
      O: f.ocupacion ? etq(args.cat?.ocup, f.ocupacion) || `${f.ocupacionDesc}-${f.ocupacion}` : '', P: f.ocupacionDesc,
      Q: f.inicioVac, R: f.finVac, S: f.turno, T: f.establecimiento, U: args.tipo === 'DGT4' ? f.fechaCambio : '',
      AF: etq(args.cat?.edu, f.nivelEdu), AG: f.discapacidades.split(',').filter(Boolean).map(c => etq(args.cat?.disc, c)).join(','),
    })
  })
  return cerrar(zip, hoja)
}

export function descargarBlob(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nombre
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
