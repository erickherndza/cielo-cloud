'use client'
// Llena las plantillas Excel OFICIALES (TSS autodeterminación v5.5 y Plantilla General
// del Ministerio de Trabajo) con los datos del sistema, conservando su formato, logos,
// listas desplegables, comentarios y macros (public/plantillas/*.xlsm, generadas por
// scripts/build-plantillas.py). Las celdas de datos de esas plantillas son de TEXTO y
// la macro "Generar Archivo" las lee tal cual, por eso todo se escribe como texto.

import type { FilaAM } from '@/lib/tss-autodeterminacion'
import type { FilaDGT, TipoDGT, CatalogosMT, ExtrasDGT } from '@/lib/dgt-mt'

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

async function abrir(nombre: string, hojaPath = 'xl/worksheets/sheet1.xml') {
  const r = await fetch(`${BASE()}/plantillas/${nombre}`)
  if (!r.ok) throw new Error('No se pudo cargar la plantilla oficial')
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await r.arrayBuffer())
  const hoja = await zip.file(hojaPath)!.async('string')
  return { zip, hoja }
}

async function cerrar(zip: import('jszip'), hoja: string, hojaPath = 'xl/worksheets/sheet1.xml'): Promise<Blob> {
  // createFolders:false — Excel rechaza paquetes con entradas de carpeta que la plantilla original no trae
  zip.file(hojaPath, hoja, { createFolders: false })
  return zip.generateAsync({ type: 'blob', mimeType: MIME_XLSM, compression: 'DEFLATE', platform: 'DOS' })
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

function colLetra(n: number): string { let r = ''; while (n > 0) { const m = (n - 1) % 26; r = String.fromCharCode(65 + m) + r; n = Math.floor((n - 1) / 26) } return r }

// Hoja de cada formulario dentro de la Plantilla General del Ministerio (orden del libro original).
const HOJA_DGT: Record<TipoDGT, { n: number; idx: number }> = {
  DGT3: { n: 1, idx: 0 }, DGT4: { n: 1, idx: 0 }, DGT2: { n: 2, idx: 1 }, DGT5: { n: 3, idx: 2 }, DGT11: { n: 4, idx: 3 }, DGT12: { n: 5, idx: 4 },
}

/** Plantilla General del Ministerio de Trabajo, hoja del formulario elegido. Datos desde la fila 14. */
export async function plantillaDGT(args: { rnc: string; mes: number; anio: number; tipo: TipoDGT; filas: FilaDGT[]; cat: CatalogosMT | null; extras?: ExtrasDGT }): Promise<Blob> {
  const { tipo } = args
  const cfg = HOJA_DGT[tipo]
  const path = `xl/worksheets/sheet${cfg.n}.xml`
  const { zip, hoja: h0 } = await abrir('dgt.xlsm', path)
  let hoja = h0
  const etq = (lista: [string, string][] | undefined, c: string) => { if (!c) return ''; const x = lista?.find(([, k]) => k === c); return x ? `${x[0]}-${x[1]}` : c }
  const H = cfg.n === 1 ? 'D' : 'E'   // la macro lee RNC/período/tipo en D (DGT-3/4) o en E (resto)
  hoja = escribirFila(hoja, 7, { [H]: args.rnc.replace(/\D/g, '') })
  hoja = escribirFila(hoja, 8, { [H]: `${String(args.mes).padStart(2, '0')}${args.anio}` })
  hoja = escribirFila(hoja, 9, { [H]: tipo })
  const f10: Record<string, Valor> = { F: String(args.filas.length) }
  if (tipo === 'DGT11') hoja = escribirFila(hoja, 11, { E: String(args.extras?.duracionMeses ?? '').padStart(2, '0') })
  if (tipo === 'DGT11') f10.E = (args.extras?.fechaInicioTemporada ?? '').replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3$2$1')
  hoja = escribirFila(hoja, 10, f10)
  const nov = (t: string) => (t === 'NI' ? 'Ingreso' : t === 'NS' ? 'Salida' : 'Cambio')
  const nivel = (f: FilaDGT) => etq(args.cat?.edu, f.nivelEdu)
  const disc = (f: FilaDGT) => f.discapacidades.split(',').filter(Boolean).map(c => etq(args.cat?.disc, c)).join(',')
  const ocup = (f: FilaDGT) => (f.ocupacion ? etq(args.cat?.ocup, f.ocupacion) || `${f.ocupacionDesc}-${f.ocupacion}` : '')
  args.filas.forEach((f, i) => {
    const comun: Record<string, Valor> = {
      B: nov(f.tipoNov), C: String(i + 1), D: f.tipoDoc, E: f.documento, F: f.nombres, G: f.apellido1, H: f.apellido2, I: f.sexo,
      J: etq(args.cat?.nac, f.nacionalidad), K: f.fechaNac,
    }
    let fila: Record<string, Valor>
    if (tipo === 'DGT2') {
      fila = { ...comun, B: 'NC', L: f.establecimiento, M: money(f.valorHora ?? 0), CA: f.causa ?? '' }
      for (const [dia, v] of Object.entries(f.horasDia ?? {})) {
        const d = Number(dia)
        fila[colLetra(15 + 2 * (d - 1))] = v.h.toFixed(2)
        fila[colLetra(16 + 2 * (d - 1))] = v.pct.toFixed(2)
      }
    } else if (tipo === 'DGT12') {
      fila = { ...comun, B: 'Ingreso', L: money(f.salario), N: f.localidad ?? '', Q: f.fechaSalida }
    } else {
      fila = {
        ...comun, L: money(f.salario), M: f.fechaIngreso, N: f.fechaSalida, O: ocup(f), P: f.ocupacionDesc,
        Q: f.inicioVac, R: f.finVac, S: f.turno, T: f.establecimiento, U: tipo === 'DGT4' ? f.fechaCambio : '',
        AF: nivel(f), AG: disc(f),
      }
      if (tipo === 'DGT5') { fila.AB = String(f.dias ?? ''); fila.AC = (f.salarioDia ?? 0).toFixed(2) }
      if (tipo === 'DGT11') fila.B = 'Ingreso'
    }
    hoja = escribirFila(hoja, 14 + i, fila)
  })
  // Que el libro abra en la hoja del formulario elegido
  if (cfg.idx > 0) {
    const wbPath = 'xl/workbook.xml'
    const wb = await zip.file(wbPath)!.async('string')
    zip.file(wbPath, wb.replace(/<workbookView /, `<workbookView activeTab="${cfg.idx}" `), { createFolders: false })
    const s1Path = 'xl/worksheets/sheet1.xml'
    const s1 = await zip.file(s1Path)!.async('string')
    zip.file(s1Path, s1.replace(' tabSelected="1"', ''), { createFolders: false })
    hoja = hoja.replace(/<sheetView /, '<sheetView tabSelected="1" ')
  }
  return cerrar(zip, hoja, path)
}

export function descargarBlob(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nombre
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
