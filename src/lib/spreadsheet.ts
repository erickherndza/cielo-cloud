'use client'

// Lectura y generación de hojas de cálculo para los importadores (Carga
// Inicial, Horas, Aumentos). Reemplaza a `xlsx` (SheetJS), que tiene
// vulnerabilidades sin parche en npm (prototype pollution y ReDoS), por
// `exceljs` (ya usado en las exportaciones) + un lector CSV propio.
//
// Principios:
//  - El archivo se trata SIEMPRE como datos: no se ejecutan fórmulas ni macros
//    (de las fórmulas solo se toma el último valor calculado).
//  - Límites de tamaño y de filas/columnas, para que un archivo enorme o
//    malicioso no congele ni agote la memoria del navegador.
//  - Solo .xlsx y .csv. El .xls binario antiguo ya no se admite (es el formato
//    con más historial de fallos en los parsers).

import ExcelJS from 'exceljs'

export const MAX_ARCHIVO_BYTES = 5 * 1024 * 1024
export const MAX_FILAS = 5000
export const MAX_COLUMNAS = 60

// Número de serie de Excel → 'YYYY-MM-DD' (época de Excel: 1899-12-30, con el
// error histórico del 29-feb-1900 ya compensado por esa época).
export function serialExcelAISO(n: number): string | null {
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return null
  const ms = Math.round(n * 86400000)
  const d = new Date(Date.UTC(1899, 11, 30) + ms)
  return fechaUTCaISO(d)
}

function fechaUTCaISO(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// Convierte el valor de una celda de ExcelJS a un valor simple (texto, número
// o fecha ISO). Las fechas llegan como Date en UTC a medianoche: se usan los
// componentes UTC para no correr el día por la zona horaria.
function normalizarCelda(v: unknown): unknown {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : fechaUTCaISO(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map(r => r.text ?? '').join('')
    if ('result' in o) return normalizarCelda(o.result)          // fórmula: solo el valor calculado
    if (typeof o.text === 'string') return o.text                // hipervínculo
    if ('error' in o) return ''
    return ''
  }
  return v
}

// Lector CSV (RFC 4180): comillas dobles, saltos de línea dentro de comillas y
// separador coma, punto y coma o tabulador (Excel en español exporta con ';').
function parsearCSV(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '')
  const primeraLinea = t.split(/\r?\n/, 1)[0] ?? ''
  const cuenta = (c: string) => primeraLinea.split(c).length - 1
  const sep = cuenta(';') > cuenta(',') && cuenta(';') >= cuenta('\t') ? ';' : cuenta('\t') > cuenta(',') ? '\t' : ','
  const filas: string[][] = []
  let fila: string[] = []
  let celda = ''
  let comillas = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (comillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { celda += '"'; i++ } else comillas = false
      } else celda += c
    } else if (c === '"') comillas = true
    else if (c === sep) { fila.push(celda); celda = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      fila.push(celda); celda = ''
      filas.push(fila); fila = []
      if (filas.length > MAX_FILAS + 1) throw new Error(`El archivo tiene demasiadas filas (máximo ${MAX_FILAS}).`)
    } else celda += c
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila) }
  return filas
}

function sinFilasVacias(filas: unknown[][]): unknown[][] {
  return filas.filter(f => f.some(c => c !== '' && c !== null && c !== undefined))
}

// Lee la primera hoja de un .xlsx o un .csv y devuelve las filas (la primera es
// el encabezado) como matriz, sin filas en blanco. Lanza Error con un mensaje
// listo para mostrar al usuario.
export async function leerHoja(file: File): Promise<unknown[][]> {
  if (file.size > MAX_ARCHIVO_BYTES) {
    throw new Error(`El archivo pesa demasiado (máximo ${MAX_ARCHIVO_BYTES / 1024 / 1024} MB).`)
  }
  const nombre = file.name.toLowerCase()
  const esCSV = nombre.endsWith('.csv') || file.type === 'text/csv'
  const esXLSX = nombre.endsWith('.xlsx')
  if (!esCSV && !esXLSX) {
    throw new Error('Formato no admitido: usa un archivo .xlsx o .csv.')
  }

  let filas: unknown[][]
  if (esCSV) {
    filas = parsearCSV(await file.text())
  } else {
    const wb = new ExcelJS.Workbook()
    try {
      await wb.xlsx.load(await file.arrayBuffer())
    } catch {
      throw new Error('No se pudo leer el archivo. Verifica que sea un .xlsx válido.')
    }
    const ws = wb.worksheets[0]
    if (!ws) throw new Error('El archivo no tiene hojas.')
    if (ws.rowCount > MAX_FILAS + 1) throw new Error(`El archivo tiene demasiadas filas (máximo ${MAX_FILAS}).`)
    if (ws.columnCount > MAX_COLUMNAS) throw new Error(`El archivo tiene demasiadas columnas (máximo ${MAX_COLUMNAS}).`)
    const ncols = ws.columnCount
    filas = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const out: unknown[] = []
      for (let c = 1; c <= ncols; c++) out.push(normalizarCelda(row.getCell(c).value))
      filas.push(out)
    })
  }

  filas = sinFilasVacias(filas)
  if (filas.length > MAX_FILAS + 1) throw new Error(`El archivo tiene demasiadas filas (máximo ${MAX_FILAS}).`)
  if (filas.some(f => f.length > MAX_COLUMNAS)) throw new Error(`El archivo tiene demasiadas columnas (máximo ${MAX_COLUMNAS}).`)
  return filas
}

// Genera y descarga una plantilla .xlsx de una sola hoja: primera fila =
// encabezado en negrita con el color de marca; `anchos` en caracteres.
export async function descargarPlantillaXlsx(
  nombreArchivo: string,
  nombreHoja: string,
  filas: (string | number | null)[][],
  anchos: number[] = [],
): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(nombreHoja)
  filas.forEach(f => ws.addRow(f))
  anchos.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  const enc = ws.getRow(1)
  enc.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  enc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B2980' } }
  enc.alignment = { vertical: 'middle' }
  // Las celdas de texto (cédulas, fechas escritas) se guardan como texto para
  // que Excel no les quite ceros ni las convierta.
  ws.eachRow((row, n) => {
    if (n === 1) return
    row.eachCell(cell => { if (typeof cell.value === 'string') cell.numFmt = '@' })
  })
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  a.click()
  URL.revokeObjectURL(url)
}
